import { getGoogleAccessToken } from "./googleAuth.js";
import { fetchWithTimeout } from "./fetchWithTimeout.js";
import { mergeWavAudioParts } from "./audio/wavAudio.js";
import { normalizeSpeechInput, prepareTranslatedSpeech, splitSpeechSections } from "./speechText.js";
import { isIP } from "node:net";
import { isBlockedNetworkAddress, readBoundedResponseBody } from "./safeRemoteFetch.js";

export const SUPPORTED_TARGET_LANGUAGES = ["en", "tw", "ee", "gaa"] as const;

export type TargetLanguage = (typeof SUPPORTED_TARGET_LANGUAGES)[number];

export const GHANANLP_TWI_VOICES = [
  "ghananlp-akuapem-twi",
  "ghananlp-asante-twi"
] as const;

export type GhanaNlpTwiVoice = (typeof GHANANLP_TWI_VOICES)[number];

export const DEFAULT_GHANANLP_TWI_VOICE: GhanaNlpTwiVoice = "ghananlp-asante-twi";

export const KHAYA_SPEAKERS = ["male_low", "male_high", "female"] as const;
export type KhayaSpeaker = (typeof KHAYA_SPEAKERS)[number];

export type LocalVoiceOption = {
  id: string;
  language: Exclude<TargetLanguage, "en">;
  speaker: KhayaSpeaker;
  label: string;
  description: string;
};

const LOCAL_VOICE_LANGUAGE_CODES = {
  tw: ["twi", "atw"],
  ee: ["ewe"],
  gaa: ["gaa"]
} as const;

export function localVoiceOptions(targetLanguage: Exclude<TargetLanguage, "en">): LocalVoiceOption[] {
  const languageCodes = LOCAL_VOICE_LANGUAGE_CODES[targetLanguage];
  return languageCodes.flatMap((languageCode) => KHAYA_SPEAKERS.map((speaker) => ({
    id: `khaya:${languageCode}:${speaker}`,
    language: targetLanguage,
    speaker,
    label: `${localVoiceVarietyLabel(languageCode)} · ${speakerLabel(speaker)}`,
    description: `${speakerLabel(speaker)} Khaya voice for ${localVoiceVarietyLabel(languageCode)}.`
  })));
}

export function normalizeLocalLanguageVoice(targetLanguage: Exclude<TargetLanguage, "en">, voice: unknown): string {
  if (targetLanguage === "tw" && typeof voice === "string" && (GHANANLP_TWI_VOICES as readonly string[]).includes(voice)) return voice;
  const normalized = typeof voice === "string" ? voice.trim() : "";
  return localVoiceOptions(targetLanguage).some((option) => option.id === normalized)
    ? normalized
    : defaultLocalVoice(targetLanguage);
}

type GoogleTranslateResponse = {
  data?: {
    translations?: Array<{ translatedText?: string }>;
  };
  error?: {
    message?: string;
  };
};

type KhayaSynthesisResult = {
  buffer: Buffer;
  contentType: string;
};

type TwiFallbackSynthesisResult = KhayaSynthesisResult & {
  provider: "nano-twi";
};

export type SpeechDependency = "google_translate" | "khaya_translate" | "khaya_tts" | "khaya_audio" | "gemini_tts";

/**
 * Preserve safe provider metadata across the route boundary without exposing
 * an upstream response body to clients.
 */
export class SpeechDependencyError extends Error {
  readonly name = "SpeechDependencyError";

  constructor(
    message: string,
    readonly dependency: SpeechDependency,
    readonly upstreamStatus: number | undefined,
    readonly attempts: number,
    readonly timedOut = false,
    readonly retryable = true
  ) {
    super(message);
  }
}

type SpeechDependencyResponse<T> = {
  response: Response;
  body: T;
  attempts: number;
};

