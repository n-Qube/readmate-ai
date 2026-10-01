import type { ExtensionSettings } from "../shared/types";

export function languageProviderLabel(
  language: ExtensionSettings["targetLanguage"],
  provider: ExtensionSettings["ttsProvider"]
): string {
  if (language === "en") {
    if (provider === "gemini") return "Gemini 3.8 Flash TTS";
    if (provider === "gemini-lite") return "Gemini 3.8 Flash-Lite TTS";
    return "Google TTS";
  }
  if (language === "gaa") return "Khaya Translate + Khaya TTS";
  return "Google Translate + Khaya TTS";
}
