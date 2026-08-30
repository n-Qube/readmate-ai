import type { ReadingDocument } from "../shared/types";

export function libraryEntries(documents: ReadingDocument[]): ReadingDocument[] {
  return [...documents].sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt));
}

export function matchesLibrarySearch(document: ReadingDocument, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;

  return [
    document.title,
    document.author,
    document.sourceLabel,
    document.category,
    document.sourceType
  ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
}

function timestamp(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}
