import { describe, expect, it } from "vitest";
import { parseTtsRequest } from "./ttsSchema.js";

describe("parseTtsRequest", () => {
  it("defaults to the currently verified Google provider", () => {
    const request = parseTtsRequest({
      text: "Read this aloud."
    });

    expect(request).toEqual({
      text: "Read this aloud.",
      provider: "google",
      voice: "en-US-Neural2-F",
      targetLanguage: "en",
      speed: 1
    });
  });

  it("normalizes legacy provider requests to the Google default voice", () => {
    const request = parseTtsRequest({
      text: "Read this aloud.",
      provider: "legacy-provider",
      voice: "legacy-voice",
      instructions: "calm and clear",
      speed: 1.25
    });

    expect(request).toEqual({
      text: "Read this aloud.",
      provider: "google",
      voice: "en-US-Neural2-F",
      instructions: "calm and clear",
      targetLanguage: "en",
      speed: 1.25
    });
  });

  it("accepts supported Google voices", () => {
    const request = parseTtsRequest({
      text: "Read this aloud.",
      provider: "google",
      voice: "en-US-Neural2-F",
      speed: 1
    });

    expect(request).toEqual({
      text: "Read this aloud.",
      provider: "google",
      voice: "en-US-Neural2-F",
      targetLanguage: "en",
      speed: 1
    });
  });

  it.each(["gemini", "gemini-lite"] as const)("accepts %s with its default Gemini voice", (provider) => {
    expect(parseTtsRequest({
      text: "Read this naturally.",
      provider
    })).toEqual({
      text: "Read this naturally.",
      provider,
      voice: "Kore",
      targetLanguage: "en",
      speed: 1
    });
  });

  it("preserves a supported Gemini prebuilt voice", () => {
    expect(parseTtsRequest({
      text: "Read this naturally.",
      provider: "gemini-lite",
      voice: "Sulafat"
    })).toMatchObject({ provider: "gemini-lite", voice: "Sulafat" });
  });

  it.each(["en-US-Neural2-J", "voice_123", "khaya:ewe:female", "ghananlp-asante-twi"])(
    "replaces unsupported voice %s paired with English Gemini",
    (voice) => {
      expect(parseTtsRequest({
        text: "Read this naturally.",
        provider: "gemini",
        targetLanguage: "en",
        voice
      })).toMatchObject({ provider: "gemini", targetLanguage: "en", voice: "Kore" });
    }
  );

  it("migrates retired Cartesia requests to Gemini Flash TTS", () => {
    expect(parseTtsRequest({
      text: "Read this naturally.",
      provider: "cartesia",
      voice: "cartesia-default"
    })).toMatchObject({ provider: "gemini", voice: "Kore" });
  });

  it("keeps a Gemini voice chosen by an older client that still sends Cartesia", () => {
    expect(parseTtsRequest({
      text: "Read this naturally.",
      provider: "cartesia",
      voice: "Charon"
    })).toMatchObject({ provider: "gemini", voice: "Charon" });
  });

  it("accepts the verified local languages for translation and Khaya TTS v2", () => {
    expect(
      parseTtsRequest({
        text: "Read this aloud.",
        targetLanguage: "tw"
      })
    ).toMatchObject({
      provider: "google",
      targetLanguage: "tw"
    });

    expect(
      parseTtsRequest({
        text: "Read this aloud.",
        targetLanguage: "gaa"
      })
    ).toMatchObject({
      provider: "google",
      targetLanguage: "gaa"
    });
  });

  it("rejects unsupported voices", () => {
    expect(() =>
      parseTtsRequest({
        text: "Read this aloud.",
        provider: "google",
        voice: "unknown",
        speed: 1
      })
    ).toThrow(/Unsupported google voice/);
  });
});
