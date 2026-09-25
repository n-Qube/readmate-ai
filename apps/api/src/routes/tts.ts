import type { Response, Router } from "express";
import { Router as createRouter } from "express";
import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { fetchWithTimeout } from "../fetchWithTimeout.js";
import { getGoogleAccessToken, resetGoogleTokenCacheForTests } from "../googleAuth.js";
import { isLocalLanguage, SpeechDependencyError, synthesizeLocalLanguageSpeech } from "../localLanguage.js";
import { nanoTwiConfigured, synthesizeNanoTwiSpeech } from "../nanoTwi.js";
import { DEFAULT_VOICE_BY_PROVIDER, GEMINI_TTS_VOICE_OPTIONS, isGeminiTtsProvider, isPremiumTtsProvider, parseTtsRequest, type TtsProvider } from "../ttsSchema.js";
import { synthesizeGeminiSpeech } from "../geminiTts.js";
import { splitTextForSpeech } from "../speechChunks.js";
import { getUserId, type AuthedRequest } from "../auth.js";
import {
  consumeDailyUsage,
  DEFAULT_TTS_DAILY_CHAR_LIMIT,
  UsageLimitError,
  usageLimitFromEnv
} from "../usageQuota.js";
import { getMediaBucket, getSupabaseAdminClient } from "../storage.js";
import { databaseUnavailableCode, isDatabaseUnavailableError } from "../databaseErrors.js";
import { entitlementForRequest, PremiumRequiredError, requirePremiumAudio, type MaybePromise, type ReadMateEntitlement } from "../entitlements.js";

const GOOGLE_TTS_TEXT_BYTE_LIMIT = 4_500;

type TtsRouterDeps = {
  consumeUsage?: typeof consumeDailyUsage;
  createCastUrl?: (userId: string, speech: Awaited<ReturnType<typeof synthesizeSpeech>>, cacheKey: string) => Promise<string>;
  getEntitlement?: (req: AuthedRequest, userId: string) => MaybePromise<ReadMateEntitlement>;
};

export function ttsRouter(deps: TtsRouterDeps = {}): Router {
  const router = createRouter();
  const consumeUsage = deps.consumeUsage ?? consumeDailyUsage;
  const createCastUrl = deps.createCastUrl ?? createSecureCastUrl;
  const getEntitlement = deps.getEntitlement ?? entitlementForRequest;

  // Static catalogue; older app builds also read it for their natural-voice picker.
  router.get("/voices", (_req: AuthedRequest, res: Response) => {
    res.json({ voices: GEMINI_TTS_VOICE_OPTIONS });
  });

  router.post("/", async (req: AuthedRequest, res: Response) => {
    try {
      const payload = parseTtsRequest(req.body);
      const userId = getUserId(req);
      const entitlement = await getEntitlement(req, userId);
      if (payload.targetLanguage === "en" && isPremiumTtsProvider(payload.provider)) requirePremiumAudio(entitlement);
      await consumeUsage(
        userId,
        "tts_input_chars",
        payload.text.length,
        Math.min(usageLimitFromEnv("TTS_DAILY_CHAR_LIMIT", DEFAULT_TTS_DAILY_CHAR_LIMIT), entitlement.limits.dailyTtsCharacters)
      );
      const speech = await synthesizeSpeech(payload);
      res.setHeader("Content-Type", speech.contentType);
      res.setHeader("X-ReadMate-TTS-Provider", speech.provider);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.send(speech.buffer);
    } catch (error) {
      const status = ttsErrorStatus(error);
      logTtsFailure(error, status, req.body);
      if (status === 503) res.setHeader("Retry-After", "2");
      res.status(status).json(ttsErrorResponse(error));
    }
  });

  router.post("/cast", async (req: AuthedRequest, res: Response) => {
    try {
      const payload = parseTtsRequest(req.body);
      const userId = getUserId(req);
      const entitlement = await getEntitlement(req, userId);
      if (payload.targetLanguage === "en" && isPremiumTtsProvider(payload.provider)) requirePremiumAudio(entitlement);
      await consumeUsage(
        userId,
        "tts_input_chars",
        payload.text.length,
        Math.min(usageLimitFromEnv("TTS_DAILY_CHAR_LIMIT", DEFAULT_TTS_DAILY_CHAR_LIMIT), entitlement.limits.dailyTtsCharacters)
      );
      const speech = await synthesizeSpeech(payload);
      const cacheKey = createHash("sha256")
        .update(JSON.stringify({ text: payload.text, provider: payload.provider, voice: payload.voice, speed: payload.speed, targetLanguage: payload.targetLanguage }))
        .digest("hex");
      res.json({ url: await createCastUrl(userId, speech, cacheKey), expiresInSeconds: 600 });
    } catch (error) {
      const status = ttsErrorStatus(error);
      logTtsFailure(error, status, req.body);
      if (status === 503) res.setHeader("Retry-After", "2");
      res.status(status).json(ttsErrorResponse(error));
    }
  });

  return router;
}