const GOOGLE_TRANSLATE_URL = "https://translation.googleapis.com/language/translate/v2";
const KHAYA_TTS_URL = "https://translation-api.ghananlp.org/tts/v2/synthesize";
const KHAYA_TRANSLATE_URL = "https://translation-api.ghananlp.org/v2/translate";
const GOOGLE_TRANSLATE_CHAR_LIMIT = 4_500;
const KHAYA_TRANSLATE_CHAR_LIMIT = 1_000;
const KHAYA_DEFAULT_SPEAKER = "male_low";
const KHAYA_DEFAULT_PAUSE_MS = 180;
const LOCAL_SPEECH_MAX_ATTEMPTS = 3;
const LOCAL_SPEECH_RETRY_BASE_MS = 250;
const LOCAL_SPEECH_MAX_RETRY_DELAY_MS = 5_000;
const PROVIDER_TEXT_MAX_BYTES = 2 * 1024 * 1024;
const KHAYA_AUDIO_DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const KHAYA_AUDIO_ABSOLUTE_MAX_BYTES = 64 * 1024 * 1024;
const KHAYA_TOTAL_AUDIO_DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const KHAYA_TOTAL_AUDIO_ABSOLUTE_MAX_BYTES = 128 * 1024 * 1024;
const RETRYABLE_PROVIDER_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

const GOOGLE_TRANSLATE_LANGUAGE_BY_TARGET = {
  tw: "ak",
  ee: "ee"
} as const satisfies Record<Exclude<TargetLanguage, "en" | "gaa">, string>;

const TTS_LANGUAGE_BY_TARGET = {
  tw: "twi",
  ee: "ewe",
  gaa: "gaa"
} as const satisfies Record<Exclude<TargetLanguage, "en">, string>;

export function normalizeTargetLanguage(value: unknown): TargetLanguage {
  return typeof value === "string" && (SUPPORTED_TARGET_LANGUAGES as readonly string[]).includes(value)
    ? (value as TargetLanguage)
    : "en";
}

export function isLocalLanguage(language: TargetLanguage): language is Exclude<TargetLanguage, "en"> {
  return language !== "en";
}

export async function synthesizeLocalLanguageSpeech(input: {
  text: string;
  targetLanguage: Exclude<TargetLanguage, "en">;
  speed: number;
  voice?: string;
  twiFallback?: (input: { text: string; speed: number }) => Promise<TwiFallbackSynthesisResult>;
  preferTwiFallback?: boolean;
}): Promise<KhayaSynthesisResult & { provider: "ghananlp" | "nano-twi" }> {
  const normalizedInput = normalizeSpeechInput(input.text);
  const translatedParts = await translateEnglishToLocalLanguage(normalizedInput, input.targetLanguage);
  const sections = translatedParts.flatMap((translatedText) => {
    const prepared = prepareTranslatedSpeech(translatedText, input.targetLanguage);
    return splitSpeechSections(prepared);
  });

  if (input.targetLanguage === "tw" && input.twiFallback && input.preferTwiFallback) {
    return synthesizeTwiFallbackSections(sections, input.speed, input.twiFallback);
  }

  try {
    const speech = await synthesizeKhayaSections(sections, input.targetLanguage, input.voice);
    return { ...speech, provider: "ghananlp" };
  } catch (error) {
    if (input.targetLanguage !== "tw" || !input.twiFallback || !shouldUseTwiFallback(error)) throw error;
    return synthesizeTwiFallbackSections(sections, input.speed, input.twiFallback);
  }
}

async function synthesizeKhayaSections(
  sections: string[],
  targetLanguage: Exclude<TargetLanguage, "en">,
  voice?: string
): Promise<KhayaSynthesisResult> {
  const audioParts: Buffer[] = [];
  const totalAudioLimit = khayaTotalAudioMaxBytes();
  let totalAudioBytes = 0;

  for (const section of sections) {
    const result = await synthesizeTranslatedText(section, targetLanguage, voice);
    if (result.buffer.byteLength > totalAudioLimit - totalAudioBytes) {
      throw new SpeechDependencyError(
        "Khaya Text-to-Speech exceeded the audio limit for one request.",
        "khaya_tts",
        undefined,
        1,
        false,
        false
      );
    }
    totalAudioBytes += result.buffer.byteLength;
    audioParts.push(result.buffer);
  }

  return {
    buffer: mergeWavAudioParts(audioParts, khayaPauseMilliseconds()),
    contentType: "audio/wav"
  };
}

