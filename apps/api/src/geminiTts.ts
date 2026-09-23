import { isWavAudio, mergeWavAudioParts, wrapPcm16Wav } from "./audio/wavAudio.js";
import { fetchWithTimeout } from "./fetchWithTimeout.js";
import { SpeechDependencyError } from "./localLanguage.js";
import { splitTextForSpeech } from "./speechChunks.js";
import { DEFAULT_VOICE_BY_PROVIDER, isGeminiTtsVoice, type GeminiTtsProvider } from "./ttsSchema.js";

const GEMINI_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

export const DEFAULT_GEMINI_TTS_MODELS: Readonly<Record<GeminiTtsProvider, string>> = {
  gemini: "gemini-3.8-flash-tts",
  "gemini-lite": "gemini-3.8-flash-lite-tts"
};

const MODEL_ENV_BY_PROVIDER: Readonly<Record<GeminiTtsProvider, string>> = {
  gemini: "GEMINI_TTS_MODEL",
  "gemini-lite": "GEMINI_TTS_LITE_MODEL"
};

// Generation time grows with section length, so shorter sections synthesized
// in parallel return audio sooner. Measured live on 2026-09-23 for ~1.9k
// characters: 2500 B x3 took 35 s, 1200 B x4 took 22 s, 800 B x4 took 16 s.
const DEFAULT_GEMINI_TTS_CHUNK_BYTES = 800;
const DEFAULT_GEMINI_TTS_CONCURRENCY = 4;
const GEMINI_TTS_DEFAULT_TIMEOUT_MS = 45_000;
const GEMINI_TTS_MAX_ATTEMPTS = 2;
const GEMINI_TTS_RETRY_BASE_MS = 400;
const GEMINI_TTS_SAMPLE_RATE = 24_000;
const GEMINI_TTS_SECTION_PAUSE_MS = 120;
const GEMINI_TTS_MAX_STYLE_CHARACTERS = 300;
const DEFAULT_READING_STYLE = "Read aloud clearly and naturally, like a calm audiobook narrator.";

export type GeminiSpeechInput = {
  provider: GeminiTtsProvider;
  text: string;
  voice: string;
  speed: number;
  instructions?: string;
};

export type GeminiSpeechDeps = {
  apiKey?: string;
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

type AudioBlock = { data: string; mimeType?: string; sampleRate?: number; channels?: number };

/** Synthesize English speech with Gemini 3.8 Flash TTS or Flash-Lite TTS and return one WAV file. */
export async function synthesizeGeminiSpeech(input: GeminiSpeechInput, deps: GeminiSpeechDeps = {}): Promise<Buffer> {
  const apiKey = deps.apiKey ?? process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new SpeechDependencyError("Gemini Text-to-Speech is not configured.", "gemini_tts", undefined, 0, false, false);
  }
  const sections = splitTextForSpeech(input.text, boundedEnvInteger("GEMINI_TTS_CHUNK_BYTES", DEFAULT_GEMINI_TTS_CHUNK_BYTES, 300, 4_000));
  if (!sections.length) throw new SpeechDependencyError("No speakable text was provided.", "gemini_tts", 400, 0, false, false);

  const request = {
    model: geminiTtsModel(input.provider),
    voice: isGeminiTtsVoice(input.voice) ? input.voice : DEFAULT_VOICE_BY_PROVIDER[input.provider],
    style: readingStyle(input.instructions, input.speed)
  };
  const parts = await mapWithConcurrency(sections, boundedEnvInteger("GEMINI_TTS_CONCURRENCY", DEFAULT_GEMINI_TTS_CONCURRENCY, 1, 8), (text) =>
    synthesizeSection({ ...request, text }, apiKey, deps)
  );
  return parts.length === 1 ? parts[0] : mergeWavAudioParts(parts, GEMINI_TTS_SECTION_PAUSE_MS);
}

export function geminiTtsModel(provider: GeminiTtsProvider, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[MODEL_ENV_BY_PROVIDER[provider]]?.trim();
  return configured && /^[a-z0-9][a-z0-9.\-]{2,79}$/.test(configured) ? configured : DEFAULT_GEMINI_TTS_MODELS[provider];
}

/**
 * Gemini TTS has no numeric speaking rate, so pace is described in the style
 * prompt. Clients that play locally request speed 1 and apply their own
 * playback rate; this path matters for cast URLs that play on a receiver.
 */
export function readingStyle(instructions: string | undefined, speed: number): string {
  const tone = (instructions ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, GEMINI_TTS_MAX_STYLE_CHARACTERS);
  return [tone || DEFAULT_READING_STYLE, paceHint(speed)].filter(Boolean).join(" ");
}

function paceHint(speed: number): string {
  if (!Number.isFinite(speed) || Math.abs(speed - 1) < 0.05) return "";
  if (speed < 1) return "Speak at a slightly slower, unhurried pace.";
  if (speed <= 1.3) return "Speak at a slightly brisk pace.";
  if (speed <= 1.7) return "Speak at a fast, brisk pace.";
  return "Speak rapidly while staying clearly intelligible.";
}

async function synthesizeSection(
  request: { model: string; voice: string; style: string; text: string },
  apiKey: string,
  deps: GeminiSpeechDeps
): Promise<Buffer> {
  const sleep = deps.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: SpeechDependencyError | undefined;
  for (let attempt = 1; attempt <= GEMINI_TTS_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await requestSection(request, apiKey, deps.fetcher, attempt);
    } catch (error) {
      lastError = error instanceof SpeechDependencyError
        ? error
        : new SpeechDependencyError(
          isTimeout(error) ? "Gemini Text-to-Speech timed out." : "Gemini Text-to-Speech could not be reached.",
          "gemini_tts",
          undefined,
          attempt,
          isTimeout(error),
          true
        );
      if (!lastError.retryable || attempt === GEMINI_TTS_MAX_ATTEMPTS) break;
      await sleep(GEMINI_TTS_RETRY_BASE_MS * attempt);
    }
  }
  throw lastError ?? new SpeechDependencyError("Gemini Text-to-Speech failed.", "gemini_tts", undefined, GEMINI_TTS_MAX_ATTEMPTS);
}

