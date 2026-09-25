type ParsedWav = {
  formatChunk: Buffer;
  audioFormat: number;
  channelCount: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  data: Buffer;
};

export function mergeWavAudioParts(parts: Buffer[], pauseMilliseconds = 180): Buffer {
  if (!parts.length) throw new Error("No WAV audio was returned.");
  const parsed = parts.map(parseWav);
  const reference = parsed[0];

  for (const part of parsed.slice(1)) {
    if (
      part.audioFormat !== reference.audioFormat ||
      part.channelCount !== reference.channelCount ||
      part.sampleRate !== reference.sampleRate ||
      part.blockAlign !== reference.blockAlign ||
      part.bitsPerSample !== reference.bitsPerSample
    ) {
      throw new Error("Speech provider returned WAV sections with incompatible audio formats.");
    }
  }

  const pause = silenceFor(reference, pauseMilliseconds);
  const dataParts: Buffer[] = [];
  parsed.forEach((part, index) => {
    if (index > 0 && pause.length) dataParts.push(pause);
    dataParts.push(part.data);
  });
  return encodeWav(reference.formatChunk, Buffer.concat(dataParts));
}

export function isWavAudio(buffer: Buffer): boolean {
  return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE";
}

export function normalizeSpeechPcm(samples: Float32Array): Float32Array {
  let peak = 0;
  for (const sample of samples) {
    if (Number.isFinite(sample)) peak = Math.max(peak, Math.abs(sample));
  }

  const targetPeak = 0.82;
  const maximumGain = 3.2;
  const gain = peak > 0 ? Math.min(maximumGain, targetPeak / peak) : 1;
  const normalized = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Number.isFinite(samples[index]) ? samples[index] : 0;
    normalized[index] = Math.max(-1, Math.min(1, sample * gain));
  }
  return normalized;
}

export function encodePcm16MonoWav(samples: Float32Array, sampleRate: number): Buffer {
  if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000) {
    throw new Error("Offline TTS returned an invalid sample rate.");
  }
  if (!samples.length) throw new Error("Offline TTS returned empty audio.");

  const data = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Number.isFinite(samples[index]) ? Math.max(-1, Math.min(1, samples[index])) : 0;
    const pcm = sample < 0 ? Math.round(sample * 32_768) : Math.round(sample * 32_767);
    data.writeInt16LE(pcm, index * 2);
  }

  const formatChunk = Buffer.alloc(16);
  formatChunk.writeUInt16LE(1, 0);
  formatChunk.writeUInt16LE(1, 2);
  formatChunk.writeUInt32LE(sampleRate, 4);
  formatChunk.writeUInt32LE(sampleRate * 2, 8);
  formatChunk.writeUInt16LE(2, 12);
  formatChunk.writeUInt16LE(16, 14);
  return encodeWav(formatChunk, data);
}

/** Wrap headerless 16-bit little-endian PCM (for example `audio/l16`) in a WAV container. */
export function wrapPcm16Wav(pcm: Buffer, sampleRate: number, channelCount = 1): Buffer {
  if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000) {
    throw new Error("Speech provider returned an invalid sample rate.");
  }
  if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 2) {
    throw new Error("Speech provider returned an unsupported channel count.");
  }
  const blockAlign = channelCount * 2;
  if (!pcm.length || pcm.length % blockAlign !== 0) throw new Error("Speech provider returned malformed PCM audio.");
  const formatChunk = Buffer.alloc(16);
  formatChunk.writeUInt16LE(1, 0);
  formatChunk.writeUInt16LE(channelCount, 2);
  formatChunk.writeUInt32LE(sampleRate, 4);
  formatChunk.writeUInt32LE(sampleRate * blockAlign, 8);
  formatChunk.writeUInt16LE(blockAlign, 12);
  formatChunk.writeUInt16LE(16, 14);
  return encodeWav(formatChunk, pcm);
}

function parseWav(buffer: Buffer): ParsedWav {
  if (!isWavAudio(buffer)) throw new Error("Speech provider did not return a valid WAV audio file.");
  let offset = 12;
  let formatChunk: Buffer | undefined;
  let data: Buffer | undefined;
  let streamedData = false;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buffer.length && id === "data") {
      // Streaming providers (Khaya) write the header before the length is
      // known, so the data chunk runs to the end of what was received.
      data = buffer.subarray(start);
      streamedData = true;
      break;
    }
    if (end > buffer.length) throw new Error("Speech provider returned a truncated WAV audio file.");
    if (id === "fmt ") formatChunk = buffer.subarray(start, end);
    if (id === "data") data = buffer.subarray(start, end);
    offset = end + (size % 2);
  }

  if (!formatChunk || formatChunk.length < 16 || !data) {
    throw new Error("Speech provider returned an incomplete WAV audio file.");
  }
  const audioFormat = formatChunk.readUInt16LE(0);
  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error(`Unsupported WAV audio format ${audioFormat}.`);
  }
  const blockAlign = formatChunk.readUInt16LE(12);
  if (blockAlign && streamedData) data = data.subarray(0, data.length - (data.length % blockAlign));
  if (!blockAlign || data.length % blockAlign !== 0 || (streamedData && !data.length)) {
    throw new Error("Speech provider returned malformed WAV sample data.");
  }

  return {
    formatChunk,
    audioFormat,
    channelCount: formatChunk.readUInt16LE(2),
    sampleRate: formatChunk.readUInt32LE(4),
    byteRate: formatChunk.readUInt32LE(8),
    blockAlign,
    bitsPerSample: formatChunk.readUInt16LE(14),
    data
  };
}

function silenceFor(wav: ParsedWav, pauseMilliseconds: number): Buffer {
  const safePause = Math.max(0, Math.min(2_000, pauseMilliseconds));
  const frameCount = Math.round((wav.sampleRate * safePause) / 1_000);
  const silence = Buffer.alloc(frameCount * wav.blockAlign);
  if (wav.audioFormat === 1 && wav.bitsPerSample === 8) silence.fill(128);
  return silence;
}

function encodeWav(formatChunk: Buffer, data: Buffer): Buffer {
  const formatPadding = formatChunk.length % 2;
  const dataPadding = data.length % 2;
  const riffSize = 4 + 8 + formatChunk.length + formatPadding + 8 + data.length + dataPadding;
  const output = Buffer.alloc(8 + riffSize);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(riffSize, 4);
  output.write("WAVE", 8, "ascii");
  output.write("fmt ", 12, "ascii");
  output.writeUInt32LE(formatChunk.length, 16);
  formatChunk.copy(output, 20);
  let offset = 20 + formatChunk.length + formatPadding;
  output.write("data", offset, "ascii");
  output.writeUInt32LE(data.length, offset + 4);
  data.copy(output, offset + 8);
  return output;
}

export const __wavAudioInternals = { parseWav };