async function synthesizeTwiFallbackSections(
  sections: string[],
  speed: number,
  synthesize: (input: { text: string; speed: number }) => Promise<TwiFallbackSynthesisResult>
): Promise<TwiFallbackSynthesisResult> {
  const audioParts: Buffer[] = [];
  const totalAudioLimit = khayaTotalAudioMaxBytes();
  let totalAudioBytes = 0;
  for (const section of sections) {
    const result = await synthesize({ text: section, speed });
    if (result.buffer.byteLength > totalAudioLimit - totalAudioBytes) {
      throw new SpeechDependencyError(
        "Offline Twi Text-to-Speech exceeded the audio limit for one request.",
        "khaya_tts",
        undefined,
        1,
        false,
        false
      );
    }
    totalAudioBytes += result.buffer.byteLength;
    audioParts.push(result.buffer);
  }
  return {
    buffer: mergeWavAudioParts(audioParts, khayaPauseMilliseconds()),
    contentType: "audio/wav",
    provider: "nano-twi"
  };
}

function shouldUseTwiFallback(error: unknown): boolean {
  return error instanceof SpeechDependencyError
    && (error.dependency === "khaya_tts" || error.dependency === "khaya_audio");
}

export async function translateEnglishToLocalLanguage(
  text: string,
  targetLanguage: Exclude<TargetLanguage, "en">
): Promise<string[]> {
  if (targetLanguage === "gaa") return translateEnglishWithKhaya(text, targetLanguage);

  const parts = splitForGoogleTranslation(text);
  const translated: string[] = [];
  for (const part of parts) {
    const endpoint = new URL(GOOGLE_TRANSLATE_URL);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY?.trim() || process.env.GOOGLE_TTS_API_KEY?.trim();
    if (apiKey) {
      endpoint.searchParams.set("key", apiKey);
    } else {
      headers.Authorization = `Bearer ${await getGoogleAccessToken()}`;
    }

    const { response, body: responseText, attempts } = await fetchSpeechDependencyWithRetry("google_translate", endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        q: part,
        source: "en",
        target: GOOGLE_TRANSLATE_LANGUAGE_BY_TARGET[targetLanguage],
        format: "text"
      })
    }, readProviderTextBody);
    if (!response.ok) {
      throw new SpeechDependencyError(
        googleTranslateErrorMessage(responseText, "Google Translate failed."),
        "google_translate",
        response.status,
        attempts,
        false,
        isRetryableProviderStatus(response.status)
      );
    }
    translated.push(parseGoogleTranslateResponse(responseText));
  }
  return translated;
}

async function translateEnglishWithKhaya(
  text: string,
  targetLanguage: Extract<TargetLanguage, "gaa">
): Promise<string[]> {
  const parts = splitForTranslation(text, KHAYA_TRANSLATE_CHAR_LIMIT);
  const translated: string[] = [];
  for (const part of parts) {
    const { response, body: responseText, attempts } = await fetchSpeechDependencyWithRetry("khaya_translate", khayaTranslateUrl(), {
      method: "POST",
      headers: khayaHeaders({ accept: "application/json" }),
      body: JSON.stringify({
        in: part,
        lang: `eng-${TTS_LANGUAGE_BY_TARGET[targetLanguage]}`
      })
    }, readProviderTextBody);
    if (!response.ok) {
      throw new SpeechDependencyError(
        khayaErrorMessage(responseText, "Khaya Translation failed."),
        "khaya_translate",
        response.status,
        attempts,
        false,
        isRetryableProviderStatus(response.status)
      );
    }
    translated.push(parseKhayaTranslationResponse(responseText));
  }
  return translated;
}

function splitForGoogleTranslation(text: string): string[] {
  return splitForTranslation(text, GOOGLE_TRANSLATE_CHAR_LIMIT);
}