async function requestSection(
  request: { model: string; voice: string; style: string; text: string },
  apiKey: string,
  fetcher: typeof fetch | undefined,
  attempt: number
): Promise<Buffer> {
  const response = await fetchWithTimeout(GEMINI_INTERACTIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      model: request.model,
      // Saved reading content must not be retained as a retrievable interaction.
      store: false,
      input: [{
        type: "user_input",
        content: [{
          type: "text",
          text: request.text,
          annotations: [{ type: "speech_metadata", style: request.style }]
        }]
      }],
      response_format: { type: "audio", mime_type: "audio/wav", sample_rate: GEMINI_TTS_SAMPLE_RATE },
      generation_config: { speech_config: [{ voice: request.voice }] }
    })
  }, { fetcher, timeoutMs: geminiTimeoutMs() });

  const body = await response.json().catch(() => undefined) as unknown;
  if (!response.ok) {
    const status = response.status;
    const retryable = status === 408 || status === 429 || status >= 500;
    throw new SpeechDependencyError(`Gemini Text-to-Speech failed (${status}).`, "gemini_tts", status, attempt, status === 408 || status === 504, retryable);
  }
  const record = asRecord(body);
  if (record?.status === "failed" || record?.status === "cancelled") {
    throw new SpeechDependencyError(`Gemini Text-to-Speech ${String(record.status)}.`, "gemini_tts", response.status, attempt, false, true);
  }
  const blocks = findAudioBlocks(body);
  if (!blocks.length) {
    throw new SpeechDependencyError("Gemini Text-to-Speech returned no audio.", "gemini_tts", response.status, attempt, false, true);
  }
  const wavs = blocks.map(decodeAudioBlock);
  return wavs.length === 1 ? wavs[0] : mergeWavAudioParts(wavs, 0);
}

/**
 * The Interactions API exposes audio as `output_audio` in SDK responses and as
 * `{ type: "audio", data }` blocks inside `steps` on the wire. Legacy
 * generateContent responses use `inlineData`. Accept all three shapes.
 */
export function findAudioBlocks(body: unknown): AudioBlock[] {
  const root = asRecord(body);
  if (!root) return [];
  for (const shortcut of [root.output_audio, root.outputAudio, asRecord(root.interaction)?.output_audio, asRecord(root.interaction)?.outputAudio]) {
    const block = audioBlockFrom(shortcut);
    if (block) return [block];
  }
  const blocks: AudioBlock[] = [];
  walk(root, 0, blocks);
  return blocks;
}

function walk(value: unknown, depth: number, blocks: AudioBlock[]): void {
  if (depth > 10 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, depth + 1, blocks);
    return;
  }
  const record = value as Record<string, unknown>;
  if (record.type === "audio") {
    const block = audioBlockFrom(record);
    if (block) {
      blocks.push(block);
      return;
    }
  }
  for (const key of ["inlineData", "inline_data"]) {
    const inline = asRecord(record[key]);
    const mimeType = stringField(inline, "mimeType", "mime_type");
    if (inline && typeof inline.data === "string" && mimeType?.startsWith("audio/")) {
      blocks.push({ data: inline.data, mimeType });
      return;
    }
  }
  for (const [key, child] of Object.entries(record)) {
    // Request echoes and usage metadata never carry output audio.
    if (key === "input" || key === "usage") continue;
    walk(child, depth + 1, blocks);
  }
}

function audioBlockFrom(value: unknown): AudioBlock | undefined {
  const record = asRecord(value);
  if (!record || typeof record.data !== "string" || !record.data) return undefined;
  return {
    data: record.data,
    mimeType: stringField(record, "mime_type", "mimeType"),
    sampleRate: numberField(record, "sample_rate", "sampleRate"),
    channels: numberField(record, "channels")
  };
}

function decodeAudioBlock(block: AudioBlock): Buffer {
  const bytes = Buffer.from(block.data, "base64");
  if (isWavAudio(bytes)) return bytes;
  const mimeType = block.mimeType?.toLowerCase() ?? "";
  if (mimeType && !/l16|pcm|wav/.test(mimeType)) {
    throw new SpeechDependencyError("Gemini Text-to-Speech returned an unsupported audio format.", "gemini_tts", undefined, 1, false, false);
  }
  const rateFromMime = Number(/rate=(\d+)/.exec(mimeType)?.[1]);
  const sampleRate = block.sampleRate ?? (Number.isFinite(rateFromMime) && rateFromMime > 0 ? rateFromMime : GEMINI_TTS_SAMPLE_RATE);
  return wrapPcm16Wav(bytes, sampleRate, block.channels ?? 1);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function boundedEnvInteger(name: string, fallback: number, min: number, max: number): number {
  const configured = Number(process.env[name]);
  return Number.isInteger(configured) && configured >= min && configured <= max ? configured : fallback;
}

function geminiTimeoutMs(): number {
  const configured = Number(process.env.GEMINI_TTS_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : GEMINI_TTS_DEFAULT_TIMEOUT_MS;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringField(record: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  for (const key of keys) if (typeof record?.[key] === "string") return record[key] as string;
  return undefined;
}

function numberField(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) if (typeof record[key] === "number" && Number.isFinite(record[key])) return record[key] as number;
  return undefined;
}
