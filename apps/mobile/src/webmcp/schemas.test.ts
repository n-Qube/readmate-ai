import { describe, expect, it } from "vitest";
import {
  READMATE_TOOL_SCHEMAS,
  ToolInputValidationError,
  parseReadMateToolInput
} from "./schemas";
import { READMATE_TOOL_NAMES } from "./tool-names";

describe("ReadMate WebMCP input schemas", () => {
  it("uses closed object schemas for all six tools", () => {
    expect(Object.keys(READMATE_TOOL_SCHEMAS).sort()).toEqual([...READMATE_TOOL_NAMES].sort());
    for (const schema of Object.values(READMATE_TOOL_SCHEMAS)) {
      expect(schema.type).toBe("object");
      expect(schema.additionalProperties).toBe(false);
    }
  });

  it("normalizes a valid library search and rejects unknown fields", () => {
    expect(parseReadMateToolInput("readmate_search_library", {
      query: "  archaeology  ",
      sourceType: "webpage",
      status: "in_progress",
      targetLanguage: "gaa",
      limit: 4
    })).toEqual({
      query: "archaeology",
      sourceType: "webpage",
      status: "in_progress",
      targetLanguage: "gaa",
      limit: 4
    });

    expect(() => parseReadMateToolInput("readmate_search_library", {
      query: "archaeology",
      revealDocumentText: true
    })).toThrow(ToolInputValidationError);
  });

  it("enforces owned-document IDs, language enums, and numeric limits", () => {
    expect(parseReadMateToolInput("readmate_prepare_listening", {
      documentId: "doc_2a-valid",
      targetLanguage: "tw",
      startAt: "beginning"
    })).toEqual({ documentId: "doc_2a-valid", targetLanguage: "tw", startAt: "beginning" });

    expect(() => parseReadMateToolInput("readmate_get_document_context", { documentId: "../../other-user" })).toThrow();
    expect(() => parseReadMateToolInput("readmate_prepare_listening", { documentId: "doc-1", targetLanguage: "fr" })).toThrow();
    expect(() => parseReadMateToolInput("readmate_generate_study_pack", { documentId: "doc-1", flashcardCount: 25 })).toThrow();
    expect(() => parseReadMateToolInput("readmate_generate_study_pack", { documentId: "doc-1", quizCount: 1.5 })).toThrow();
  });

  it.each([
    "http://example.org/story",
    "file:///etc/passwd",
    "data:text/plain,hello",
    "https://localhost/feed.xml",
    "https://reader.local/feed.xml",
    "https://127.0.0.1/feed.xml",
    "https://10.0.0.4/feed.xml",
    "https://169.254.169.254/latest/meta-data",
    "https://172.16.0.1/feed.xml",
    "https://192.168.1.1/feed.xml",
    "https://[::1]/feed.xml",
    "https://[fd00::1]/feed.xml",
    "https://[fe80::1]/feed.xml",
    "https://2130706433/feed.xml",
    "https://single-label/feed.xml"
  ])("rejects a non-public URL: %s", (url) => {
    expect(() => parseReadMateToolInput("readmate_add_web_page", { url })).toThrow(ToolInputValidationError);
  });

  it("accepts and normalizes a public HTTPS URL", () => {
    expect(parseReadMateToolInput("readmate_add_web_page", {
      url: "https://example.org/story",
      preferredLanguage: "ee"
    })).toEqual({ url: "https://example.org/story", preferredLanguage: "ee" });
  });

  it("requires an RSS source name and unique bounded topics", () => {
    expect(() => parseReadMateToolInput("readmate_subscribe_rss", { feedUrl: "https://example.org/feed.xml" })).toThrow();
    expect(() => parseReadMateToolInput("readmate_subscribe_rss", {
      feedUrl: "https://example.org/feed.xml",
      sourceName: "Example",
      topics: ["AI", "ai"]
    })).toThrow();
    expect(parseReadMateToolInput("readmate_subscribe_rss", {
      feedUrl: "https://example.org/feed.xml",
      sourceName: "Example",
      topics: ["AI", "Accessibility"],
      articlesPerRefresh: 20
    })).toMatchObject({ sourceName: "Example", articlesPerRefresh: 20 });
  });
});

