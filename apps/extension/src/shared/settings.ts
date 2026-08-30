import type { ExtensionSettings, TargetLanguage, TtsProvider } from "./types";

export const TTS_PROVIDERS = ["google", "cartesia"] as const satisfies readonly TtsProvider[];

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
  "cartesia-default": "Natural default",
  "ghananlp-akuapem-twi": "Akuapem Twi",
  "ghananlp-asante-twi": "Asante Twi",
  "ghananlp-twi": "Twi (default)"
};

export const DEFAULT_VOICE_BY_PROVIDER: Record<TtsProvider, string> = {
  google: "en-US-Neural2-F",
  cartesia: "cartesia-default"
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
  const provider = storedSettings?.ttsProvider === "cartesia" ? "cartesia" : "google";
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
  return provider === "cartesia" ? ["cartesia-default"] : GOOGLE_VOICES;
}

export function isVoiceSupported(provider: TtsProvider, voice: string): boolean {
  if (provider === "cartesia") return Boolean(voice.trim());
  return voicesForProvider(provider).includes(voice);
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
