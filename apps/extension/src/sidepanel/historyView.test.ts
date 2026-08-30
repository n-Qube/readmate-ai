import { describe, expect, it } from "vitest";
import type { ReadingDocument } from "../shared/types";
import { clearAllLocalHistory, clearLocalDocumentHistory, isReadingHistoryEntry, readingHistoryEntries } from "./historyView";

function createDocument(overrides: Partial<ReadingDocument> = {}): ReadingDocument {
  return {
    id: "doc_1",
    userId: "user_1",
    title: "Saved article",
    sourceType: "rss",
    createdAt: "2026-08-29T09:00:00.000Z",
    updatedAt: "2026-08-29T09:00:00.000Z",
    progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 },
    status: "unread",
    voice: "en-US-Neural2-F",
    speed: 1,
    ...overrides
  };
}

describe("History view", () => {
  it("does not show saved but unread Library items as reading history", () => {
    expect(isReadingHistoryEntry(createDocument())).toBe(false);
  });

  it("shows records with a read timestamp", () => {
    expect(isReadingHistoryEntry(createDocument({ lastReadAt: "2026-08-29T09:10:00.000Z" }))).toBe(true);
  });

  it("keeps older progress-only records visible until they are cleared", () => {
    expect(isReadingHistoryEntry(createDocument({
      progress: { blockIndex: 1, characterOffset: 0, sentenceIndex: 0, percent: 35 },
      status: "in_progress"
    }))).toBe(true);
  });

  it("removes a cleared RSS article from History without deleting the Library document", () => {
    const document = createDocument({
      lastReadAt: "2026-08-29T09:10:00.000Z",
      progress: { blockIndex: 2, characterOffset: 4, sentenceIndex: 1, percent: 60 },
      status: "in_progress"
    });

    const cleared = clearLocalDocumentHistory(document);

    expect(cleared.id).toBe(document.id);
    expect(cleared.sourceType).toBe("rss");
    expect(cleared.lastReadAt).toBeUndefined();
    expect(cleared.status).toBe("unread");
    expect(cleared.progress).toEqual({
      blockIndex: 0,
      characterOffset: 0,
      sentenceIndex: 0,
      chunkIndex: 0,
      percent: 0
    });
    expect(readingHistoryEntries([cleared])).toEqual([]);
  });

  it("clears only history entries and preserves unread Library records", () => {
    const unread = createDocument({ id: "unread" });
    const read = createDocument({
      id: "read",
      lastReadAt: "2026-08-29T09:10:00.000Z",
      progress: { blockIndex: 1, characterOffset: 0, sentenceIndex: 0, percent: 40 },
      status: "in_progress"
    });

    const cleared = clearAllLocalHistory([unread, read]);

    expect(cleared[0]).toBe(unread);
    expect(cleared[1].id).toBe("read");
    expect(readingHistoryEntries(cleared)).toEqual([]);
  });

  it("renders no rows after a refreshed Library returns cleared RSS and webpage documents", () => {
    const refreshedLibrary = [
      createDocument({ id: "rss", sourceType: "rss" }),
      createDocument({ id: "article", sourceType: "webpage" }),
      createDocument({ id: "pdf", sourceType: "pdf" })
    ];

    expect(readingHistoryEntries(refreshedLibrary)).toEqual([]);
    expect(refreshedLibrary).toHaveLength(3);
  });
});
