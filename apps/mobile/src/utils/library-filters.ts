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
