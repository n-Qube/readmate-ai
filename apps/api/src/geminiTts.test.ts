import { describe, expect, it, vi } from "vitest";
import { isWavAudio } from "./audio/wavAudio.js";
import { findAudioBlocks, geminiTtsModel, readingStyle, synthesizeGeminiSpeech } from "./geminiTts.js";
import { SpeechDependencyError } from "./localLanguage.js";

function wav(sampleValue: number, frames = 4): Buffer {
  const data = Buffer.alloc(frames * 2);
  for (let offset = 0; offset < data.length; offset += 2) data.writeInt16LE(sampleValue, offset);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24_000, 24);
  header.writeUInt32LE(48_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function audioResponse(audio: Buffer, status = 200): Response {
  return new Response(JSON.stringify({ status: "completed", steps: [{ content: [{ type: "audio", mime_type: "audio/wav", data: audio.toString("base64") }] }] }), { status });
}

const noSleep = async () => undefined;

describe("findAudioBlocks", () => {
  it("reads the SDK-style output_audio shortcut", () => {
    expect(findAudioBlocks({ output_audio: { data: "AAAA", mime_type: "audio/wav" } })).toEqual([{ data: "AAAA", mimeType: "audio/wav", sampleRate: undefined, channels: undefined }]);
  });

  it("reads audio blocks nested inside interaction steps in order", () => {
    const blocks = findAudioBlocks({ steps: [{ content: [{ type: "text", text: "ignored" }, { type: "audio", data: "AAAA" }] }, { content: [{ type: "audio", data: "BBBB" }] }] });
    expect(blocks.map((block) => block.data)).toEqual(["AAAA", "BBBB"]);
  });

  it("reads legacy generateContent inlineData audio", () => {
    const blocks = findAudioBlocks({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: "AAAA" } }] } }] });
    expect(blocks).toEqual([{ data: "AAAA", mimeType: "audio/L16;codec=pcm;rate=24000" }]);
  });

  it("ignores request echoes and usage metadata", () => {
    expect(findAudioBlocks({ input: [{ type: "audio", data: "ECHO" }], usage: { type: "audio", data: "NO" } })).toEqual([]);
  });
});

describe("synthesizeGeminiSpeech", () => {
  it("fails closed without calling Google when no API key is configured", async () => {
    const fetcher = vi.fn();
    await expect(synthesizeGeminiSpeech({ provider: "gemini", text: "Hello.", voice: "Kore", speed: 1 }, { apiKey: "", fetcher }))
      .rejects.toMatchObject({ dependency: "gemini_tts", retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("wraps headerless PCM audio in a playable WAV container", async () => {
    const pcm = Buffer.alloc(8, 1);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ output_audio: { data: pcm.toString("base64"), mime_type: "audio/l16", sample_rate: 24_000 } })));
    const audio = await synthesizeGeminiSpeech({ provider: "gemini-lite", text: "Hello.", voice: "Kore", speed: 1 }, { apiKey: "key", fetcher });

    expect(isWavAudio(audio)).toBe(true);
    expect(audio.readUInt32LE(24)).toBe(24_000);
    expect(audio.subarray(44)).toEqual(pcm);
  });

  it("splits long text, synthesizes sections concurrently, and merges them in reading order", async () => {
    const sentences = Array.from({ length: 120 }, (_, index) => `Sentence number ${index} explains the research finding clearly.`);
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const text = JSON.parse(String(init?.body)).input[0].content[0].text as string;
      expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(2_500);
      return audioResponse(wav(text.startsWith("Sentence number 0 ") ? 7 : 9));
    });
    const audio = await synthesizeGeminiSpeech({ provider: "gemini", text: sentences.join(" "), voice: "Kore", speed: 1 }, { apiKey: "key", fetcher });

    expect(fetcher.mock.calls.length).toBeGreaterThan(1);
    expect(isWavAudio(audio)).toBe(true);
    expect(audio.readInt16LE(44)).toBe(7);
  });

  it("retries a rate-limited section once and then succeeds", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 }))
      .mockResolvedValueOnce(audioResponse(wav(5)));
    const audio = await synthesizeGeminiSpeech({ provider: "gemini", text: "Hello.", voice: "Kore", speed: 1 }, { apiKey: "key", fetcher, sleep: noSleep });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(audio.equals(wav(5))).toBe(true);
  });

  it("does not retry a permanent request rejection or echo the provider body", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: "secret upstream detail" } }), { status: 400 }));
    const failure = synthesizeGeminiSpeech({ provider: "gemini", text: "Hello.", voice: "Kore", speed: 1 }, { apiKey: "key", fetcher, sleep: noSleep });

    await expect(failure).rejects.toBeInstanceOf(SpeechDependencyError);
    await expect(failure).rejects.toMatchObject({ upstreamStatus: 400, retryable: false });
    await expect(failure).rejects.not.toThrow(/secret upstream detail/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports a completed response without audio as a retryable provider failure", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: "completed", steps: [] })));
    await expect(synthesizeGeminiSpeech({ provider: "gemini", text: "Hello.", voice: "Kore", speed: 1 }, { apiKey: "key", fetcher, sleep: noSleep }))
      .rejects.toMatchObject({ dependency: "gemini_tts", retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("falls back to the default voice for names outside the Gemini catalogue", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => audioResponse(wav(1)));
    await synthesizeGeminiSpeech({ provider: "gemini", text: "Hello.", voice: "en-US-Neural2-F", speed: 1 }, { apiKey: "key", fetcher });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).generation_config.speech_config).toEqual([{ voice: "Kore" }]);
  });
});

describe("Gemini TTS configuration", () => {
  it("uses the Gemini 3.8 Flash and Flash-Lite TTS models by default", () => {
    expect(geminiTtsModel("gemini", {})).toBe("gemini-3.8-flash-tts");
    expect(geminiTtsModel("gemini-lite", {})).toBe("gemini-3.8-flash-lite-tts");
  });

  it("accepts a well-formed model override and ignores malformed ones", () => {
    expect(geminiTtsModel("gemini", { GEMINI_TTS_MODEL: "gemini-3.9-flash-tts" })).toBe("gemini-3.9-flash-tts");
    expect(geminiTtsModel("gemini-lite", { GEMINI_TTS_LITE_MODEL: "../models/evil" })).toBe("gemini-3.8-flash-lite-tts");
  });

  it("describes pace for server-rendered cast audio and keeps user tone on one line", () => {
    expect(readingStyle(undefined, 1)).toBe("Read aloud clearly and naturally, like a calm audiobook narrator.");
    expect(readingStyle("calm\nand clear", 1.5)).toBe("calm and clear Speak at a fast, brisk pace.");
    expect(readingStyle("", 0.8)).toContain("slightly slower");
  });
});
