import type { UserSettings } from "../types";

export type TtsProvider = UserSettings["provider"];

export const TTS_PROVIDERS = ["google", "gemini-lite", "gemini"] as const satisfies readonly TtsProvider[];

export const DEFAULT_VOICE_BY_PROVIDER: Record<TtsProvider, string> = {
  google: "en-US-Neural2-F",
  "gemini-lite": "Kore",
  gemini: "Kore"
};

export const GOOGLE_VOICES = ["en-US-Neural2-F", "en-US-Neural2-D", "en-US-Neural2-J", "en-US-Studio-O"] as const;

/** Every prebuilt voice shared by Gemini 3.8 Flash TTS and Flash-Lite TTS. */
export const GEMINI_VOICE_IDS = [
  "Kore", "Charon", "Aoede", "Puck", "Zephyr", "Fenrir", "Leda", "Orus", "Callirrhoe", "Autonoe",
  "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"
] as const;

export function isGeminiVoice(voice: string): boolean {
  return (GEMINI_VOICE_IDS as readonly string[]).includes(voice);
}

/** A curated reading subset shown in the compact mobile picker. */
export const GEMINI_READING_VOICES = [
  { id: "Kore", name: "Kore", description: "Firm" },
  { id: "Charon", name: "Charon", description: "Informative" },
  { id: "Aoede", name: "Aoede", description: "Breezy" },
  { id: "Sulafat", name: "Sulafat", description: "Warm" },
  { id: "Achernar", name: "Achernar", description: "Soft" },
  { id: "Iapetus", name: "Iapetus", description: "Clear" },
  { id: "Sadaltager", name: "Sadaltager", description: "Knowledgeable" },
  { id: "Vindemiatrix", name: "Vindemiatrix", description: "Gentle" }
] as const;

export function isGeminiProvider(provider: TtsProvider): provider is "gemini" | "gemini-lite" {
  return provider === "gemini" || provider === "gemini-lite";
}

/** English voices from these providers require ReadMate Premium. */
export function isPremiumProvider(provider: TtsProvider): boolean {
  return provider === "gemini";
}

export function providerShortLabel(provider: TtsProvider): string {
  if (provider === "gemini") return "Gemini Flash";
  if (provider === "gemini-lite") return "Gemini Lite";
  return "Google";
}

export function providerLongLabel(provider: TtsProvider): string {
  if (provider === "gemini") return "Gemini 3.8 Flash TTS";
  if (provider === "gemini-lite") return "Gemini 3.8 Flash-Lite TTS";
  return "Google TTS";
}
