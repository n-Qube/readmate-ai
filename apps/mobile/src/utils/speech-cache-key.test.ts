import { describe, expect, it } from "vitest";
import { speechCacheFileKey } from "./speech-cache-key";

describe("speechCacheFileKey", () => {
  const commonPrefix = [
    "user_2zKTu8VfHqLongClerkPrincipal",
    "2d91ff07-36f8-4678-a521-d2a682d030b8",
    "segment-0-0-4",
    "google",
    "en-US-Neural2-F",
    "1"
  ].join("-");

  it("keeps every playback language in a separate cached file", () => {
    const keys = ["en", "tw", "ee", "gaa"].map((language) => speechCacheFileKey(`${commonPrefix}-${language}`));

    expect(new Set(keys).size).toBe(4);
  });

  it("changes when a trailing playback setting changes", () => {
    expect(speechCacheFileKey(`${commonPrefix}-en`)).not.toBe(speechCacheFileKey(`${commonPrefix}-gaa`));
    expect(speechCacheFileKey(`${commonPrefix}-en`)).not.toBe(speechCacheFileKey(`${commonPrefix}-en-extra`));
  });

  it("is stable, filesystem safe, and short enough for the cache directory", () => {
    const key = speechCacheFileKey(`${commonPrefix}-gaa`);

    expect(speechCacheFileKey(`${commonPrefix}-gaa`)).toBe(key);
    expect(key).toMatch(/^v2-[a-zA-Z0-9_-]+$/);
    expect(key.length).toBeLessThanOrEqual(68);
  });
});