async function synthesizeSpeech(payload: ReturnType<typeof parseTtsRequest>): Promise<{ buffer: Buffer; contentType: string; provider: TtsProvider | "ghananlp" | "nano-twi" }> {
  if (isLocalLanguage(payload.targetLanguage)) {
    const speech = await synthesizeLocalLanguageSpeech({
      text: payload.text,
      targetLanguage: payload.targetLanguage,
      speed: payload.speed,
      voice: payload.voice,
      twiFallback: nanoTwiConfigured() ? synthesizeNanoTwiSpeech : undefined,
      preferTwiFallback: process.env.TWI_TTS_PROVIDER?.trim() === "nano-twi"
    });
    return speech;
  }
  if (isGeminiTtsProvider(payload.provider)) {
    try {
      return {
        buffer: await synthesizeGeminiSpeech({
          provider: payload.provider,
          text: payload.text,
          voice: payload.voice,
          speed: payload.speed,
          instructions: payload.instructions
        }),
        contentType: "audio/wav",
        provider: payload.provider
      };
    } catch (error) {
      if (!(error instanceof SpeechDependencyError) || error.dependency !== "gemini_tts") throw error;
      // Keep playback working when Gemini is rate limited, over quota, or down:
      // answer with the standard Google voice and say so in the provider header.
      console.warn(JSON.stringify({
        event: "tts_provider_fallback",
        from: payload.provider,
        to: "google",
        upstreamStatus: error.upstreamStatus,
        timedOut: error.timedOut
      }));
      return {
        buffer: await synthesizeWithGoogle({ ...payload, provider: "google", voice: DEFAULT_VOICE_BY_PROVIDER.google }),
        contentType: "audio/mpeg",
        provider: "google"
      };
    }
  }
  return {
    buffer: await synthesizeWithGoogle(payload),
    contentType: "audio/mpeg",
    provider: "google"
  };
}

async function synthesizeWithGoogle(payload: ReturnType<typeof parseTtsRequest>): Promise<Buffer> {
  const textParts = splitTextForGoogleTts(payload.text);
  const buffers: Buffer[] = [];
  for (const text of textParts) {
    buffers.push(await synthesizeGoogleTextPart({ ...payload, text }));
  }
  return Buffer.concat(buffers);
}

async function synthesizeGoogleTextPart(payload: ReturnType<typeof parseTtsRequest>): Promise<Buffer> {
  const endpoint = new URL("https://texttospeech.googleapis.com/v1/text:synthesize");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.GOOGLE_TTS_API_KEY) {
    endpoint.searchParams.set("key", process.env.GOOGLE_TTS_API_KEY);
  } else {
    headers.Authorization = `Bearer ${await getGoogleAccessToken()}`;
  }

  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      input: { text: payload.text },
      voice: {
        languageCode: languageCodeFromGoogleVoice(payload.voice),
        name: payload.voice
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: payload.speed
      }
    })
  });
  const responseBody = await response.text();
  if (!response.ok) throw new Error(responseBody);

  const parsed = JSON.parse(responseBody) as { audioContent?: string };
  if (!parsed.audioContent) throw new Error("Google TTS did not return audio content.");
  return Buffer.from(parsed.audioContent, "base64");
}

