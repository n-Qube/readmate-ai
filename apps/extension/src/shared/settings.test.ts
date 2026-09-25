import { afterEach, describe, expect, it, vi } from "vitest";
import { isPremiumProvider, isTargetLanguage, isVoiceSupported, loadSettings, normalizeTtsProvider, TARGET_LANGUAGES, voicesForProvider } from "./settings";

describe("target language settings", () => {
  it("exposes Ga using the Khaya ISO 639-3 code", () => {
    expect(TARGET_LANGUAGES).toContain("gaa");
    expect(isTargetLanguage("gaa")).toBe(true);
  });

  it("continues to reject unknown target languages", () => {
    expect(isTargetLanguage("ga")).toBe(false);
  });
});

describe("configured API origin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    ["a stale staging origin", "https://staging-api.readmate.example"],
    ["an arbitrary synced origin", "https://untrusted.example"],
  ])("replaces %s before authenticated requests can use it", async (_label, storedApiBaseUrl) => {
    const configuredApiBaseUrl = "https://api.readmate.example";
    const set = vi.fn().mockResolvedValue(undefined);
    vi.stubEnv("VITE_READMATE_API_URL", `${configuredApiBaseUrl}/`);
    vi.stubGlobal("chrome", {
      storage: {
        sync: {
          get: vi.fn().mockResolvedValue({ settings: { apiBaseUrl: storedApiBaseUrl } }),
          set,
        },
      },
    });

    const settings = await loadSettings();

    expect(settings.apiBaseUrl).toBe(configuredApiBaseUrl);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ apiBaseUrl: configuredApiBaseUrl }),
    }));
  });
});

describe("speech providers", () => {
  it("migrates the retired Cartesia provider to Gemini Flash TTS", () => {
    expect(normalizeTtsProvider("cartesia")).toBe("gemini");
    expect(normalizeTtsProvider("gemini-lite")).toBe("gemini-lite");
    expect(normalizeTtsProvider("something-else")).toBe("google");
  });

  it("offers the Gemini voice catalogue for both Gemini tiers and gates only Flash", () => {
    expect(voicesForProvider("gemini")).toHaveLength(30);
    expect(isVoiceSupported("gemini-lite", "Kore")).toBe(true);
    expect(isVoiceSupported("gemini", "en-US-Neural2-F")).toBe(false);
    expect(isPremiumProvider("gemini")).toBe(true);
    expect(isPremiumProvider("gemini-lite")).toBe(false);
    expect(isPremiumProvider("google")).toBe(false);
  });
});
