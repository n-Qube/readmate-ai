import { describe, expect, it } from "vitest";
import { ApiError } from "../../api/client";
import {
  boundedInteger,
  displayDomain,
  requirePublicHttpsUrl,
  safeErrorOutput,
  splitTopics,
  targetLanguage
} from "./form-utils";

describe("WebMCP confirmation form validation", () => {
  it("accepts a public HTTPS address and normalizes its display domain", () => {
    const url = requirePublicHttpsUrl("  https://www.example.com/story?q=read  ");
    expect(url).toBe("https://www.example.com/story?q=read");
    expect(displayDomain(url)).toBe("example.com");
  });

  it.each([
    "http://example.com/story",
    "file:///tmp/story.html",
    "https://localhost/story",
    "https://127.0.0.1/story",
    "https://10.0.0.4/story",
    "https://172.20.1.2/story",
    "https://192.168.1.1/story",
    "https://[::1]/story"
  ])("rejects a non-public or non-HTTPS address: %s", (url) => {
    expect(() => requirePublicHttpsUrl(url)).toThrow("public HTTPS");
  });

  it("deduplicates and caps comma-separated RSS topics", () => {
    expect(splitTopics("Ghana, Technology, Ghana, Education")).toEqual(["Ghana", "Technology", "Education"]);
    expect(splitTopics(Array.from({ length: 15 }, (_, index) => `Topic ${index}`).join(","))).toHaveLength(10);
    expect(() => splitTopics("A topic name that is deliberately longer than forty characters"))
      .toThrow("40 characters");
  });

  it("enforces study and RSS integer bounds", () => {
    expect(boundedInteger("12", 1, 24)).toBe(12);
    expect(() => boundedInteger("2.5", 1, 24)).toThrow("whole number");
    expect(() => boundedInteger("25", 1, 24)).toThrow("1 to 24");
  });

  it("accepts only ReadMate's supported target-language values", () => {
    expect(targetLanguage("gaa")).toBe("gaa");
    expect(() => targetLanguage("fr")).toThrow("English, Twi, Ewe, or Ga");
  });

  it("maps entitlement and cancellation failures to compact stable errors", () => {
    const limit = safeErrorOutput("readmate_generate_study_pack", new ApiError("Daily usage limit reached.", 403));
    expect(limit.ok).toBe(false);
    expect(limit.error.code).toBe("PLAN_LIMIT");
    expect(JSON.stringify(limit)).not.toMatch(/Daily usage limit reached/);

    const cancelled = safeErrorOutput("readmate_add_web_page", new DOMException("Aborted", "AbortError"));
    expect(cancelled.error.code).toBe("CANCELLED");
  });
});
