import { describe, expect, it, vi } from "vitest";

vi.mock("../storage/device-storage", () => ({ deviceStorage: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() } }));

import { applySetupPreferences, parseSetupPreferences } from "./setup-preferences";

const defaultSettings = () => ({
  provider: "google" as const,
  voice: "en-US-Neural2-F",
  speed: 1,
  targetLanguage: "en" as const,
  autoScroll: true,
  highlightMode: "paragraph" as const,
  preferredContentTypes: ["webpage", "pdf", "rss", "url"] as ("webpage" | "pdf" | "rss" | "url")[],
  articlesPerFeed: 10
});

describe("parseSetupPreferences", () => {
  it("accepts a stored Gemini voice, supported speed, and known content types", () => {
    expect(parseSetupPreferences(JSON.stringify({ voice: "Charon", speed: 1.25, preferredContentTypes: ["pdf", "rss"] }))).toEqual({
      voice: "Charon",
      speed: 1.25,
      preferredContentTypes: ["pdf", "rss"]
    });
  });

  it("drops unknown content types instead of rejecting the choice", () => {
    expect(parseSetupPreferences(JSON.stringify({ voice: "Kore", speed: 1, preferredContentTypes: ["pdf", "podcast", 4] }))?.preferredContentTypes).toEqual(["pdf"]);
  });

  it.each([
    ["missing", null],
    ["malformed", "{not json"],
    ["retired placeholder voice", JSON.stringify({ voice: "Isla", speed: 1, preferredContentTypes: [] })],
    ["unsupported speed", JSON.stringify({ voice: "Kore", speed: 3, preferredContentTypes: [] })]
  ])("ignores %s preferences", (_label, raw) => {
    expect(parseSetupPreferences(raw)).toBeNull();
  });
});

describe("applySetupPreferences", () => {
  it("switches to Gemini Flash-Lite with the chosen voice and speed", () => {
    const next = applySetupPreferences(defaultSettings(), { voice: "Aoede", speed: 1.5, preferredContentTypes: ["webpage"] });
    expect(next).toMatchObject({ provider: "gemini-lite", voice: "Aoede", speed: 1.5, preferredContentTypes: ["webpage"] });
    expect(next.targetLanguage).toBe("en");
  });

  it("keeps existing content types when none were picked", () => {
    const base = defaultSettings();
    expect(applySetupPreferences(base, { voice: "Kore", speed: 1, preferredContentTypes: [] }).preferredContentTypes).toEqual(base.preferredContentTypes);
  });
});
