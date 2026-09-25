import { describe, expect, it } from "vitest";
import { languageProviderLabel } from "./providerLabel";

describe("languageProviderLabel", () => {
  it("shows the selected English speech provider", () => {
    expect(languageProviderLabel("en", "google")).toBe("Google TTS");
    expect(languageProviderLabel("en", "gemini")).toBe("Gemini 3.8 Flash TTS");
    expect(languageProviderLabel("en", "gemini-lite")).toBe("Gemini 3.8 Flash-Lite TTS");
  });

  it("shows the complete local-language processing route", () => {
    expect(languageProviderLabel("tw", "google")).toBe("Google Translate + Khaya TTS");
    expect(languageProviderLabel("ee", "gemini")).toBe("Google Translate + Khaya TTS");
    expect(languageProviderLabel("gaa", "gemini")).toBe("Khaya Translate + Khaya TTS");
  });
});