function splitForTranslation(text: string, characterLimit: number): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  if (normalized.length <= characterLimit) return [normalized];

  const parts: string[] = [];
  let current = "";
  for (const sentence of normalized.split(/(?<=[.!?])\s+/)) {
    if (!sentence) continue;
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= characterLimit) {
      current = candidate;
      continue;
    }
    if (current) {
      parts.push(current);
      current = "";
    }
    if (sentence.length <= characterLimit) {
      current = sentence;
      continue;
    }
    parts.push(...splitOversizedTranslationText(sentence, characterLimit));
  }
  if (current) parts.push(current);
  return parts;
}

function splitOversizedTranslationText(text: string, characterLimit: number): string[] {
  const parts: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= characterLimit) {
      current = candidate;
      continue;
    }
    if (current) parts.push(current);
    current = word.length <= characterLimit ? word : word.slice(0, characterLimit);
  }
  if (current) parts.push(current);
  return parts;
}

async function synthesizeTranslatedText(
  text: string,
  targetLanguage: Exclude<TargetLanguage, "en">,
  voice?: string
): Promise<KhayaSynthesisResult> {
  const { language, speaker } = languageAndSpeakerForLocalVoice(targetLanguage, voice);
  const headers = khayaHeaders({ accept: "audio/mpeg, audio/wav, application/octet-stream, application/json" });

  const { response, body: bytes, attempts } = await fetchSpeechDependencyWithRetry("khaya_tts", khayaTtsUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify({
      text,
      language,
      speaker_id: speaker,
      stream: true,
      format: "wav"
    })
  }, readKhayaAudioBody);
  if (!response.ok) {
    throw new SpeechDependencyError(
      khayaErrorMessage(bytes.toString("utf8"), "Khaya Text-to-Speech failed."),
      "khaya_tts",
      response.status,
      attempts,
      false,
      isRetryableProviderStatus(response.status)
    );
  }
  return parseSynthesisResponse(response, bytes, headers);
}

function languageForLocalVoice(targetLanguage: Exclude<TargetLanguage, "en">, voice?: string): string {
  return languageAndSpeakerForLocalVoice(targetLanguage, voice).language;
}

function languageAndSpeakerForLocalVoice(
  targetLanguage: Exclude<TargetLanguage, "en">,
  voice?: string
): { language: string; speaker: KhayaSpeaker } {
  const normalized = normalizeLocalLanguageVoice(targetLanguage, voice);
  if (normalized === "ghananlp-akuapem-twi") return { language: "atw", speaker: configuredDefaultSpeaker() };
  if (normalized === "ghananlp-asante-twi") return { language: "twi", speaker: configuredDefaultSpeaker() };
  const [, language, speaker] = normalized.split(":");
  return {
    language: language || TTS_LANGUAGE_BY_TARGET[targetLanguage],
    speaker: isKhayaSpeaker(speaker) ? speaker : configuredDefaultSpeaker()
  };
}

function defaultLocalVoice(targetLanguage: Exclude<TargetLanguage, "en">): string {
  return `khaya:${TTS_LANGUAGE_BY_TARGET[targetLanguage]}:${configuredDefaultSpeaker()}`;
}

function configuredDefaultSpeaker(): KhayaSpeaker {
  const configured = process.env.KHAYA_TTS_SPEAKER_ID?.trim();
  return isKhayaSpeaker(configured) ? configured : KHAYA_DEFAULT_SPEAKER;
}

function isKhayaSpeaker(value: unknown): value is KhayaSpeaker {
  return typeof value === "string" && (KHAYA_SPEAKERS as readonly string[]).includes(value);
}

function khayaPauseMilliseconds(): number {
  const configured = Number(process.env.KHAYA_TTS_PAUSE_MS);
  return Number.isFinite(configured) && configured >= 0 && configured <= 2_000 ? configured : KHAYA_DEFAULT_PAUSE_MS;
}

function localVoiceVarietyLabel(language: string): string {
  if (language === "atw") return "Akuapem Twi";
  if (language === "twi") return "Asante Twi";
  if (language === "ewe") return "Ewe";
  return "Ga";
}

function speakerLabel(speaker: KhayaSpeaker): string {
  if (speaker === "male_high") return "Higher male";
  if (speaker === "female") return "Female";
  return "Lower male";
}

