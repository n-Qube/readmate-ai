import { describe, expect, it } from "vitest";
import type { ReadingDocument } from "../shared/types";
import { libraryEntries, matchesLibrarySearch } from "./libraryView";
import { readingHistoryEntries } from "./historyView";

function document(overrides: Partial<ReadingDocument>): ReadingDocument {
  return {
    id: "doc-1",
    userId: "user-1",
    title: "Saved article",
    sourceType: "webpage",
    createdAt: "2026-08-29T10:00:00.000Z",
    updatedAt: "2026-08-29T10:00:00.000Z",
    progress: { percent: 0 },
    voice: "en-US-Neural2-F",
    speed: 1,
    ...overrides
  };
}

describe("extension Library view", () => {
  it("keeps unread saved items in Library while History remains activity-only", () => {
    const unread = document({ id: "unread", status: "unread" });
    const started = document({
      id: "started",
      status: "in_progress",
      progress: { percent: 25 },
      lastReadAt: "2026-08-29T11:00:00.000Z",
      updatedAt: "2026-08-29T11:00:00.000Z"
    });

    expect(libraryEntries([unread, started]).map((item) => item.id)).toEqual(["started", "unread"]);
    expect(readingHistoryEntries([unread, started]).map((item) => item.id)).toEqual(["started"]);
  });

  it("searches useful saved-item metadata, not document text", () => {
    const item = document({
      title: "Ghana's buried cities",
      author: "Ama Mensah",
      sourceLabel: "BBC Africa",
      category: "History",
      sourceType: "pdf"
    });

    expect(matchesLibrarySearch(item, "buried")).toBe(true);
    expect(matchesLibrarySearch(item, "mensah")).toBe(true);
    expect(matchesLibrarySearch(item, "bbc")).toBe(true);
    expect(matchesLibrarySearch(item, "history")).toBe(true);
    expect(matchesLibrarySearch(item, "pdf")).toBe(true);
    expect(matchesLibrarySearch(item, "private paragraph")).toBe(false);
  });
});