function splitTextForGoogleTts(text: string): string[] {
  return splitTextForSpeech(text, GOOGLE_TTS_TEXT_BYTE_LIMIT);
}

function languageCodeFromGoogleVoice(voice: string): string {
  const match = voice.match(/^([a-z]{2}-[A-Z]{2})-/);
  return match?.[1] ?? "en-US";
}

function ttsErrorStatus(error: unknown): number {
  if (error instanceof ZodError) return 400;
  if (error instanceof PremiumRequiredError) return error.statusCode;
  if (error instanceof UsageLimitError) return error.statusCode;
  if (isDatabaseUnavailableError(error)) return 503;
  if (error instanceof SpeechDependencyError) {
    if (error.timedOut || error.upstreamStatus === 408 || error.upstreamStatus === 504) return 504;
    return error.retryable ? 503 : 502;
  }
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) return 504;
  const message = privateTtsErrorMessage(error);
  if (/credentials|subscription key|access denied|quota|billing|Google TTS|Google Translate|Text-to-Speech|Cloud Translation|Khaya|translation failed|Unable to authenticate/i.test(message)) {
    return 503;
  }
  return 500;
}

function logTtsFailure(error: unknown, status: number, body: unknown): void {
  const request = body && typeof body === "object" ? body as Record<string, unknown> : {};
  console.error(JSON.stringify({
    event: "tts_request_failed",
    status,
    provider: typeof request.provider === "string" ? request.provider : undefined,
    targetLanguage: typeof request.targetLanguage === "string" ? request.targetLanguage : undefined,
    databaseCode: databaseUnavailableCode(error),
    dependency: error instanceof SpeechDependencyError ? error.dependency : undefined,
    upstreamStatus: error instanceof SpeechDependencyError ? error.upstreamStatus : undefined,
    attempts: error instanceof SpeechDependencyError ? error.attempts : undefined,
    retryable: error instanceof SpeechDependencyError ? error.retryable : undefined,
    errorName: error instanceof Error ? error.name : "UnknownError"
  }));
}

function ttsErrorMessage(error: unknown): string {
  if (error instanceof ZodError) return "Invalid text-to-speech request.";
  if (error instanceof PremiumRequiredError) return error.message;
  if (error instanceof UsageLimitError) return "Daily text-to-speech limit reached.";
  const status = ttsErrorStatus(error);
  if (status === 504) return "Text-to-speech provider timed out.";
  if (status === 503) return "Text-to-speech is temporarily unavailable.";
  if (status === 502) return "Text-to-speech provider could not complete the request.";
  return "Unable to generate speech.";
}

function ttsErrorResponse(error: unknown): { error: string; code?: string; feature?: string } {
  if (error instanceof PremiumRequiredError) return { error: error.message, code: error.code, feature: error.feature };
  return { error: ttsErrorMessage(error) };
}

function privateTtsErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  try {
    const parsed = JSON.parse(message) as { error?: { message?: string }; message?: string };
    return parsed.error?.message ?? parsed.message ?? message;
  } catch {
    return message;
  }
}

async function createSecureCastUrl(
  userId: string,
  speech: Awaited<ReturnType<typeof synthesizeSpeech>>,
  cacheKey: string
): Promise<string> {
  const storage = getSupabaseAdminClient().storage.from(getMediaBucket());
  const extension = speech.contentType === "audio/wav" || speech.contentType === "audio/x-wav" ? "wav" : "mp3";
  const storageKey = `${userId}/cast/${cacheKey}.${extension}`;
  const uploaded = await storage.upload(storageKey, speech.buffer, { contentType: speech.contentType, upsert: true });
  if (uploaded.error) throw new Error("Unable to prepare secure cast audio.");
  const signed = await storage.createSignedUrl(storageKey, 600);
  const url = signed.data?.signedUrl;
  if (signed.error || !url || !url.startsWith("https://")) throw new Error("Unable to prepare secure cast audio.");
  return url;
}

export const __ttsInternals = {
  getGoogleAccessToken,
  synthesizeSpeech,
  synthesizeWithGoogle,
  splitTextForGoogleTts,
  resetGoogleTokenCacheForTests
};
