import { describe, expect, it } from "vitest";
import type { UserSettings } from "../types";
import { parsePlayerDeepLink, settingsForPlayerDeepLink, voiceForPlayerLanguage } from "./player-deep-link";

describe("WebMCP player deep links", () => {
  it("parses a complete listening link", () => {
    expect(parsePlayerDeepLink({
      documentId: "doc-1",
      targetLanguage: "gaa",
      startAt: "beginning"
    })).toEqual({ documentId: "doc-1", targetLanguage: "gaa", startAt: "beginning" });
  });

  it("uses resume and ignores unsupported route values", () => {
    expect(parsePlayerDeepLink({
      documentId: [" doc-2 ", "ignored"],
      targetLanguage: "fr",
      startAt: "play-now"
    })).toEqual({ documentId: "doc-2", targetLanguage: undefined, startAt: "resume" });
  });

  it("selects the default local voice when the requested language changes", () => {
    const next = settingsForPlayerDeepLink(settings(), "tw");
    expect(next).toEqual(expect.objectContaining({
      targetLanguage: "tw",
      voice: "khaya:twi:male_low"
    }));
    expect(next).not.toHaveProperty("userId");
    expect(next).not.toHaveProperty("updatedAt");
  });

  it("selects the default English voice when switching back to English", () => {
    const next = settingsForPlayerDeepLink(settings({ targetLanguage: "gaa", voice: "khaya:gaa:female" }), "en");
    expect(next).toEqual(expect.objectContaining({
      targetLanguage: "en",
      voice: "en-US-Neural2-F"
    }));
  });

  it("preserves an existing voice and skips a redundant settings write", () => {
    expect(settingsForPlayerDeepLink(settings({ targetLanguage: "ee", voice: "khaya:ewe:female" }), "ee")).toBeNull();
  });

  it("repairs a stale voice even when the requested language is already selected", () => {
    expect(settingsForPlayerDeepLink(settings({ targetLanguage: "en", voice: "khaya:gaa:female" }), "en")).toEqual(expect.objectContaining({
      targetLanguage: "en",
      voice: "en-US-Neural2-F"
    }));
  });

  it("repairs a Google voice saved against a Gemini provider", () => {
    expect(settingsForPlayerDeepLink(settings({ provider: "gemini", voice: "en-US-Neural2-J" }), "en")).toEqual(expect.objectContaining({
      provider: "gemini",
      targetLanguage: "en",
      voice: "Kore"
    }));
  });

  it("keeps any catalogue Gemini voice, including ones outside the mobile picker", () => {
    expect(voiceForPlayerLanguage("gemini-lite", "Zubenelgenubi", "en")).toBe("Zubenelgenubi");
  });

  it("repairs a Gemini voice saved against the Google provider", () => {
    expect(settingsForPlayerDeepLink(settings({ provider: "google", voice: "Kore" }), "en")).toEqual(expect.objectContaining({
      provider: "google",
      targetLanguage: "en",
      voice: "en-US-Neural2-F"
    }));
  });

  it("selects a matching local voice whenever the in-app language changes", () => {
    expect(voiceForPlayerLanguage("google", "khaya:gaa:female", "ee")).toBe("khaya:ewe:male_low");
    expect(voiceForPlayerLanguage("google", "khaya:ewe:female", "gaa")).toBe("khaya:gaa:male_low");
  });
});

function settings(update: Partial<UserSettings> = {}): UserSettings {
  return {
    userId: "user-1",
    provider: "google",
    voice: "en-US-Neural2-J",
    speed: 1,
    tone: "calm and clear",
    targetLanguage: "en",
    autoScroll: true,
    highlightMode: "paragraph",
    preferredContentTypes: ["webpage", "pdf", "rss", "url"],
    articlesPerFeed: 10,
    updatedAt: "2026-08-29T00:00:00.000Z",
    ...update
  };
}
