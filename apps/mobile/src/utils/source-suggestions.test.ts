import { describe, expect, it } from "vitest";
import { sourceFromQuery } from "./source-suggestions";

describe("sourceFromQuery", () => {
  it("does not claim that an ordinary web page has an RSS feed", () => {
    expect(sourceFromQuery("https://example.com")?.rssUrl).toBeUndefined();
  });

  it.each([
    "https://example.com/feed/",
    "https://example.com/rss.xml",
    "https://example.com/news?format=rss"
  ])("keeps an explicitly entered feed URL available for RSS subscription", (url) => {
    expect(sourceFromQuery(url)?.rssUrl).toBe(url);
  });
});
