import type { ReadingDocument } from "@/types";

export type SourceSuggestion = {
  id: string;
  name: string;
  sourceLabel: string;
  url: string;
  rssUrl?: string;
  category: string;
  thumbnailUrl?: string;
};

export const topicCategories = ["News", "Technology", "Business", "Politics", "Health", "Sports", "Entertainment", "Documents"];

const catalog: SourceSuggestion[] = [
  { id: "cnn", name: "CNN", sourceLabel: "CNN", url: "https://edition.cnn.com", rssUrl: "http://rss.cnn.com/rss/edition.rss", category: "News" },
  { id: "engadget", name: "Engadget", sourceLabel: "Engadget", url: "https://www.engadget.com", rssUrl: "https://www.engadget.com/rss.xml", category: "Technology" },
  { id: "myjoyonline", name: "MyJoyOnline", sourceLabel: "MyJoyOnline", url: "https://www.myjoyonline.com", rssUrl: "https://www.myjoyonline.com/feed/", category: "News" },
  { id: "bbc", name: "BBC News", sourceLabel: "BBC", url: "https://www.bbc.com/news", rssUrl: "https://feeds.bbci.co.uk/news/rss.xml", category: "News" },
  { id: "reuters", name: "Reuters", sourceLabel: "Reuters", url: "https://www.reuters.com", category: "Business" },
  { id: "techcrunch", name: "TechCrunch", sourceLabel: "TechCrunch", url: "https://techcrunch.com", rssUrl: "https://techcrunch.com/feed/", category: "Technology" },
  { id: "the-verge", name: "The Verge", sourceLabel: "The Verge", url: "https://www.theverge.com", rssUrl: "https://www.theverge.com/rss/index.xml", category: "Technology" },
  { id: "espn", name: "ESPN", sourceLabel: "ESPN", url: "https://www.espn.com", rssUrl: "https://www.espn.com/espn/rss/news", category: "Sports" },
  { id: "ghanaweb", name: "GhanaWeb", sourceLabel: "GhanaWeb", url: "https://www.ghanaweb.com", category: "News" }
];

export function suggestSources(query: string): SourceSuggestion[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return catalog.slice(0, 5);
  const matches = catalog.filter((source) =>
    [source.name, source.sourceLabel, source.url, source.rssUrl ?? ""].some((value) => value.toLowerCase().includes(normalized))
  );
  const custom = sourceFromQuery(query);
  return custom ? [...matches, custom].slice(0, 6) : matches.slice(0, 6);
}

export function sourceFromQuery(query: string): SourceSuggestion | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(hasProtocol(trimmed) ? trimmed : `https://${trimmed.includes(".") ? trimmed : `${trimmed}.com`}`);
    const host = url.hostname.replace(/^www\./, "");
    const label = titleCase(host.split(".")[0] ?? host);
    const rssUrl = looksLikeFeedUrl(url) ? url.href : undefined;
    return {
      id: `custom-${host}`,
      name: label,
      sourceLabel: label,
      url: url.href,
      ...(rssUrl ? { rssUrl } : {}),
      category: inferTopicCategory(`${label} ${host}`)
    };
  } catch {
    return null;
  }
}

export function inferTopicCategory(text: string, fallback = "News"): string {
  const haystack = text.toLowerCase();
  if (/\b(ai|artificial intelligence|software|startup|apple|google|microsoft|tesla|chip|cyber|gadget|technology|tech)\b/.test(haystack)) return "Technology";
  if (/\b(election|president|parliament|minister|government|policy|campaign|senate|court|law|politics)\b/.test(haystack)) return "Politics";
  if (/\b(market|stock|bank|finance|economy|business|revenue|profit|investor|trade|inflation)\b/.test(haystack)) return "Business";
  if (/\b(health|medical|doctor|hospital|fitness|disease|wellness|vaccine|nutrition)\b/.test(haystack)) return "Health";
  if (/\b(sport|football|soccer|nba|nfl|tennis|golf|boxing|rugby|athlete|match)\b/.test(haystack)) return "Sports";
  if (/\b(movie|music|celebrity|entertainment|film|tv|streaming|culture)\b/.test(haystack)) return "Entertainment";
  return fallback;
}

export function categoryForDocument(document: ReadingDocument): string {
  return document.category || inferTopicCategory(`${document.title} ${document.description ?? ""}`, "News");
}

function hasProtocol(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function looksLikeFeedUrl(url: URL): boolean {
  const pathAndQuery = `${url.pathname}${url.search}`.toLowerCase();
  return /(?:^|[\/.?&=_-])(feed|rss|atom)(?:$|[\/.?&=_-])/.test(pathAndQuery)
    || /\.(xml|rss|atom)(?:$|[?#])/.test(pathAndQuery);
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
