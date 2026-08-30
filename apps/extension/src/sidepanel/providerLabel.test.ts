import { describe, expect, it } from "vitest";
import { languageProviderLabel } from "./providerLabel";

describe("languageProviderLabel", () => {
  it("shows the selected English speech provider", () => {
    expect(languageProviderLabel("en", "google")).toBe("Google TTS");
    expect(languageProviderLabel("en", "cartesia")).toBe("Cartesia");
  });

  it("shows the complete local-language processing route", () => {
    expect(languageProviderLabel("tw", "google")).toBe("Google Translate + Khaya TTS");
    expect(languageProviderLabel("ee", "cartesia")).toBe("Google Translate + Khaya TTS");
    expect(languageProviderLabel("gaa", "cartesia")).toBe("Khaya Translate + Khaya TTS");
  });
});
