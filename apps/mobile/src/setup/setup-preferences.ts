import { isGeminiVoice } from "../config/tts-providers";
import { deviceStorage } from "../storage/device-storage";
import type { ReadingDocument, UserSettings } from "../types";

/**
 * First-run setup happens before sign-in, so the choices are parked on the
 * device and applied to the account the first time the user reaches the app.
 */
export const SETUP_PREFERENCES_STORAGE_KEY = "readmate.setup.preferences.v1";

export const SETUP_SPEEDS = [1, 1.25, 1.5, 2] as const;

export const SETUP_CONTENT_TYPES = [
  { id: "webpage", label: "Web articles" },
  { id: "pdf", label: "PDFs" },
  { id: "rss", label: "News feeds" },
  { id: "url", label: "Saved links" }
] as const satisfies readonly { id: ReadingDocument["sourceType"]; label: string }[];

export type SetupPreferences = {
  voice: string;
  speed: number;
  preferredContentTypes: ReadingDocument["sourceType"][];
};

type EditableSettings = Omit<UserSettings, "userId" | "updatedAt">;

const allowedContentTypes = new Set<string>(SETUP_CONTENT_TYPES.map((item) => item.id));

export function parseSetupPreferences(raw: string | null): SetupPreferences | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SetupPreferences>;
    if (typeof value.voice !== "string" || !isGeminiVoice(value.voice)) return null;
    if (typeof value.speed !== "number" || !(SETUP_SPEEDS as readonly number[]).includes(value.speed)) return null;
    const types = Array.isArray(value.preferredContentTypes)
      ? value.preferredContentTypes.filter((item): item is ReadingDocument["sourceType"] => typeof item === "string" && allowedContentTypes.has(item))
      : [];
    return { voice: value.voice, speed: value.speed, preferredContentTypes: types };
  } catch {
    return null;
  }
}

/** Setup voices are Gemini Flash-Lite voices, which every plan can use. */
export function applySetupPreferences(settings: EditableSettings, preferences: SetupPreferences): EditableSettings {
  return {
    ...settings,
    provider: "gemini-lite",
    voice: preferences.voice,
    speed: preferences.speed,
    preferredContentTypes: preferences.preferredContentTypes.length ? preferences.preferredContentTypes : settings.preferredContentTypes
  };
}

export async function saveSetupPreferences(preferences: SetupPreferences): Promise<void> {
  await deviceStorage.setItem(SETUP_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

export async function loadSetupPreferences(): Promise<SetupPreferences | null> {
  return parseSetupPreferences(await deviceStorage.getItem(SETUP_PREFERENCES_STORAGE_KEY));
}

export async function clearSetupPreferences(): Promise<void> {
  await deviceStorage.removeItem(SETUP_PREFERENCES_STORAGE_KEY);
}
