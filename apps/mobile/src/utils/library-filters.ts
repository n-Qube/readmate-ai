import type { ReadingDocument } from "@/types";

export type LibraryFilter = "All" | "Articles" | "Podcasts" | "Documents";

export const libraryFilters: LibraryFilter[] = ["All", "Articles", "Podcasts", "Documents"];

export function matchesLibraryFilter(document: ReadingDocument, filter: LibraryFilter): boolean {
  if (filter === "All") return true;
  if (filter === "Documents") return ["pdf", "document", "ocr"].includes(document.sourceType);
  if (filter === "Podcasts") return document.category.toLowerCase().includes("podcast");
  return ["webpage", "url", "rss", "news", "selection"].includes(document.sourceType)
    && !document.category.toLowerCase().includes("podcast");
}

export function matchesLibrarySearch(document: ReadingDocument, query: string): boolean {
  const value = query.trim().toLowerCase();
  return !value || [document.title, document.author, document.sourceLabel, document.category]
    .filter(Boolean)
    .some((part) => part!.toLowerCase().includes(value));
}

export type LibrarySort = "recent" | "title" | "in_progress";

export const librarySortOrder: LibrarySort[] = ["recent", "title", "in_progress"];

export const librarySortLabels: Record<LibrarySort, string> = {
  recent: "Recently updated",
  title: "Title A–Z",
  in_progress: "In progress first"
};

export function nextLibrarySort(sort: LibrarySort): LibrarySort {
  return librarySortOrder[(librarySortOrder.indexOf(sort) + 1) % librarySortOrder.length];
}

/** Returns a new array; the query cache's document list is never mutated. */
export function sortLibraryDocuments(documents: readonly ReadingDocument[], sort: LibrarySort): ReadingDocument[] {
  const byRecent = (a: ReadingDocument, b: ReadingDocument) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  const sorted = [...documents];
  if (sort === "title") return sorted.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  if (sort === "in_progress") {
    const started = (document: ReadingDocument) => document.progress.percent > 0 && document.progress.percent < 100;
    return sorted.sort((a, b) => Number(started(b)) - Number(started(a)) || byRecent(a, b));
  }
  return sorted.sort(byRecent);
}
