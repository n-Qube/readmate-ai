import type { ReadingDocument } from "../shared/types";

/**
 * The API returns the complete Library because Read and Learn also need saved
 * items. The History tab must only render items that have actually been read.
 * Progress/status are retained as a compatibility fallback for older records
 * created before lastReadAt was consistently populated.
 */
export function isReadingHistoryEntry(document: ReadingDocument): boolean {
  return Boolean(document.lastReadAt)
    || document.progress.percent > 0
    || document.status === "in_progress"
    || document.status === "completed";
}

export function readingHistoryEntries(documents: ReadingDocument[]): ReadingDocument[] {
  return documents.filter(isReadingHistoryEntry);
}

export function clearLocalDocumentHistory(document: ReadingDocument): ReadingDocument {
  return {
    ...document,
    progress: {
      blockIndex: 0,
      characterOffset: 0,
      sentenceIndex: 0,
      chunkIndex: 0,
      percent: 0
    },
    status: "unread",
    lastReadAt: undefined
  };
}

export function clearAllLocalHistory(documents: ReadingDocument[]): ReadingDocument[] {
  return documents.map((document) => isReadingHistoryEntry(document)
    ? clearLocalDocumentHistory(document)
    : document);
}
