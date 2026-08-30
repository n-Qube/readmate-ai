import type { UserSettings } from "@/types";

export type LocalLanguage = Exclude<UserSettings["targetLanguage"], "en">;

export type LocalVoiceOption = {
  id: string;
  label: string;
  language: LocalLanguage;
  previewText: string;
};

const speakerLabels = {
  male_low: "Lower male",
  male_high: "Higher male",
  female: "Female"
} as const;

const previewText = "Welcome to ReadMate. This voice will read your saved stories clearly and naturally.";

export const localVoiceOptions: LocalVoiceOption[] = [
  ...voiceSet("tw", "twi", "Asante Twi"),
  ...voiceSet("tw", "atw", "Akuapem Twi"),
  ...voiceSet("ee", "ewe", "Ewe"),
  ...voiceSet("gaa", "gaa", "Ga")
];

export function voicesForLanguage(language: LocalLanguage): LocalVoiceOption[] {
  return localVoiceOptions.filter((voice) => voice.language === language);
}

export function defaultVoiceForLanguage(language: LocalLanguage): string {
  return voicesForLanguage(language)[0]?.id ?? `khaya:${language}:male_low`;
}

export function localVoiceLabel(voiceId: string): string {
  if (voiceId === "ghananlp-akuapem-twi") return "Akuapem Twi · Lower male";
  if (voiceId === "ghananlp-asante-twi") return "Asante Twi · Lower male";
  return localVoiceOptions.find((voice) => voice.id === voiceId)?.label ?? "Khaya voice";
}

export function previewTextForVoice(voiceId: string): string {
  return localVoiceOptions.find((voice) => voice.id === voiceId)?.previewText ?? previewText;
}

function voiceSet(language: LocalLanguage, khayaLanguage: string, variety: string): LocalVoiceOption[] {
  return (Object.keys(speakerLabels) as Array<keyof typeof speakerLabels>).map((speaker) => ({
    id: `khaya:${khayaLanguage}:${speaker}`,
    label: `${variety} · ${speakerLabels[speaker]}`,
    language,
    previewText
  }));
}
