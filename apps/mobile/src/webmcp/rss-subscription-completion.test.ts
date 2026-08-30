import { describe, expect, it } from "vitest";
import type { SourceSubscription } from "@/types";
import {
  rssSubscriptionCompletion,
  type WebMcpSourceSubscriptionResponse
} from "./rss-subscription-completion";

const source: SourceSubscription = {
  id: "source-1",
  userId: "user-1",
  sourceName: "Ghana News",
  websiteUrl: "https://example.com",
  rssFeedUrl: "https://example.com/feed.xml",
  sourceType: "rss",
  topics: [],
  isSubscribed: true,
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z"
};

describe("rssSubscriptionCompletion", () => {
  it("reports initial articles as ready after synchronous WebMCP import", () => {
    const response: WebMcpSourceSubscriptionResponse = {
      ...source,
      initialSync: {
        status: "completed",
        readyDocumentCount: 3,
        completedAt: "2026-08-29T00:00:01.000Z"
      }
    };

    expect(rssSubscriptionCompletion(response, "Daniel")).toEqual({
      toolStatus: "subscribed",
      resourceStatus: "Subscribed · 3 articles ready",
      message: "Daniel's RSS subscription is active. 3 initial articles are ready in the library and synced to your devices."
    });
  });

  it("does not claim articles exist when the completed feed contains none", () => {
    expect(rssSubscriptionCompletion({
      ...source,
      initialSync: {
        status: "completed",
        readyDocumentCount: 0,
        completedAt: "2026-08-29T00:00:01.000Z"
      }
    })).toEqual({
      toolStatus: "subscribed",
      resourceStatus: "Subscribed · Feed checked",
      message: "Your RSS subscription is active. The initial feed check is complete; no readable articles were available yet."
    });
  });

  it("preserves queued fallback wording for legacy API responses", () => {
    expect(rssSubscriptionCompletion(source)).toEqual({
      toolStatus: "sync_pending",
      resourceStatus: "Subscribed",
      message: "Your RSS subscription is active and queued for sync."
    });
  });
});
