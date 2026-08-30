import { afterEach, describe, expect, it } from "vitest";
import { applyPronunciationDictionary, normalizeSpeechInput, splitSpeechSections } from "./speechText.js";

const originalDictionary = process.env.PRONUNCIATION_DICTIONARY_JSON;

afterEach(() => {
  if (originalDictionary === undefined) delete process.env.PRONUNCIATION_DICTIONARY_JSON;
  else process.env.PRONUNCIATION_DICTIONARY_JSON = originalDictionary;
});

describe("speech text preparation", () => {
  it("normalizes URLs, abbreviations, numbers, symbols, and punctuation before translation", () => {
    expect(normalizeSpeechInput("Dr. Nkrumah shared https://readmate.ai/docs — 25% complete."))
      .toBe("Doctor Nkrumah shared readmate dot ai slash docs, twenty five percent complete.");
  });

  it("splits at sentence boundaries before falling back to clauses", () => {
    const sections = splitSpeechSections("First sentence is complete. Second sentence is also complete! Third sentence ends here?", 42);
    expect(sections).toEqual([
      "First sentence is complete.",
      "Second sentence is also complete!",
      "Third sentence ends here?"
    ]);
  });

  it("supports a configurable per-language pronunciation dictionary", () => {
    process.env.PRONUNCIATION_DICTIONARY_JSON = JSON.stringify({ gaa: { Odododiodio: "Oh doh doh dee oh dee oh" } });
    expect(applyPronunciationDictionary("Odododiodio and Nkrumah", "gaa"))
      .toBe("Oh doh doh dee oh dee oh and En kru mah");
  });
});
