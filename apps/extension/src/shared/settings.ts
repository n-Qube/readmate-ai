import type { ExtensionSettings, TargetLanguage, TtsProvider } from "./types";

export const TTS_PROVIDERS = ["google", "gemini-lite", "gemini"] as const satisfies readonly TtsProvider[];

export const PROVIDER_LABELS: Record<TtsProvider, string> = {
  google: "Google TTS",
  "gemini-lite": "Gemini Flash-Lite",
  gemini: "Gemini Flash · Premium"
};

/** English voices from these providers require ReadMate Premium. */
export function isPremiumProvider(provider: TtsProvider): boolean {
  return provider === "gemini";
}

const GEMINI_VOICE_STYLES = {
  Kore: "Firm", Charon: "Informative", Aoede: "Breezy", Puck: "Upbeat", Zephyr: "Bright",
  Fenrir: "Excitable", Leda: "Youthful", Orus: "Firm", Callirrhoe: "Easy-going", Autonoe: "Bright",
  Enceladus: "Breathy", Iapetus: "Clear", Umbriel: "Easy-going", Algieba: "Smooth", Despina: "Smooth",
  Erinome: "Clear", Algenib: "Gravelly", Rasalgethi: "Informative", Laomedeia: "Upbeat", Achernar: "Soft",
  Alnilam: "Firm", Schedar: "Even", Gacrux: "Mature", Pulcherrima: "Forward", Achird: "Friendly",
  Zubenelgenubi: "Casual", Vindemiatrix: "Gentle", Sadachbia: "Lively", Sadaltager: "Knowledgeable", Sulafat: "Warm"
} as const;

export const GEMINI_VOICES = Object.keys(GEMINI_VOICE_STYLES) as Array<keyof typeof GEMINI_VOICE_STYLES>;

export const GOOGLE_VOICES = [
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

const GHANANLP_TWI_VOICES = ["ghananlp-akuapem-twi", "ghananlp-asante-twi"] as const;

export const VOICE_LABELS: Record<string, string> = {
  "en-US-Neural2-F": "Google Neural2 F",
  "en-US-Neural2-D": "Google Neural2 D",
  "en-US-Neural2-J": "Google Neural2 J",
  "en-US-Neural2-A": "Google Neural2 A",
  "en-US-Wavenet-F": "Google WaveNet F",
  "en-US-Wavenet-D": "Google WaveNet D",
  "en-US-Wavenet-C": "Google WaveNet C",
  "en-US-Wavenet-I": "Google WaveNet I",
  "en-US-Studio-O": "Google Studio O",
  "en-US-Studio-Q": "Google Studio Q",
  "ghananlp-akuapem-twi": "Akuapem Twi",
  "ghananlp-asante-twi": "Asante Twi",
  "ghananlp-twi": "Twi (default)",
  ...Object.fromEntries(GEMINI_VOICES.map((voice) => [voice, `${voice} · ${GEMINI_VOICE_STYLES[voice]}`]))
};

export const DEFAULT_VOICE_BY_PROVIDER: Record<TtsProvider, string> = {
  google: "en-US-Neural2-F",
  gemini: "Kore",
  "gemini-lite": "Kore"
};

export const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
export const TARGET_LANGUAGES = ["en", "tw", "ee", "gaa"] as const satisfies readonly TargetLanguage[];

export const DEFAULT_SETTINGS: ExtensionSettings = {
  ttsProvider: "google",
  voice: "en-US-Neural2-F",
  speed: 1,
  instructions: "calm and clear",
  targetLanguage: "en",
  autoScroll: true,
  highlightMode: "sentence",
  preferredContentTypes: ["webpage", "pdf", "rss", "url"],
  apiBaseUrl: import.meta.env.VITE_READMATE_API_URL ?? "http://localhost:8787"
};

export async function loadSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.sync.get("settings");
  const storedSettings = result.settings as Partial<ExtensionSettings> | undefined;
  const provider = normalizeTtsProvider(storedSettings?.ttsProvider);
  const settings: ExtensionSettings = { ...DEFAULT_SETTINGS, ...storedSettings, ttsProvider: provider };
  const normalizedSettings = {
    ...settings,
    apiBaseUrl: normalizeApiBaseUrl(settings.apiBaseUrl),
    targetLanguage: isTargetLanguage(settings.targetLanguage) ? settings.targetLanguage : "en",
    voice: normalizeVoiceForLanguage(settings.targetLanguage, provider, settings.voice)
  };
  if (normalizedSettings.apiBaseUrl !== storedSettings?.apiBaseUrl) {
    await saveSettings(normalizedSettings);
  }
  return normalizedSettings;
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.sync.set({
    settings: {
      ...settings,
      ttsProvider: settings.ttsProvider,
      targetLanguage: isTargetLanguage(settings.targetLanguage) ? settings.targetLanguage : "en",
      voice: normalizeVoiceForLanguage(settings.targetLanguage, settings.ttsProvider, settings.voice)
    }
  });
}

export function voicesForProvider(provider: TtsProvider): readonly string[] {
  return provider === "google" ? GOOGLE_VOICES : GEMINI_VOICES;
}

export function isVoiceSupported(provider: TtsProvider, voice: string): boolean {
  return voicesForProvider(provider).includes(voice);
}

/** Cartesia was retired; its stored selections continue on Gemini Flash TTS. */
export function normalizeTtsProvider(value: unknown): TtsProvider {
  if (value === "gemini" || value === "gemini-lite") return value;
  if (value === "cartesia") return "gemini";
  return "google";
}

export function isTargetLanguage(value: unknown): value is TargetLanguage {
  return typeof value === "string" && (TARGET_LANGUAGES as readonly string[]).includes(value);
}

function normalizeVoiceForLanguage(targetLanguage: TargetLanguage, provider: TtsProvider, voice: string): string {
  if (targetLanguage === "tw") {
    return (GHANANLP_TWI_VOICES as readonly string[]).includes(voice) ? voice : "ghananlp-asante-twi";
  }
  return isVoiceSupported(provider, voice) ? voice : DEFAULT_VOICE_BY_PROVIDER[provider];
}

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  const configuredApiBaseUrl = (import.meta.env.VITE_READMATE_API_URL as string | undefined)?.trim();
  if (!configuredApiBaseUrl) return apiBaseUrl;
  return configuredApiBaseUrl.replace(/\/+$/, "");
}
