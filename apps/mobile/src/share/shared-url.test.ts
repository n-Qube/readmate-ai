import { describe, expect, it } from "vitest";
import { extractSharedUrl } from "./shared-url";

describe("extractSharedUrl", () => {
  it("prefers the browser-provided URL", () => {
    expect(extractSharedUrl({ webUrl: "https://example.org/story", text: "https://other.test" })).toBe("https://example.org/story");
  });

  it("finds a link inside shared text and trims trailing punctuation", () => {
    expect(extractSharedUrl({ text: "Read this (https://news.example.com/a?b=1)." })).toBe("https://news.example.com/a?b=1");
  });

  it("rejects non-web schemes and text without links", () => {
    expect(extractSharedUrl({ webUrl: "file:///etc/passwd", text: "javascript:alert(1)" })).toBeNull();
    expect(extractSharedUrl({ text: "Just some words" })).toBeNull();
    expect(extractSharedUrl({})).toBeNull();
  });
});
