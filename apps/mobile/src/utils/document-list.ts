import type { ReadingDocument } from "@/types";

export function prependDocument(documents: ReadingDocument[], next: ReadingDocument): ReadingDocument[] {
  return [next, ...documents.filter((document) => document.id !== next.id)];
}

export function dedupeDocuments(documents: ReadingDocument[]): ReadingDocument[] {
  const seen = new Set<string>();
  const result: ReadingDocument[] = [];
  for (const document of documents) {
    const key = duplicateKey(document);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    result.push(document);
  }
  return result;
}

export function balanceFeedDocuments(documents: ReadingDocument[]): ReadingDocument[] {
  const feedIndexes = documents
    .map((document, index) => ({ document, index }))
    .filter(({ document }) => isFeedDocument(document));
  if (feedIndexes.length < 3) return documents;

  const bySource = new Map<string, ReadingDocument[]>();
  for (const { document } of feedIndexes) {
    const key = sourceKey(document);
    bySource.set(key, [...(bySource.get(key) ?? []), document]);
  }
  if (bySource.size < 2) return documents;

  const balancedFeeds: ReadingDocument[] = [];
  const groups = [...bySource.values()];
  while (groups.some((group) => group.length)) {
    for (const group of groups) {
      const next = group.shift();
      if (next) balancedFeeds.push(next);
    }
  }

  let feedCursor = 0;
  return documents.map((document) => (isFeedDocument(document) ? balancedFeeds[feedCursor++] : document));
}

function duplicateKey(document: ReadingDocument): string | undefined {
  const url = normalizedUrl(document.canonicalUrl) ?? normalizedUrl(document.sourceUrl);
  if (url) return `url:${url}`;
  if (document.dedupeKey) return `dedupe:${document.dedupeKey.replace(/^rss:[^:]+:/, "rss:")}`;
  if (isFeedDocument(document)) return `feed-title:${normalizedTitle(document.title)}`;
  return undefined;
}

function sourceKey(document: ReadingDocument): string {
  return document.sourceLabel?.trim().toLowerCase() || normalizedUrl(document.rssFeedUrl) || normalizedUrl(document.sourceUrl) || document.category.toLowerCase();
}

function isFeedDocument(document: ReadingDocument): boolean {
  return document.sourceType === "rss" || document.sourceType === "news";
}

function normalizedTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizedUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") parsed.protocol = "https:";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(fbclid|gclid|mc_cid|mc_eid|igshid|ref|ref_src|ocid|ito|outputType)$/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.searchParams.sort();
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.href;
  } catch {
    return undefined;
  }
}
