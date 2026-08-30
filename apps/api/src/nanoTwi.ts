import { createRequire } from "node:module";
import path from "node:path";
import { encodePcm16MonoWav, normalizeSpeechPcm } from "./audio/wavAudio.js";

type GeneratedAudio = {
  samples: Float32Array;
  sampleRate: number;
};

type GenerationConfig = object;

type OfflineTts = {
  generateAsync(input: { text: string; generationConfig: GenerationConfig }): Promise<GeneratedAudio>;
};

type SherpaOnnx = {
  GenerationConfig: new (input: { sid: number; speed: number; silenceScale: number }) => GenerationConfig;
  OfflineTts: {
    createAsync(config: object): Promise<OfflineTts>;
  };
};

const require = createRequire(import.meta.url);
let enginePromise: Promise<{ engine: OfflineTts; sherpa: SherpaOnnx }> | undefined;

export function nanoTwiConfigured(): boolean {
  return Boolean(process.env.NANO_TWI_MODEL_DIR?.trim());
}

export async function synthesizeNanoTwiSpeech(input: {
  text: string;
  speed: number;
}): Promise<{ buffer: Buffer; contentType: "audio/wav"; provider: "nano-twi" }> {
  const text = input.text.replace(/\s+/g, " ").trim();
  if (!text) throw new Error("Nano-Twi received empty text.");

  const { engine, sherpa } = await nanoTwiEngine();
  const generationConfig = new sherpa.GenerationConfig({
    sid: 0,
    speed: input.speed,
    silenceScale: 0.2
  });
  const audio = await engine.generateAsync({ text, generationConfig });
  if (!(audio.samples instanceof Float32Array)) throw new Error("Nano-Twi returned invalid samples.");

  return {
    buffer: encodePcm16MonoWav(normalizeSpeechPcm(audio.samples), audio.sampleRate),
    contentType: "audio/wav",
    provider: "nano-twi"
  };
}

async function nanoTwiEngine(): Promise<{ engine: OfflineTts; sherpa: SherpaOnnx }> {
  if (!enginePromise) enginePromise = createNanoTwiEngine();
  try {
    return await enginePromise;
  } catch (error) {
    enginePromise = undefined;
    throw error;
  }
}

async function createNanoTwiEngine(): Promise<{ engine: OfflineTts; sherpa: SherpaOnnx }> {
  const modelDir = process.env.NANO_TWI_MODEL_DIR?.trim();
  if (!modelDir) throw new Error("NANO_TWI_MODEL_DIR is not configured.");
  const sherpa = require("sherpa-onnx-node") as SherpaOnnx;
  const model = {
    matcha: {
      acousticModel: path.join(modelDir, "twi_ep045_steps4.onnx"),
      vocoder: path.join(modelDir, "vocos-22khz-univ.onnx"),
      tokens: path.join(modelDir, "tokens.txt"),
      dataDir: path.join(modelDir, "espeak-ng-data"),
      noiseScale: 0.667,
      lengthScale: 1
    },
    debug: false,
    numThreads: nanoTwiThreadCount(),
    provider: "cpu"
  };
  const engine = await sherpa.OfflineTts.createAsync({ model, maxNumSentences: 1 });
  return { engine, sherpa };
}

function nanoTwiThreadCount(): number {
  const configured = Number(process.env.NANO_TWI_NUM_THREADS);
  return Number.isInteger(configured) && configured >= 1 && configured <= 4 ? configured : 1;
}

export const __nanoTwiInternals = {
  nanoTwiThreadCount,
  resetEngineForTests: () => {
    enginePromise = undefined;
  }
};
