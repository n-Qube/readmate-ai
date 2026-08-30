import type { ReadingDocument } from "./types";

/**
 * Older mobile uploads may have stored an iOS percent-encoded filename as the
 * document title. Decode only uploaded documents so ordinary web headlines
 * containing a percent sign are never rewritten.
 */
export function normalizeUploadedDocumentForDisplay(document: ReadingDocument): ReadingDocument {
  if (document.sourceType !== "document" && document.sourceType !== "pdf") return document;
  const title = normalizePercentEncodedText(document.title);
  return title === document.title ? document : { ...document, title };
}

export function normalizeUploadedDocumentsForDisplay(documents: ReadingDocument[]): ReadingDocument[] {
  return documents.map(normalizeUploadedDocumentForDisplay);
}

export function normalizePercentEncodedText(value: string): string {
  const trimmed = value.trim();
  if (!/%[0-9a-f]{2}/i.test(trimmed)) return trimmed;
  try {
    return decodeURIComponent(trimmed)
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return trimmed;
  }
}
