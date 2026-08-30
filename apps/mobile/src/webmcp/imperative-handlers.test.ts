import { describe, expect, it } from "vitest";
import type { ReadingDocument } from "../types";
import {
  buildLibrarySearchPath,
  compactDocumentContext,
  compactLibrarySearch,
  documentForListening,
  listeningDeepLink,
  normalizeAgentSourceType,
  type LibrarySearchTransport
} from "./imperative-handlers";

describe("production WebMCP imperative handler adapters", () => {
  it.each([
    ["webpage", "webpage"],
    ["selection", "webpage"],
    ["url", "webpage"],
    ["pdf", "pdf"],
    ["rss", "rss"],
    ["news", "rss"],
    ["document", "document"],
    ["ocr", "document"]
  ] as const)("normalizes %s records to public source type %s", (sourceType, expected) => {
    expect(normalizeAgentSourceType(sourceType)).toBe(expected);
  });

  it("uses the compact server endpoint with public filters and a bounded limit", () => {
    expect(buildLibrarySearchPath({ query: "archaeology", sourceType: "webpage", status: "in_progress", limit: 4 }))
      .toBe("/api/documents/search-context?q=archaeology&status=in_progress&sourceType=webpage&limit=4");
    expect(buildLibrarySearchPath({ query: "paper", sourceType: "pdf" }))
      .toBe("/api/documents/search-context?q=paper&sourceType=pdf&limit=10");
    expect(buildLibrarySearchPath({ query: "anything", limit: 4 }))
      .toBe("/api/documents/search-context?q=anything&limit=4");
    expect(buildLibrarySearchPath({ query: "anything", sourceType: "rss", limit: 100 }))
      .toBe("/api/documents/search-context?q=anything&sourceType=rss&limit=10");
  });

  it("adds target language to compact server metadata without accepting document bodies or private fields", () => {
    const response: LibrarySearchTransport = {
      results: [{
        documentId: "doc-1",
        title: "Example",
        sourceType: "rss",
        status: "in_progress",
        progressPercent: 42,
        updatedAt: "2026-08-29T01:00:00.000Z",
        deepLink: "/document/server-supplied-value-is-not-trusted"
      }],
      total: 8
    };
    const resource = compactLibrarySearch(response, { query: "example", sourceType: "rss" }, "gaa");
    expect(resource.results).toEqual([expect.objectContaining({
      documentId: "doc-1",
      sourceType: "rss",
      targetLanguage: "gaa",
      progressPercent: 42,
      deepLink: "/document/doc-1"
    })]);
    expect(resource.total).toBe(8);
    expect(JSON.stringify(resource)).not.toContain("server-supplied-value-is-not-trusted");
  });

  it("normalizes and clamps compact document context", () => {
    const resource = compactDocumentContext({ documentId: "doc-1" }, {
      documentId: "ignored-server-id",
      title: "Example",
      sourceType: "ocr",
      status: "in_progress",
      progressPercent: 140,
      summaryAvailable: true,
      flashcardCount: 4,
      quizCount: 3,
      supportedActions: ["readmate_prepare_listening", "delete_everything"]
    });
    expect(resource).toEqual(expect.objectContaining({
      documentId: "doc-1",
      sourceType: "document",
      progressPercent: 100,
      supportedActions: ["readmate_prepare_listening"],
      deepLink: "/document/doc-1"
    }));
  });

  it("prepares visible player state without mutating the original saved progress", () => {
    const document = fixture();
    const beginning = documentForListening(document, "beginning");
    expect(beginning.progress.percent).toBe(0);
    expect(document.progress.percent).toBe(42);
    expect(listeningDeepLink({ documentId: "doc-1", targetLanguage: "tw", startAt: "beginning" }))
      .toBe("/player?documentId=doc-1&targetLanguage=tw&startAt=beginning");
  });
});

function fixture(update: Partial<ReadingDocument> = {}): ReadingDocument {
  return {
    id: "doc-1",
    userId: "user-1",
    title: "Example",
    sourceType: "webpage",
    category: "Articles",
    status: "in_progress",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T01:00:00.000Z",
    progress: { blockIndex: 1, characterOffset: 20, sentenceIndex: 1, percent: 42 },
    provider: "google",
    voice: "en-US-Neural2-F",
    speed: 1,
    blocks: [{ id: "block-1", orderIndex: 0, blockType: "paragraph", text: "Private body." }],
    ...update
  };
}
