import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __ttsInternals, ttsRouter } from "./tts.js";
import { entitlementForPlan } from "../entitlements.js";
import { __localLanguageInternals, SpeechDependencyError } from "../localLanguage.js";

const originalEnv = { ...process.env };

function testWav(sample = 1): Buffer {
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

function createTtsTestApp(overrides: Parameters<typeof ttsRouter>[0] = {}) {
  const app = express();
  app.use(express.json());
  app.use((req: import("../auth.js").AuthedRequest, _res, next) => {
    req.userId = "test_user";
    next();
  });
  app.use("/api/tts", ttsRouter({ consumeUsage: async () => 0, getEntitlement: () => entitlementForPlan("premium"), ...overrides }));
  return app;
}

describe("Google TTS authentication", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __ttsInternals.resetGoogleTokenCacheForTests();
    process.env = { ...originalEnv };
    delete process.env.GOOGLE_TTS_API_KEY;
    delete process.env.GOOGLE_TRANSLATE_API_KEY;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    delete process.env.KHAYA_API_KEY;
    delete process.env.KHAYA_SUBSCRIPTION_KEY;
    delete process.env.GHANANLP_API_KEY;
    delete process.env.GHANANLP_SUBSCRIPTION_KEY;
    delete process.env.KHAYA_SUBSCRIPTION_HEADER;
    delete process.env.KHAYA_TTS_URL;
    delete process.env.KHAYA_TRANSLATE_URL;
    delete process.env.KHAYA_AUDIO_ALLOWED_ORIGINS;
    delete process.env.KHAYA_AUDIO_MAX_BYTES;
    delete process.env.KHAYA_TOTAL_AUDIO_MAX_BYTES;
    delete process.env.LOCAL_SPEECH_MAX_ATTEMPTS;
    delete process.env.LOCAL_SPEECH_RETRY_BASE_MS;
    delete process.env.CARTESIA_API_KEY;
    delete process.env.CARTESIA_VOICE_ID;
    delete process.env.CARTESIA_MODEL_ID;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __ttsInternals.resetGoogleTokenCacheForTests();
    process.env = { ...originalEnv };
  });

  it("uses the Google Cloud metadata service when no explicit credential is configured", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "metadata-token", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(__ttsInternals.getGoogleAccessToken()).resolves.toBe("metadata-token");

    expect(fetchMock).toHaveBeenCalledWith("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
      headers: { "Metadata-Flavor": "Google" },
      signal: expect.any(AbortSignal)
    });
  });

  it("treats an empty GOOGLE_SERVICE_ACCOUNT_JSON as absent and falls back to metadata credentials", async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = "";
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "metadata-token", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(__ttsInternals.getGoogleAccessToken()).resolves.toBe("metadata-token");
  });

  it("splits long text into Google-sized synthesis requests and returns one audio buffer", async () => {
    process.env.GOOGLE_TTS_API_KEY = "test-api-key";
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ audioContent: Buffer.from("mp3-part").toString("base64") }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const audio = await __ttsInternals.synthesizeWithGoogle({
      text: `${"Academic research sentence with enough words to split cleanly. ".repeat(90)}Final sentence.`,
      provider: "google",
      voice: "en-US-Neural2-F",
      targetLanguage: "en",
      speed: 1
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(audio.toString()).toBe("mp3-partmp3-part");
    for (const call of fetchMock.mock.calls) {
      const init = call[1];
      if (!init) throw new Error("Expected Google TTS request init.");
      const body = JSON.parse(String(init.body)) as { input: { text: string } };
      expect(Buffer.byteLength(body.input.text, "utf8")).toBeLessThanOrEqual(4_500);
    }
  });

  it("preserves an oversized unbroken token while splitting it below the Google limit", () => {
    const text = "a".repeat(10_001);
    const parts = __ttsInternals.splitTextForGoogleTts(text);

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join("")).toBe(text);
    for (const part of parts) {
      expect(Buffer.byteLength(part, "utf8")).toBeLessThanOrEqual(4_500);
    }
  });

  it("synthesizes English with Cartesia without exposing the API key to the client", async () => {
    process.env.CARTESIA_API_KEY = "cartesia-secret";
    process.env.CARTESIA_VOICE_ID = "voice_natural";
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response(Buffer.from("cartesia-audio"), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const speech = await __ttsInternals.synthesizeSpeech({
      text: "Read this naturally.",
      provider: "cartesia",
      voice: "cartesia-default",
      targetLanguage: "en",
      speed: 1.25
    });

    expect(speech).toMatchObject({ contentType: "audio/mpeg", provider: "cartesia" });
    expect(speech.buffer.toString()).toBe("cartesia-audio");
    expect(fetchMock).toHaveBeenCalledWith("https://api.cartesia.ai/tts/bytes", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer cartesia-secret",
        "Cartesia-Version": "2026-03-01"
      })
    }));
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody).toMatchObject({
      model_id: "sonic-3",
      transcript: "Read this naturally.",
      voice: { id: "voice_natural" },
      language: "en",
      generation_config: { speed: 1.25 }
    });
  });

  it("blocks premium Cartesia audio for Free accounts before calling the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await request(createTtsTestApp({ getEntitlement: () => entitlementForPlan("free") }))
      .post("/api/tts")
      .send({ text: "Premium voice sample.", provider: "cartesia", voice: "cartesia-default", targetLanguage: "en", speed: 1 })
      .expect(403);

    expect(response.body).toMatchObject({ code: "PREMIUM_REQUIRED", feature: "premium_audio" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps GhanaNLP routing for Twi even when Cartesia is selected", async () => {
    process.env.GOOGLE_TRANSLATE_API_KEY = "test-google-translate-key";
    process.env.KHAYA_API_KEY = "test-khaya-key";
    process.env.CARTESIA_API_KEY = "cartesia-secret";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { translations: [{ translatedText: "Twi translation" }] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(testWav(1), {
        status: 200,
        headers: { "Content-Type": "audio/wav" }
      }));
    vi.stubGlobal("fetch", fetchMock);

    const speech = await __ttsInternals.synthesizeSpeech({
      text: "Read this aloud.",
      provider: "cartesia",
      voice: "cartesia-default",
      targetLanguage: "tw",
      speed: 1
    });

    expect(speech.provider).toBe("ghananlp");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("ghananlp.org/tts/");
  });

  it("translates Twi requests with Google Translate before using Khaya TTS", async () => {
    process.env.GOOGLE_TRANSLATE_API_KEY = "test-google-translate-key";
    process.env.KHAYA_API_KEY = "test-khaya-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { translations: [{ translatedText: "Twi translation" }] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(testWav(2), {
          status: 200,
          headers: { "Content-Type": "audio/wav" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const speech = await __ttsInternals.synthesizeSpeech({
      text: "Read this aloud.",
      provider: "google",
      voice: "en-US-Neural2-F",
      targetLanguage: "tw",
      speed: 1
    });

    expect(speech.contentType).toBe("audio/wav");
    expect(speech.buffer.toString("ascii", 0, 4)).toBe("RIFF");
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://translation.googleapis.com/language/translate/v2?key=test-google-translate-key"
    );
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: "Read this aloud.", source: "en", target: "ak", format: "text" })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://translation-api.ghananlp.org/tts/v2/synthesize",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          text: "Chwee translation",
          language: "twi",
          speaker_id: "male_low",
          stream: true,
          format: "wav"
        })
      })
    );
  });

  it("uses the ISO 639-3 Akuapem Twi code with Khaya TTS v2", async () => {
    process.env.GOOGLE_TRANSLATE_API_KEY = "test-google-translate-key";
    process.env.KHAYA_API_KEY = "test-khaya-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { translations: [{ translatedText: "Akuapem translation" }] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(testWav(3), {
          status: 200,
          headers: { "Content-Type": "audio/wav" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await __ttsInternals.synthesizeSpeech({
      text: "Read this aloud.",
      provider: "google",
      voice: "ghananlp-akuapem-twi",
      targetLanguage: "tw",
      speed: 1
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://translation-api.ghananlp.org/tts/v2/synthesize",
      expect.objectContaining({
        body: JSON.stringify({
          text: "Akuapem translation",
          language: "atw",
          speaker_id: "male_low",
          stream: true,
          format: "wav"
        })
      })
    );
  });

  it("decodes JSON-wrapped Khaya TTS audio responses", async () => {
    process.env.GOOGLE_TRANSLATE_API_KEY = "test-google-translate-key";
    process.env.KHAYA_API_KEY = "test-khaya-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { translations: [{ translatedText: "Ewe translation" }] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ audioContent: testWav(4).toString("base64") }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const speech = await __ttsInternals.synthesizeSpeech({
      text: "Read this aloud.",
      provider: "google",
      voice: "en-US-Neural2-F",
      targetLanguage: "ee",
      speed: 1
    });

    expect(speech.contentType).toBe("audio/wav");
    expect(speech.buffer.toString("ascii", 0, 4)).toBe("RIFF");
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://translation.googleapis.com/language/translate/v2?key=test-google-translate-key"
    );
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ q: "Read this aloud.", source: "en", target: "ee", format: "text" })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://translation-api.ghananlp.org/tts/v2/synthesize",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          text: "Eh veh translation",
          language: "ewe",
          speaker_id: "male_low",
          stream: true,
          format: "wav"
        })
      })
    );
  });

  it("translates English to Ga and synthesizes it with the Khaya v2 ISO language code", async () => {
    process.env.KHAYA_API_KEY = "test-khaya-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify("Ga translation"), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(testWav(5), {
          status: 200,
          headers: { "Content-Type": "audio/wav" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const speech = await __ttsInternals.synthesizeSpeech({
      text: "Read this aloud.",
      provider: "google",
      voice: "en-US-Neural2-F",
      targetLanguage: "gaa",
      speed: 1
    });

    expect(speech).toMatchObject({ contentType: "audio/wav", provider: "ghananlp" });
    expect(speech.buffer.toString("ascii", 0, 4)).toBe("RIFF");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://translation-api.ghananlp.org/v2/translate",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Ocp-Apim-Subscription-Key": "test-khaya-key" }),
        body: JSON.stringify({ in: "Read this aloud.", lang: "eng-gaa" })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://translation-api.ghananlp.org/tts/v2/synthesize",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          text: "Gah translation",
          language: "gaa",
          speaker_id: "male_low",
          stream: true,
          format: "wav"
        })
      })
    );
  });

  it("recovers when the local-language speech provider is temporarily busy", async () => {
    process.env.GOOGLE_TRANSLATE_API_KEY = "test-google-translate-key";
    process.env.KHAYA_API_KEY = "test-khaya-key";
    process.env.LOCAL_SPEECH_RETRY_BASE_MS = "0";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { translations: [{ translatedText: "Ewe translation" }] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Service is too busy" }), {
          status: 503,
          headers: { "Content-Type": "application/json", "Retry-After": "0" }
        })
      )
      .mockResolvedValueOnce(
        new Response(testWav(6), {
          status: 200,
          headers: { "Content-Type": "audio/wav" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const speech = await __ttsInternals.synthesizeSpeech({
      text: "Read this aloud.",
      provider: "google",
      voice: "khaya:ewe:male_low",
      targetLanguage: "ee",
      speed: 1
    });

    expect(speech).toMatchObject({ contentType: "audio/wav", provider: "ghananlp" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/tts/v2/synthesize");
    expect(String(fetchMock.mock.calls[2][0])).toContain("/tts/v2/synthesize");
  });

  it("returns a retryable 503 after Khaya stays busy through every provider attempt", async () => {
    process.env.KHAYA_API_KEY = "test-khaya-key";
    process.env.LOCAL_SPEECH_RETRY_BASE_MS = "0";
    const busyResponse = () => new Response(JSON.stringify({ message: "Service is too busy" }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Retry-After": "0" }
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify("Ga translation"), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }))
      .mockImplementation(async () => busyResponse());
    vi.stubGlobal("fetch", fetchMock);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await request(createTtsTestApp())
      .post("/api/tts")
      .send({
        text: "Read this aloud.",
        provider: "google",
        voice: "khaya:gaa:male_low",
        targetLanguage: "gaa",
        speed: 1
      })
      .expect(503);

    expect(response.body).toEqual({ error: "Text-to-speech is temporarily unavailable." });
    expect(response.headers["retry-after"]).toBe("2");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const failure = JSON.parse(String(consoleError.mock.calls.at(-1)?.[0]));
    expect(failure).toMatchObject({
      event: "tts_request_failed",
      status: 503,
      dependency: "khaya_tts",
      upstreamStatus: 503,
      attempts: 3,
      errorName: "SpeechDependencyError"
    });
    expect(JSON.stringify(failure)).not.toContain("Service is too busy");
  });

  it("does not retry a permanent Khaya credential rejection", async () => {
    process.env.KHAYA_API_KEY = "test-khaya-key";
    process.env.LOCAL_SPEECH_RETRY_BASE_MS = "0";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: "Access denied" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await request(createTtsTestApp())
      .post("/api/tts")
      .send({
        text: "Read this aloud.",
        provider: "google",
        voice: "khaya:gaa:male_low",
        targetLanguage: "gaa",
        speed: 1
      })
      .expect(502);

    expect(response.body).toEqual({ error: "Text-to-speech provider could not complete the request." });
    expect(response.headers["retry-after"]).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(consoleError.mock.calls.at(-1)?.[0]))).toMatchObject({
      event: "tts_request_failed",
      status: 502,
      dependency: "khaya_translate",
      upstreamStatus: 401,
      attempts: 1,
      retryable: false
    });
  });

  it("preserves a permanent provider status when its error body cannot be read", async () => {
    process.env.KHAYA_API_KEY = "test-khaya-key";
    process.env.LOCAL_SPEECH_RETRY_BASE_MS = "0";
    const unreadableUnauthorizedResponse = {
      status: 401,
      ok: false,
      headers: new Headers({ "Content-Type": "application/json" }),
      body: null,
      arrayBuffer: vi.fn(async () => { throw new TypeError("socket reset"); })
    } as unknown as Response;
    const fetchMock = vi.fn(async () => unreadableUnauthorizedResponse);
    vi.stubGlobal("fetch", fetchMock);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await request(createTtsTestApp())
      .post("/api/tts")
      .send({
        text: "Read this aloud.",
        provider: "google",
        voice: "khaya:gaa:male_low",
        targetLanguage: "gaa",
        speed: 1
      })
      .expect(502);

    expect(response.headers["retry-after"]).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(consoleError.mock.calls.at(-1)?.[0]))).toMatchObject({
      dependency: "khaya_translate",
      upstreamStatus: 401,
      attempts: 1,
      retryable: false
    });
  });

  it("retries a streamed Khaya audio body failure", async () => {
    process.env.KHAYA_API_KEY = "test-khaya-key";
    process.env.LOCAL_SPEECH_RETRY_BASE_MS = "0";
    const failedBody = {
      status: 200,
      ok: true,
      headers: new Headers({ "Content-Type": "audio/wav" }),
      body: null,
      arrayBuffer: vi.fn(async () => { throw new TypeError("socket reset"); })
    } as unknown as Response;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify("Ga translation"), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }))
      .mockResolvedValueOnce(failedBody)
      .mockResolvedValueOnce(new Response(testWav(6), {
        status: 200,
        headers: { "Content-Type": "audio/wav" }
      }));
    vi.stubGlobal("fetch", fetchMock);

    const speech = await __ttsInternals.synthesizeSpeech({
      text: "Read this aloud.",
      provider: "google",
      voice: "khaya:gaa:male_low",
      targetLanguage: "gaa",
      speed: 1
    });

    expect(speech.contentType).toBe("audio/wav");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects an oversized Khaya audio response without retrying it", async () => {
    process.env.KHAYA_API_KEY = "test-khaya-key";
    process.env.KHAYA_AUDIO_MAX_BYTES = "4";
    process.env.LOCAL_SPEECH_RETRY_BASE_MS = "0";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify("Ga translation"), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(Buffer.alloc(5), {
        status: 200,
        headers: { "Content-Type": "audio/wav", "Content-Length": "5" }
      }));
    vi.stubGlobal("fetch", fetchMock);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await request(createTtsTestApp())
      .post("/api/tts")
      .send({
        text: "Read this aloud.",
        provider: "google",
        voice: "khaya:gaa:male_low",
        targetLanguage: "gaa",
        speed: 1
      })
      .expect(502);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(consoleError.mock.calls.at(-1)?.[0]))).toMatchObject({
      dependency: "khaya_tts",
      upstreamStatus: 200,
      attempts: 1,
      retryable: false
    });
  });

  it("caps combined Khaya audio across every section in one request", async () => {
    process.env.KHAYA_API_KEY = "test-khaya-key";
    process.env.KHAYA_TOTAL_AUDIO_MAX_BYTES = "60";
    let translationCalls = 0;
    let synthesisCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL) => {
      if (String(input).includes("/v2/translate")) {
        translationCalls += 1;
        return new Response(JSON.stringify(`Ga translated sentence ${translationCalls}.`), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      synthesisCalls += 1;
      return new Response(testWav(synthesisCalls), {
        status: 200,
        headers: { "Content-Type": "audio/wav" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await request(createTtsTestApp())
      .post("/api/tts")
      .send({
        text: "This sentence contains enough readable words to translate safely. ".repeat(30),
        provider: "google",
        voice: "khaya:gaa:male_low",
        targetLanguage: "gaa",
        speed: 1
      })
      .expect(502);

    expect(translationCalls).toBeGreaterThan(1);
    expect(synthesisCalls).toBe(2);
    expect(response.headers["retry-after"]).toBeUndefined();
    const failure = JSON.parse(String(consoleError.mock.calls.at(-1)?.[0]));
    expect(failure).toMatchObject({
      dependency: "khaya_tts",
      retryable: false
    });
    expect(failure).not.toHaveProperty("upstreamStatus");
  });

  it.each([
    "http://169.254.169.254/latest/meta-data/",
    "https://attacker.example/audio.wav",
    "https://127.0.0.1/audio.wav",
    "https://[::1]/audio.wav",
    "https://[::ffff:127.0.0.1]/audio.wav"
  ])("rejects an untrusted Khaya audio URL without fetching it: %s", async (audioUrl) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const payload = Buffer.from(JSON.stringify({ audioUrl }));

    await expect(__localLanguageInternals.parseSynthesisResponse(
      new Response(payload, { headers: { "Content-Type": "application/json" } }),
      payload,
      { "Ocp-Apim-Subscription-Key": "never-forward-this-key" }
    )).rejects.toMatchObject({
      name: "SpeechDependencyError",
      dependency: "khaya_audio",
      retryable: false
    } satisfies Partial<SpeechDependencyError>);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an insecure configured Khaya provider endpoint before sending a subscription key", async () => {
    process.env.KHAYA_API_KEY = "test-khaya-key";
    process.env.KHAYA_TRANSLATE_URL = "http://translation-api.ghananlp.org/v2/translate";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await request(createTtsTestApp())
      .post("/api/tts")
      .send({
        text: "Read this aloud.",
        provider: "google",
        voice: "khaya:gaa:male_low",
        targetLanguage: "gaa",
        speed: 1
      })
      .expect(502);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads same-origin Khaya audio with the subscription key and blocks redirects", async () => {
    const fetchMock = vi.fn(async () => new Response(testWav(7), {
      status: 200,
      headers: { "Content-Type": "audio/wav" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const payload = Buffer.from(JSON.stringify({ audioUrl: "/generated/audio.wav" }));

    await expect(__localLanguageInternals.parseSynthesisResponse(
      new Response(payload, { headers: { "Content-Type": "application/json" } }),
      payload,
      { "Ocp-Apim-Subscription-Key": "test-khaya-key" }
    )).resolves.toMatchObject({ contentType: "audio/wav" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://translation-api.ghananlp.org/generated/audio.wav",
      expect.objectContaining({
        redirect: "manual",
        headers: expect.objectContaining({ "Ocp-Apim-Subscription-Key": "test-khaya-key" })
      })
    );
  });

  it("downloads audio from an explicitly allowed CDN without forwarding the subscription key", async () => {
    process.env.KHAYA_AUDIO_ALLOWED_ORIGINS = "https://cdn.khaya.example";
    const fetchMock = vi.fn(async () => new Response(testWav(8), {
      status: 200,
      headers: { "Content-Type": "audio/wav" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const payload = Buffer.from(JSON.stringify({ audioUrl: "https://cdn.khaya.example/generated/audio.wav" }));

    await __localLanguageInternals.parseSynthesisResponse(
      new Response(payload, { headers: { "Content-Type": "application/json" } }),
      payload,
      { "Ocp-Apim-Subscription-Key": "test-khaya-key" }
    );

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(requestInit.redirect).toBe("manual");
    expect(requestInit.headers).toEqual({ Accept: "audio/mpeg, audio/wav, application/octet-stream" });
  });

  it("does not follow a redirect returned by an allowed Khaya audio URL", async () => {
    const fetchMock = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { Location: "https://attacker.example/audio.wav" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const payload = Buffer.from(JSON.stringify({ audioUrl: "/generated/audio.wav" }));

    await expect(__localLanguageInternals.parseSynthesisResponse(
      new Response(payload, { headers: { "Content-Type": "application/json" } }),
      payload,
      { "Ocp-Apim-Subscription-Key": "test-khaya-key" }
    )).rejects.toMatchObject({ dependency: "khaya_audio", upstreamStatus: 302, retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not call a speech provider when the usage database pool is unavailable", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await request(createTtsTestApp({
      consumeUsage: async () => {
        throw Object.assign(new Error("Timed out fetching a connection from the pool."), { code: "P2024" });
      }
    }))
      .post("/api/tts")
      .send({
        text: "Read this aloud.",
        provider: "google",
        voice: "khaya:gaa:male_low",
        targetLanguage: "gaa",
        speed: 1
      })
      .expect(503);

    expect(response.body).toEqual({ error: "Text-to-speech is temporarily unavailable." });
    expect(response.headers["retry-after"]).toBe("2");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a service-unavailable response for Google provider failures", async () => {
    process.env.GOOGLE_TTS_API_KEY = "test-api-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "Cloud Text-to-Speech API has not been used in this project." } }), {
          status: 403,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    const response = await request(createTtsTestApp())
      .post("/api/tts")
      .send({
        text: "Read this aloud.",
        provider: "google",
        voice: "en-US-Neural2-F",
        targetLanguage: "en",
        speed: 1
      })
      .expect(503);

    expect(response.body).toEqual({ error: "Text-to-speech is temporarily unavailable." });
    expect(JSON.stringify(response.body)).not.toContain("this project");
  });

  it("returns a short-lived HTTPS URL for Chromecast without exposing a LAN file server", async () => {
    process.env.GOOGLE_TTS_API_KEY = "test-api-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      audioContent: Buffer.from("cast-audio").toString("base64")
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const createCastUrl = vi.fn(async () => "https://storage.example.test/signed/cast.mp3");

    const response = await request(createTtsTestApp({ createCastUrl }))
      .post("/api/tts/cast")
      .send({
        text: "Read this on Chromecast.",
        provider: "google",
        voice: "en-US-Neural2-F",
        targetLanguage: "en",
        speed: 1
      })
      .expect(200);

    expect(response.body).toEqual({ url: "https://storage.example.test/signed/cast.mp3", expiresInSeconds: 600 });
    expect(createCastUrl).toHaveBeenCalledWith("test_user", expect.objectContaining({
      provider: "google",
      buffer: Buffer.from("cast-audio")
    }), expect.stringMatching(/^[a-f0-9]{64}$/));
  });
});
