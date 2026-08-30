import { describe, expect, it } from "vitest";
import type { ReadingDocument } from "@/types";
import { matchesLibraryFilter, matchesLibrarySearch } from "./library-filters";

function documentFixture(overrides: Partial<ReadingDocument> = {}): ReadingDocument {
  return {
    id: "document-1",
    userId: "user-1",
    title: "Company Profile",
    sourceType: "document",
    category: "Documents",
    status: "unread",
    createdAt: "2026-08-29T09:00:00.000Z",
    updatedAt: "2026-08-29T09:00:00.000Z",
    progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 },
    provider: "google",
    voice: "en-US-Neural2-F",
    speed: 1,
    blocks: [],
    ...overrides
  };
}

describe("library filters", () => {
  it.each(["document", "pdf", "ocr"] as const)("shows %s uploads under Documents", (sourceType) => {
    expect(matchesLibraryFilter(documentFixture({ sourceType }), "Documents")).toBe(true);
  });

  it("does not misclassify a Word document as an article", () => {
    expect(matchesLibraryFilter(documentFixture(), "Articles")).toBe(false);
  });

  it("keeps podcast webpages out of Articles", () => {
    const podcast = documentFixture({ sourceType: "webpage", category: "Podcasts" });
    expect(matchesLibraryFilter(podcast, "Podcasts")).toBe(true);
    expect(matchesLibraryFilter(podcast, "Articles")).toBe(false);
  });

  it("searches document titles and metadata", () => {
    expect(matchesLibrarySearch(documentFixture(), "company")).toBe(true);
    expect(matchesLibrarySearch(documentFixture(), "missing")).toBe(false);
  });
});
