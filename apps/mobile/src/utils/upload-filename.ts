import type { ReadingDocument } from "@/types";

const documentExtension = /\.(pdf|epub|docx?|txt|md|markdown|rtf)$/i;

export function normalizeUploadFilename(filename: string): string {
  const trimmed = filename.trim();
  let decoded = trimmed;
  try {
    if (/%[0-9a-f]{2}/i.test(trimmed)) decoded = decodeURIComponent(trimmed);
  } catch {
    decoded = trimmed;
  }
  return decoded
    .replace(/[\u0000-\u001f\u007f/\\]/g, "-")
    .replace(/\s+/g, " ")
    .trim() || "upload";
}

export function documentTitleFromFilename(filename: string): string {
  return normalizeUploadFilename(filename).replace(documentExtension, "").trim() || "Untitled document";
}

export function normalizeUploadedDocumentForDisplay(document: ReadingDocument): ReadingDocument {
  if (document.sourceType !== "document" && document.sourceType !== "pdf") return document;
  const title = normalizePercentEncodedText(document.title);
  return title === document.title ? document : { ...document, title };
}

function normalizePercentEncodedText(value: string): string {
  const trimmed = value.trim();
  if (!/%[0-9a-f]{2}/i.test(trimmed)) return trimmed;
  try {
    return decodeURIComponent(trimmed).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  } catch {
    return trimmed;
  }
}
