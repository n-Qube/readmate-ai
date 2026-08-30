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

  it("accepts Cartesia with a server-configured default voice", () => {
    expect(parseTtsRequest({
      text: "Read this naturally.",
      provider: "cartesia"
    })).toEqual({
      text: "Read this naturally.",
      provider: "cartesia",
      voice: "cartesia-default",
      targetLanguage: "en",
      speed: 1
    });
  });

  it("preserves an explicit Cartesia voice id", () => {
    expect(parseTtsRequest({
      text: "Read this naturally.",
      provider: "cartesia",
      voice: "voice_123"
    })).toMatchObject({ provider: "cartesia", voice: "voice_123" });
  });

  it("replaces a Google voice paired with Cartesia", () => {
    expect(parseTtsRequest({
      text: "Read this naturally.",
      provider: "cartesia",
      voice: "en-US-Neural2-J"
    })).toMatchObject({ provider: "cartesia", voice: "cartesia-default" });
  });

  it.each(["khaya:ewe:female", "ghananlp-asante-twi"])(
    "replaces local-language voice %s when paired with English Cartesia",
    (voice) => {
      expect(parseTtsRequest({
        text: "Read this naturally.",
        provider: "cartesia",
        targetLanguage: "en",
        voice
      })).toMatchObject({ provider: "cartesia", targetLanguage: "en", voice: "cartesia-default" });
    }
  );

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
