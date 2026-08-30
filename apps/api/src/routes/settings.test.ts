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

  it("stores Cartesia as an optional English provider", async () => {
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

    expect(response.body).toMatchObject({ provider: "cartesia", voice: "cartesia-default" });
  });

  it("does not persist a Google voice against the Cartesia provider", async () => {
    const response = await request(createTestApp())
      .put("/api/settings")
      .send({
        provider: "cartesia",
        voice: "en-US-Neural2-J",
        speed: 1,
        targetLanguage: "en",
        autoScroll: true,
        highlightMode: "paragraph",
        preferredContentTypes: ["webpage"],
        articlesPerFeed: 10
      })
      .expect(200);

    expect(response.body).toMatchObject({ provider: "cartesia", voice: "cartesia-default" });
  });

  it("does not persist a local-language voice against English Cartesia", async () => {
    const response = await request(createTestApp())
      .put("/api/settings")
      .send({
        provider: "cartesia",
        voice: "khaya:ewe:female",
        speed: 1,
        targetLanguage: "en",
        autoScroll: true,
        highlightMode: "paragraph",
        preferredContentTypes: ["webpage"],
        articlesPerFeed: 10
      })
      .expect(200);

    expect(response.body).toMatchObject({ provider: "cartesia", voice: "cartesia-default" });
  });

  it("does not allow Free accounts to select Cartesia premium audio", async () => {
    const response = await request(createTestApp(undefined, "free"))
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