function khayaTtsUrl(): string {
  return validateKhayaProviderEndpoint(process.env.KHAYA_TTS_URL?.trim() || KHAYA_TTS_URL, "khaya_tts");
}

function khayaTranslateUrl(): string {
  return validateKhayaProviderEndpoint(process.env.KHAYA_TRANSLATE_URL?.trim() || KHAYA_TRANSLATE_URL, "khaya_translate");
}

function validateKhayaProviderEndpoint(value: string, dependency: Extract<SpeechDependency, "khaya_tts" | "khaya_translate">): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new SpeechDependencyError("Khaya provider URL is invalid.", dependency, undefined, 0, false, false);
  }
  if (
    endpoint.protocol !== "https:"
    || endpoint.username
    || endpoint.password
    || isPrivateOrLocalHostname(endpoint.hostname)
  ) {
    throw new SpeechDependencyError("Khaya provider URL must use a public HTTPS origin.", dependency, undefined, 0, false, false);
  }
  return endpoint.toString();
}

async function parseSynthesisResponse(
  response: Response,
  bytes: Buffer,
  headers: Record<string, string>
): Promise<KhayaSynthesisResult> {
  const contentType = response.headers.get("content-type")?.split(";")[0] ?? "audio/mpeg";
  if (contentType.includes("json")) {
    return resolveJsonSynthesisResponse(bytes.toString("utf8"), headers);
  }
  if (!bytes.length) throw new Error("Khaya Text-to-Speech returned an empty audio response.");
  return { buffer: bytes, contentType };
}

async function resolveJsonSynthesisResponse(
  responseText: string,
  headers: Record<string, string>
): Promise<KhayaSynthesisResult> {
  const parsed = JSON.parse(responseText) as unknown;
  const error = jsonStringValue(parsed, ["error", "message", "detail", "type"]);
  if (error) throw new Error(error);

  const audioValue = jsonStringValue(parsed, ["audio", "audioContent", "audio_content", "data", "base64", "wav", "mp3"]);
  if (audioValue) {
    if (/^https?:\/\//.test(audioValue.trim())) return fetchSynthesisAudioUrl(audioValue, headers);
    const decoded = decodeAudioString(audioValue);
    if (decoded.length) return { buffer: decoded, contentType: contentTypeFromAudioString(audioValue) };
  }

  const audioUrl = jsonStringValue(parsed, ["url", "audioUrl", "audio_url", "file", "fileUrl", "file_url"]);
  if (audioUrl) {
    return fetchSynthesisAudioUrl(audioUrl, headers);
  }

  throw new Error("Khaya Text-to-Speech returned an unsupported audio response.");
}

async function fetchSynthesisAudioUrl(url: string, headers: Record<string, string>): Promise<KhayaSynthesisResult> {
  const { audioUrl, sendSubscription } = resolveAllowedKhayaAudioUrl(url);
  const requestHeaders: Record<string, string> = {
    Accept: "audio/mpeg, audio/wav, application/octet-stream"
  };
  const subscriptionHeader = process.env.KHAYA_SUBSCRIPTION_HEADER?.trim() || "Ocp-Apim-Subscription-Key";
  const subscriptionValue = headers[subscriptionHeader];
  if (subscriptionValue && sendSubscription) {
    requestHeaders[subscriptionHeader] = subscriptionValue;
  }

  const { response, body: bytes, attempts } = await fetchSpeechDependencyWithRetry("khaya_audio", audioUrl.toString(), {
    headers: requestHeaders,
    redirect: "manual"
  }, readKhayaAudioBody);
  if (!response.ok) {
    throw new SpeechDependencyError(
      khayaErrorMessage(bytes.toString("utf8"), "Unable to download Khaya Text-to-Speech audio."),
      "khaya_audio",
      response.status,
      attempts,
      false,
      isRetryableProviderStatus(response.status)
    );
  }
  if (!bytes.length) throw new Error("Khaya Text-to-Speech returned an empty audio file.");
  return {
    buffer: bytes,
    contentType: response.headers.get("content-type")?.split(";")[0] ?? "audio/mpeg"
  };
}

function resolveAllowedKhayaAudioUrl(value: string): { audioUrl: URL; sendSubscription: boolean } {
  const { secretOrigin, allowedOrigins } = khayaAudioOrigins();
  let resolved: URL;
  try {
    resolved = new URL(value, `${secretOrigin}/`);
  } catch {
    throw unsafeKhayaAudioUrlError();
  }

  const hostname = resolved.hostname.toLowerCase().replace(/\.$/, "");
  if (
    resolved.protocol !== "https:"
    || resolved.username
    || resolved.password
    || isPrivateOrLocalHostname(hostname)
    || !allowedOrigins.has(resolved.origin)
  ) {
    throw unsafeKhayaAudioUrlError();
  }
  return { audioUrl: resolved, sendSubscription: resolved.origin === secretOrigin };
}

function khayaAudioOrigins(): { secretOrigin: string; allowedOrigins: Set<string> } {
  let provider: URL;
  try {
    provider = new URL(khayaTtsUrl());
  } catch {
    throw unsafeKhayaAudioUrlError();
  }
  if (provider.protocol !== "https:" || provider.username || provider.password || isPrivateOrLocalHostname(provider.hostname)) {
    throw unsafeKhayaAudioUrlError();
  }

  const allowedOrigins = new Set([provider.origin]);
  for (const configured of (process.env.KHAYA_AUDIO_ALLOWED_ORIGINS ?? "").split(",")) {
    if (!configured.trim()) continue;
    try {
      const parsed = new URL(configured.trim());
      if (
        parsed.protocol === "https:"
        && !parsed.username
        && !parsed.password
        && !isPrivateOrLocalHostname(parsed.hostname)
      ) allowedOrigins.add(parsed.origin);
    } catch {
      // Ignore malformed optional origins instead of broadening the allow-list.
    }
  }
  return { secretOrigin: provider.origin, allowedOrigins };
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
    || normalized.endsWith(".internal")
    || normalized.endsWith(".home.arpa")
  ) return true;
  return isIP(normalized) !== 0 && isBlockedNetworkAddress(normalized);
}

