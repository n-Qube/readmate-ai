import { describe, expect, it } from "vitest";
import { __wavAudioInternals, encodePcm16MonoWav, mergeWavAudioParts, normalizeSpeechPcm } from "./wavAudio.js";

describe("mergeWavAudioParts", () => {
  it("decodes WAV sections, inserts silence, and writes one valid WAV", () => {
    const merged = mergeWavAudioParts([testWav(100), testWav(200)], 100);
    const parsed = __wavAudioInternals.parseWav(merged);

    expect(merged.toString("ascii", 0, 4)).toBe("RIFF");
    expect(parsed.sampleRate).toBe(16_000);
    expect(parsed.data.length).toBe(8 + 3_200 + 8);
    expect(parsed.data.readInt16LE(0)).toBe(100);
    expect(parsed.data.readInt16LE(8)).toBe(0);
    expect(parsed.data.readInt16LE(parsed.data.length - 2)).toBe(200);
  });

  it("rejects byte-concatenated or non-WAV responses", () => {
    expect(() => mergeWavAudioParts([Buffer.from("not audio")])).toThrow("valid WAV");
  });

  it("encodes offline float samples as a valid mono PCM WAV", () => {
    const wav = encodePcm16MonoWav(new Float32Array([-1, -0.5, 0, 0.5, 1, Number.NaN]), 22_050);
    const parsed = __wavAudioInternals.parseWav(wav);

    expect(parsed.audioFormat).toBe(1);
    expect(parsed.channelCount).toBe(1);
    expect(parsed.sampleRate).toBe(22_050);
    expect(parsed.bitsPerSample).toBe(16);
    expect(parsed.data.readInt16LE(0)).toBe(-32_768);
    expect(parsed.data.readInt16LE(8)).toBe(32_767);
    expect(parsed.data.readInt16LE(10)).toBe(0);
  });

  it("raises quiet speech with a bounded gain and sanitizes invalid samples", () => {
    const normalized = normalizeSpeechPcm(new Float32Array([-0.2, 0.1, Number.NaN]));

    expect(normalized[0]).toBeCloseTo(-0.64, 5);
    expect(normalized[1]).toBeCloseTo(0.32, 5);
    expect(normalized[2]).toBe(0);
  });

  it("reduces an overly loud waveform to the speech target without clipping", () => {
    const normalized = normalizeSpeechPcm(new Float32Array([-0.95, 0.5]));

    expect(normalized[0]).toBeCloseTo(-0.82, 5);
    expect(Math.max(...normalized.map((sample) => Math.abs(sample)))).toBeLessThanOrEqual(0.82);
  });
});

function testWav(sample: number): Buffer {
  const data = Buffer.alloc(8);
  for (let offset = 0; offset < data.length; offset += 2) data.writeInt16LE(sample, offset);
  const wav = Buffer.alloc(44 + data.length);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + data.length, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16_000, 24);
  wav.writeUInt32LE(32_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(data.length, 40);
  data.copy(wav, 44);
  return wav;
}
