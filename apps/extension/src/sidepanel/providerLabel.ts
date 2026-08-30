import type { ExtensionSettings } from "../shared/types";

export function languageProviderLabel(
  language: ExtensionSettings["targetLanguage"],
  provider: ExtensionSettings["ttsProvider"]
): string {
  if (language === "en") return provider === "cartesia" ? "Cartesia" : "Google TTS";
  if (language === "gaa") return "Khaya Translate + Khaya TTS";
  return "Google Translate + Khaya TTS";
}
