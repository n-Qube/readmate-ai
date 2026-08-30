import { describe, expect, it } from "vitest";
import {
  __localLanguageInternals,
  localVoiceOptions,
  normalizeLocalLanguageVoice,
  SpeechDependencyError
} from "./localLanguage.js";

describe("local voice selection", () => {
  it("offers every Khaya speaker for Twi, Ewe, and Ga", () => {
    expect(localVoiceOptions("tw")).toHaveLength(6);
    expect(localVoiceOptions("ee")).toHaveLength(3);
    expect(localVoiceOptions("gaa")).toHaveLength(3);
  });

  it("maps a selected Ga speaker to the provider request", () => {
    expect(__localLanguageInternals.languageAndSpeakerForLocalVoice("gaa", "khaya:gaa:female"))
      .toEqual({ language: "gaa", speaker: "female" });
  });

  it("fails closed to a valid voice when a mismatched voice is supplied", () => {
    expect(normalizeLocalLanguageVoice("ee", "khaya:gaa:female")).toBe("khaya:ewe:male_low");
  });

  it("uses the offline Twi fallback only for Khaya speech dependencies", () => {
    expect(__localLanguageInternals.shouldUseTwiFallback(
      new SpeechDependencyError("quota", "khaya_tts", 429, 1)
    )).toBe(true);
    expect(__localLanguageInternals.shouldUseTwiFallback(
      new SpeechDependencyError("translation", "google_translate", 429, 1)
    )).toBe(false);
  });
});
