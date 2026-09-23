import { z } from "zod";
import { isLocalLanguage, normalizeLocalLanguageVoice, normalizeTargetLanguage, SUPPORTED_TARGET_LANGUAGES } from "./localLanguage.js";

/**
 * `gemini` is Gemini 3.8 Flash TTS (highest fidelity, Premium) and
 * `gemini-lite` is Gemini 3.8 Flash-Lite TTS (cost-efficient, all plans).
 */
export const TTS_PROVIDERS = ["google", "gemini", "gemini-lite"] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];
export type GeminiTtsProvider = Extract<TtsProvider, "gemini" | "gemini-lite">;

const PREMIUM_TTS_PROVIDERS: ReadonlySet<TtsProvider> = new Set(["gemini"]);

/** English voices from these providers are billed to ReadMate Premium. */
export function isPremiumTtsProvider(provider: TtsProvider): boolean {
  return PREMIUM_TTS_PROVIDERS.has(provider);
}

export function isGeminiTtsProvider(provider: unknown): provider is GeminiTtsProvider {
  return provider === "gemini" || provider === "gemini-lite";
}

/** Prebuilt Gemini speech voices; both 3.8 TTS models share this catalogue. */
export const GEMINI_TTS_VOICES = [
  "Kore",
  "Charon",
  "Aoede",
  "Puck",
  "Zephyr",
  "Fenrir",
  "Leda",
  "Orus",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat"
] as const;

const GEMINI_VOICE_DESCRIPTIONS: Record<(typeof GEMINI_TTS_VOICES)[number], string> = {
  Kore: "Firm",
  Charon: "Informative",
  Aoede: "Breezy",
  Puck: "Upbeat",
  Zephyr: "Bright",
  Fenrir: "Excitable",
  Leda: "Youthful",
  Orus: "Firm",
  Callirrhoe: "Easy-going",
  Autonoe: "Bright",
  Enceladus: "Breathy",
  Iapetus: "Clear",
  Umbriel: "Easy-going",
  Algieba: "Smooth",
  Despina: "Smooth",
  Erinome: "Clear",
  Algenib: "Gravelly",
  Rasalgethi: "Informative",
  Laomedeia: "Upbeat",
  Achernar: "Soft",
  Alnilam: "Firm",
  Schedar: "Even",
  Gacrux: "Mature",
  Pulcherrima: "Forward",
  Achird: "Friendly",
  Zubenelgenubi: "Casual",
  Vindemiatrix: "Gentle",
  Sadachbia: "Lively",
  Sadaltager: "Knowledgeable",
  Sulafat: "Warm"
};

export const GEMINI_TTS_VOICE_OPTIONS = GEMINI_TTS_VOICES.map((id) => ({
  id,
  name: id,
  description: GEMINI_VOICE_DESCRIPTIONS[id]
}));

export function isGeminiTtsVoice(voice: unknown): voice is (typeof GEMINI_TTS_VOICES)[number] {
  return typeof voice === "string" && (GEMINI_TTS_VOICES as readonly string[]).includes(voice);
}

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
  gemini: "Kore",
  "gemini-lite": "Kore"
} as const satisfies Record<(typeof TTS_PROVIDERS)[number], string>;

export function isGoogleTtsVoice(voice: unknown): voice is (typeof GOOGLE_TTS_VOICES)[number] {
  return typeof voice === "string" && (GOOGLE_TTS_VOICES as readonly string[]).includes(voice);
}

export function normalizeGoogleTtsVoice(voice: unknown): (typeof GOOGLE_TTS_VOICES)[number] {
  return isGoogleTtsVoice(voice) ? voice : DEFAULT_VOICE_BY_PROVIDER.google;
}

export function normalizeTtsProvider(provider: unknown): TtsProvider {
  if (isGeminiTtsProvider(provider)) return provider;
  // Cartesia was retired; keep its subscribers on the Premium natural-voice tier.
  if (provider === "cartesia") return "gemini";
  return "google";
}

export function normalizeTtsVoice(provider: TtsProvider, voice: unknown): string {
  if (isGeminiTtsProvider(provider)) {
    return isGeminiTtsVoice(voice) ? voice : DEFAULT_VOICE_BY_PROVIDER[provider];
  }
  return normalizeGoogleTtsVoice(voice);
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
