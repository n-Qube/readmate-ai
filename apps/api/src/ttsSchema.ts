import { z } from "zod";
import { isLocalLanguage, normalizeLocalLanguageVoice, normalizeTargetLanguage, SUPPORTED_TARGET_LANGUAGES } from "./localLanguage.js";

export const TTS_PROVIDERS = ["google", "cartesia"] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];

export const GOOGLE_TTS_VOICES = [
  "en-US-Neural2-F",
  "en-US-Neural2-D",
  "en-US-Neural2-J",
  "en-US-Neural2-A",
  "en-US-Wavenet-F",
  "en-US-Wavenet-D",
  "en-US-Wavenet-C",
  "en-US-Wavenet-I",
  "en-US-Studio-O",
  "en-US-Studio-Q"
] as const;

export const DEFAULT_VOICE_BY_PROVIDER = {
  google: "en-US-Neural2-F",
  cartesia: "cartesia-default"
} as const satisfies Record<(typeof TTS_PROVIDERS)[number], string>;

export function isGoogleTtsVoice(voice: unknown): voice is (typeof GOOGLE_TTS_VOICES)[number] {
  return typeof voice === "string" && (GOOGLE_TTS_VOICES as readonly string[]).includes(voice);
}

export function normalizeGoogleTtsVoice(voice: unknown): (typeof GOOGLE_TTS_VOICES)[number] {
  return isGoogleTtsVoice(voice) ? voice : DEFAULT_VOICE_BY_PROVIDER.google;
}

export function normalizeTtsProvider(provider: unknown): TtsProvider {
  return provider === "cartesia" ? "cartesia" : "google";
}

export function normalizeTtsVoice(provider: TtsProvider, voice: unknown): string {
  if (provider === "cartesia") {
    const normalized = typeof voice === "string" ? voice.trim() : "";
    return normalized && !isGoogleTtsVoice(normalized) && !isLocalTtsVoice(normalized)
      ? normalized
      : DEFAULT_VOICE_BY_PROVIDER.cartesia;
  }
  return normalizeGoogleTtsVoice(voice);
}

function isLocalTtsVoice(voice: string): boolean {
  return voice.startsWith("khaya:") || voice.startsWith("ghananlp-");
}

export const ttsRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(36000),
    provider: z.unknown().optional(),
    voice: z.string().trim().min(1).optional(),
    instructions: z.string().trim().max(500).optional(),
    speed: z.number().min(0.75).max(2).default(1),
    targetLanguage: z.enum(SUPPORTED_TARGET_LANGUAGES).default("en")
  })
  .transform((payload, context) => {
    const provider = normalizeTtsProvider(payload.provider);
    const targetLanguage = normalizeTargetLanguage(payload.targetLanguage);
    const voice = isLocalLanguage(targetLanguage)
      ? normalizeLocalLanguageVoice(targetLanguage, payload.voice)
      : provider === "google" && payload.provider === "google" && payload.voice
        ? payload.voice
        : normalizeTtsVoice(provider, payload.voice);
    if (provider === "google" && !isLocalLanguage(targetLanguage) && !isGoogleTtsVoice(voice)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["voice"],
        message: `Unsupported ${provider} voice`
      });
      return z.NEVER;
    }
    return { ...payload, provider, targetLanguage, voice };
  });

export type TtsRequest = z.infer<typeof ttsRequestSchema>;

export function parseTtsRequest(input: unknown): TtsRequest {
  return ttsRequestSchema.parse(input);
}