function unsafeKhayaAudioUrlError(): SpeechDependencyError {
  return new SpeechDependencyError(
    "Khaya Text-to-Speech returned an untrusted audio location.",
    "khaya_audio",
    undefined,
    1,
    false,
    false
  );
}

async function readProviderTextBody(response: Response): Promise<string> {
  return Buffer.from(await readBoundedResponseBody(response, PROVIDER_TEXT_MAX_BYTES)).toString("utf8");
}

async function readKhayaAudioBody(response: Response): Promise<Buffer> {
  const maxBytes = khayaAudioMaxBytes();
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const responseLimit = contentType.includes("json")
    ? Math.min(Math.ceil(maxBytes * 1.5), KHAYA_AUDIO_ABSOLUTE_MAX_BYTES)
    : maxBytes;
  return Buffer.from(await readBoundedResponseBody(response, responseLimit));
}

function khayaAudioMaxBytes(): number {
  const configured = Number(process.env.KHAYA_AUDIO_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, KHAYA_AUDIO_ABSOLUTE_MAX_BYTES)
    : KHAYA_AUDIO_DEFAULT_MAX_BYTES;
}

function khayaTotalAudioMaxBytes(): number {
  const configured = Number(process.env.KHAYA_TOTAL_AUDIO_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, KHAYA_TOTAL_AUDIO_ABSOLUTE_MAX_BYTES)
    : KHAYA_TOTAL_AUDIO_DEFAULT_MAX_BYTES;
}

function decodeAudioString(value: string): Buffer {
  const trimmed = value.trim();
  const dataUriMatch = trimmed.match(/^data:([^;,]+);base64,(.+)$/);
  if (dataUriMatch) return Buffer.from(dataUriMatch[2], "base64");
  if (!looksLikeBase64(trimmed)) return Buffer.alloc(0);
  return Buffer.from(trimmed, "base64");
}

function contentTypeFromAudioString(value: string): string {
  return value.match(/^data:([^;,]+);base64,/)?.[1] ?? "audio/mpeg";
}

