import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthedRequest } from "../auth.js";
import { settingsRouter } from "./settings.js";
import { entitlementForPlan } from "../entitlements.js";

vi.mock("../prisma.js", () => {
  const rows = new Map<string, any>();
  return {
    prisma: {
      userSettings: {
        async upsert({ where, create, update }: any) {
          const existing = rows.get(where.userId);
          const now = new Date("2026-05-23T07:00:00.000Z");
          const row = existing ? { ...existing, ...update, updatedAt: now } : { id: "settings_1", ...create, createdAt: now, updatedAt: now };
          rows.set(where.userId, row);
          return row;
        }
      }
    }
  };
});

function createTestApp(repository?: any, plan: "free" | "premium" = "premium") {
  const app = express();
  app.use(express.json());
  app.use((req: AuthedRequest, _res, next) => {
    req.userId = "user_settings";
    next();
  });
  app.use("/api/settings", settingsRouter({ repository, getEntitlement: () => entitlementForPlan(plan) }));
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: "Unexpected server error." });
  });
  return app;
}

describe("settingsRouter", () => {
  it("creates default synced settings for a user", async () => {
    const response = await request(createTestApp()).get("/api/settings").expect(200);

    expect(response.body).toMatchObject({
      userId: "user_settings",
      provider: "google",
      voice: "en-US-Neural2-F",
      speed: 1,
      targetLanguage: "en",
      preferredContentTypes: ["webpage", "pdf", "rss", "url"],
      articlesPerFeed: 10
    });
  });

  it("updates listening preferences and preferred content types", async () => {
    const response = await request(createTestApp())
      .put("/api/settings")
      .send({
        provider: "legacy-provider",
        voice: "legacy-voice",
        speed: 1.5,
        tone: "study mode",
        targetLanguage: "ee",
        autoScroll: false,
        highlightMode: "sentence",
        preferredContentTypes: ["pdf", "rss", "news"],
        articlesPerFeed: 20
      })
      .expect(200);

    expect(response.body).toMatchObject({
      provider: "google",
      voice: "khaya:ewe:male_low",
      speed: 1.5,
      tone: "study mode",
      targetLanguage: "ee",
      autoScroll: false,
      highlightMode: "sentence",
      preferredContentTypes: ["pdf", "rss", "news"],
      articlesPerFeed: 20
    });
  });

  it("stores Ga as a supported Khaya v2 language", async () => {
    const response = await request(createTestApp())
      .put("/api/settings")
      .send({
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1,
        targetLanguage: "gaa",
        autoScroll: true,
        highlightMode: "paragraph",
        preferredContentTypes: ["webpage"],
        articlesPerFeed: 10
      })
      .expect(200);

    expect(response.body).toMatchObject({ targetLanguage: "gaa" });
  });

  it("rejects languages that do not have confirmed translation and TTS support", async () => {
    await request(createTestApp())
      .put("/api/settings")
      .send({
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1,
        targetLanguage: "fra",
        autoScroll: true,
        highlightMode: "paragraph",
        preferredContentTypes: ["webpage"],
        articlesPerFeed: 10
      })
      .expect(400);
  });

  it.each(["gemini", "gemini-lite"])("stores %s as an English provider", async (provider) => {
    const response = await request(createTestApp())
      .put("/api/settings")
      .send({
        provider: provider,
        voice: "Aoede",
        speed: 1,
        targetLanguage: "en",
        autoScroll: true,
        highlightMode: "paragraph",
        preferredContentTypes: ["webpage"],
        articlesPerFeed: 10
      })
      .expect(200);

    expect(response.body).toMatchObject({ provider, voice: "Aoede" });
  });

  it.each(["en-US-Neural2-J", "khaya:ewe:female"])("does not persist voice %s against English Gemini", async (voice) => {
    const response = await request(createTestApp())
      .put("/api/settings")
      .send({
        provider: "gemini",
        voice,
        speed: 1,
        targetLanguage: "en",
        autoScroll: true,
        highlightMode: "paragraph",
        preferredContentTypes: ["webpage"],
        articlesPerFeed: 10
      })
      .expect(200);

    expect(response.body).toMatchObject({ provider: "gemini", voice: "Kore" });
  });

  it("migrates a retired Cartesia selection to Gemini Flash TTS", async () => {
    const response = await request(createTestApp())
      .put("/api/settings")
      .send({
        provider: "cartesia",
        voice: "cartesia-default",
        speed: 1,
        targetLanguage: "en",
        autoScroll: true,
        highlightMode: "paragraph",
        preferredContentTypes: ["webpage"],
        articlesPerFeed: 10
      })
      .expect(200);

    expect(response.body).toMatchObject({ provider: "gemini", voice: "Kore" });
  });

  it("allows Free accounts to select Gemini Flash-Lite", async () => {
    const response = await request(createTestApp(undefined, "free"))
      .put("/api/settings")
      .send({
        provider: "gemini-lite",
        voice: "Kore",
        speed: 1,
        targetLanguage: "en",
        autoScroll: true,
        highlightMode: "paragraph",
        preferredContentTypes: ["webpage"],
        articlesPerFeed: 10
      })
      .expect(200);

    expect(response.body).toMatchObject({ provider: "gemini-lite" });
  });

  it("does not allow Free accounts to select Gemini Flash premium audio", async () => {
    const response = await request(createTestApp(undefined, "free"))
      .put("/api/settings")
      .send({
        provider: "gemini",
        voice: "Kore",
        speed: 1,
        targetLanguage: "en",
        autoScroll: true,
        highlightMode: "paragraph",
        preferredContentTypes: ["webpage"],
        articlesPerFeed: 10
      })
      .expect(500);

    expect(response.body).toEqual({ error: "Unexpected server error." });
  });

  it("does not expose repository error details", async () => {
    const repository = {
      async getOrCreateSettings() { throw new Error("db.internal secret marker"); },
      async updateSettings() { throw new Error("db.internal secret marker"); }
    };
    const response = await request(createTestApp(repository)).put("/api/settings").send({}).expect(500);
    expect(response.body).toEqual({ error: "Unexpected server error." });
  });
});
