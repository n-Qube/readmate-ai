import { defaultVoiceForLanguage, voicesForLanguage } from "../config/local-voices";
import { DEFAULT_VOICE_BY_PROVIDER, isGeminiProvider, isGeminiVoice } from "../config/tts-providers";
import type { UserSettings } from "../types";

export const playerTargetLanguages = ["en", "tw", "ee", "gaa"] as const;
export const playerStartPositions = ["resume", "beginning"] as const;
const defaultEnglishVoice = "en-US-Neural2-F";
const googleEnglishVoices = new Set([
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
]);

export type PlayerTargetLanguage = (typeof playerTargetLanguages)[number];
export type PlayerStartPosition = (typeof playerStartPositions)[number];

type SearchParam = string | string[] | undefined;

export type PlayerDeepLink = {
  documentId?: string;
  targetLanguage?: PlayerTargetLanguage;
  startAt: PlayerStartPosition;
};

export function parsePlayerDeepLink(params: {
  documentId?: SearchParam;
  targetLanguage?: SearchParam;
  startAt?: SearchParam;
}): PlayerDeepLink {
  const documentId = firstParam(params.documentId)?.trim();
  const targetLanguage = enumParam(firstParam(params.targetLanguage), playerTargetLanguages);
  const startAt = enumParam(firstParam(params.startAt), playerStartPositions) ?? "resume";

  return {
    documentId: documentId || undefined,
    targetLanguage,
    startAt
  };
}

export function settingsForPlayerDeepLink(
  current: UserSettings,
  targetLanguage: PlayerTargetLanguage
): Omit<UserSettings, "userId" | "updatedAt"> | null {
  const voice = voiceForPlayerLanguage(current.provider, current.voice, targetLanguage);

  if (current.targetLanguage === targetLanguage && current.voice === voice) return null;

  const { userId: _userId, updatedAt: _updatedAt, ...editable } = current;
  return { ...editable, targetLanguage, voice };
}

export function voiceForPlayerLanguage(
  provider: UserSettings["provider"],
  currentVoice: string,
  targetLanguage: PlayerTargetLanguage
): string {
  if (voiceSupportsLanguage(provider, currentVoice, targetLanguage)) return currentVoice;
  return targetLanguage === "en"
    ? DEFAULT_VOICE_BY_PROVIDER[provider] ?? defaultEnglishVoice
    : defaultVoiceForLanguage(targetLanguage);
}

function voiceSupportsLanguage(provider: UserSettings["provider"], voice: string, targetLanguage: PlayerTargetLanguage): boolean {
  const normalized = voice.trim();
  if (!normalized) return false;
  if (targetLanguage === "en") {
    return isGeminiProvider(provider) ? isGeminiVoice(normalized) : googleEnglishVoices.has(normalized);
  }
  if (targetLanguage === "tw" && ["ghananlp-asante-twi", "ghananlp-akuapem-twi"].includes(normalized)) {
    return true;
  }
  return voicesForLanguage(targetLanguage).some((option) => option.id === normalized);
}

function firstParam(value: SearchParam): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function enumParam<const T extends readonly string[]>(value: string | undefined, allowed: T): T[number] | undefined {
  return value && (allowed as readonly string[]).includes(value) ? value as T[number] : undefined;
}