function looksLikeBase64(value: string): boolean {
  if (!value || value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function jsonStringValue(value: unknown, keys: string[]): string | null {
  if (typeof value === "string") return keys.includes("audio") ? value : null;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return null;
}

function khayaHeaders(options: { accept: string }): Record<string, string> {
  const key = khayaSubscriptionKey();
  return {
    Accept: options.accept,
    "Content-Type": "application/json",
    [process.env.KHAYA_SUBSCRIPTION_HEADER?.trim() || "Ocp-Apim-Subscription-Key"]: key
  };
}

function khayaSubscriptionKey(): string {
  const key =
    process.env.KHAYA_API_KEY?.trim() ||
    process.env.KHAYA_SUBSCRIPTION_KEY?.trim() ||
    process.env.GHANANLP_API_KEY?.trim() ||
    process.env.GHANANLP_SUBSCRIPTION_KEY?.trim();
  if (!key) {
    throw new Error(
      "Khaya credentials are not configured. Set KHAYA_API_KEY, KHAYA_SUBSCRIPTION_KEY, GHANANLP_API_KEY, or GHANANLP_SUBSCRIPTION_KEY."
    );
  }
  return key;
}

function parseGoogleTranslateResponse(responseText: string): string {
  const trimmed = responseText.trim();
  if (!trimmed) throw new Error("Google Translate returned an empty response.");
  try {
    const parsed = JSON.parse(trimmed) as GoogleTranslateResponse;
    const translated = parsed.data?.translations?.[0]?.translatedText;
    if (translated) return decodeHtmlEntities(translated);
    const error = parsed.error?.message;
    if (error) throw new Error(error);
  } catch (error) {
    if (error instanceof Error && !error.message.includes("JSON")) throw error;
  }
  throw new Error("Google Translate returned an unsupported response.");
}

function parseKhayaTranslationResponse(responseText: string): string {
  const trimmed = responseText.trim();
  if (!trimmed) throw new Error("Khaya Translation returned an empty response.");
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
    const translated = jsonStringValue(parsed, ["translation", "translatedText", "translated_text", "text", "data"]);
    if (translated) return translated;
    const error = jsonStringValue(parsed, ["message", "detail", "type"]);
    if (error) throw new Error(error);
  } catch (error) {
    if (error instanceof Error && !error.message.includes("JSON")) throw error;
  }
  throw new Error("Khaya Translation returned an unsupported response.");
}

function googleTranslateErrorMessage(responseText: string, fallback: string): string {
  try {
    const parsed = JSON.parse(responseText) as GoogleTranslateResponse;
    return parsed.error?.message ?? fallback;
  } catch {
    return responseText.trim() || fallback;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function khayaErrorMessage(responseText: string, fallback: string): string {
  try {
    const parsed = JSON.parse(responseText) as {
      message?: string;
      error?: string | { message?: string };
      type?: string;
    };
    const error = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
    return parsed.message ?? error ?? parsed.type ?? fallback;
  } catch {
    return responseText.trim() || fallback;
  }
}

async function fetchSpeechDependencyWithRetry<T>(
  dependency: SpeechDependency,
  input: Parameters<typeof fetch>[0],
  init: RequestInit,
  readBody: (response: Response) => Promise<T>
): Promise<SpeechDependencyResponse<T>> {
  const maxAttempts = localSpeechMaxAttempts();
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(input, init);
      const retryableStatus = isRetryableProviderStatus(response.status);
      if (retryableStatus && attempt < maxAttempts) {
        const delayMs = retryDelayMilliseconds(response.headers.get("retry-after"), attempt);
        await response.body?.cancel().catch(() => undefined);
        await wait(delayMs);
        continue;
      }

      try {
        return { response, body: await readBody(response), attempts: attempt };
      } catch (error) {
        if (isProviderBodyLimitError(error)) {
          throw new SpeechDependencyError(
            `${speechDependencyLabel(dependency)} returned an oversized response.`,
            dependency,
            response.status,
            attempt,
            false,
            false
          );
        }
        if (!isRetryableProviderError(error)) throw error;

        const retryableBodyFailure = response.ok || retryableStatus;
        if (!retryableBodyFailure) {
          throw new SpeechDependencyError(
            `${speechDependencyLabel(dependency)} returned an unreadable response.`,
            dependency,
            response.status,
            attempt,
            isProviderTimeoutError(error),
            false
          );
        }
        if (attempt === maxAttempts) {
          throw new SpeechDependencyError(
            providerNetworkErrorMessage(dependency, error),
            dependency,
            response.status,
            attempt,
            isProviderTimeoutError(error),
            true
          );
        }
        await response.body?.cancel().catch(() => undefined);
        await wait(retryDelayMilliseconds(null, attempt));
      }
    } catch (error) {
      lastError = error;
      if (!isRetryableProviderError(error)) throw error;
      if (attempt === maxAttempts) {
        throw new SpeechDependencyError(
          providerNetworkErrorMessage(dependency, error),
          dependency,
          undefined,
          attempt,
          isProviderTimeoutError(error),
          true
        );
      }
      await wait(retryDelayMilliseconds(null, attempt));
    }
  }

  throw new SpeechDependencyError(
    lastError instanceof Error ? lastError.message : "Local-language speech provider is temporarily unavailable.",
    dependency,
    undefined,
    maxAttempts,
    isProviderTimeoutError(lastError),
    true
  );
}

function isRetryableProviderStatus(status: number): boolean {
  return RETRYABLE_PROVIDER_STATUSES.has(status);
}

function localSpeechMaxAttempts(): number {
  const configured = Number(process.env.LOCAL_SPEECH_MAX_ATTEMPTS);
  return Number.isSafeInteger(configured) && configured >= 1 && configured <= 5
    ? configured
    : LOCAL_SPEECH_MAX_ATTEMPTS;
}

function retryDelayMilliseconds(retryAfter: string | null, attempt: number): number {
  const seconds = Number(retryAfter);
  if (retryAfter !== null && Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1_000), LOCAL_SPEECH_MAX_RETRY_DELAY_MS);
  }
  if (retryAfter) {
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.min(Math.max(0, retryAt - Date.now()), LOCAL_SPEECH_MAX_RETRY_DELAY_MS);
    }
  }
  const configured = Number(process.env.LOCAL_SPEECH_RETRY_BASE_MS);
  const base = Number.isFinite(configured) && configured >= 0
    ? Math.min(Math.round(configured), LOCAL_SPEECH_MAX_RETRY_DELAY_MS)
    : LOCAL_SPEECH_RETRY_BASE_MS;
  return Math.min(base * (2 ** (attempt - 1)), LOCAL_SPEECH_MAX_RETRY_DELAY_MS);
}

function isRetryableProviderError(error: unknown): boolean {
  return error instanceof TypeError || isProviderTimeoutError(error);
}

function isProviderBodyLimitError(error: unknown): boolean {
  return error instanceof Error && /response exceeds the size limit/i.test(error.message);
}

function isProviderTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name?: unknown }).name ?? "") : "";
  return name === "TimeoutError" || name === "AbortError";
}

function providerNetworkErrorMessage(dependency: SpeechDependency, error: unknown): string {
  if (isProviderTimeoutError(error)) return `${speechDependencyLabel(dependency)} timed out.`;
  return `${speechDependencyLabel(dependency)} could not be reached.`;
}

function speechDependencyLabel(dependency: SpeechDependency): string {
  if (dependency === "google_translate") return "Google Translate";
  if (dependency === "khaya_translate") return "Khaya Translation";
  if (dependency === "gemini_tts") return "Gemini Text-to-Speech";
  return "Khaya Text-to-Speech";
}

function wait(milliseconds: number): Promise<void> {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

export const __localLanguageInternals = {
  splitForGoogleTranslation,
  splitForTranslation,
  translateEnglishToLocalLanguage,
  translateEnglishWithKhaya,
  synthesizeTranslatedText,
  languageAndSpeakerForLocalVoice,
  khayaPauseMilliseconds,
  parseSynthesisResponse,
  parseKhayaTranslationResponse,
  fetchSpeechDependencyWithRetry,
  retryDelayMilliseconds,
  shouldUseTwiFallback
};
