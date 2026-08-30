import type { SourceSubscription } from "@/types";
import type { SubscribeRssResource } from "./tool-results";

export type WebMcpSourceSubscriptionResponse = SourceSubscription & {
  initialSync?: {
    status: "completed";
    readyDocumentCount?: number;
    completedAt: string;
  };
};

export type RssSubscriptionCompletion = {
  toolStatus: SubscribeRssResource["status"];
  resourceStatus: string;
  message: string;
};

export function rssSubscriptionCompletion(
  source: WebMcpSourceSubscriptionResponse,
  firstName?: string
): RssSubscriptionCompletion {
  const owner = firstName?.trim() ? `${firstName.trim()}'s` : "Your";
  const initialSync = source.initialSync;
  if (!initialSync || initialSync.status !== "completed") {
    return {
      toolStatus: "sync_pending",
      resourceStatus: "Subscribed",
      message: `${owner} RSS subscription is active and queued for sync.`
    };
  }

  const readyDocumentCount = initialSync.readyDocumentCount;
  if (typeof readyDocumentCount === "number") {
    if (readyDocumentCount === 0) {
      return {
        toolStatus: "subscribed",
        resourceStatus: "Subscribed · Feed checked",
        message: `${owner} RSS subscription is active. The initial feed check is complete; no readable articles were available yet.`
      };
    }
    return {
      toolStatus: "subscribed",
      resourceStatus: `Subscribed · ${readyDocumentCount} ${readyDocumentCount === 1 ? "article" : "articles"} ready`,
      message: `${owner} RSS subscription is active. ${readyDocumentCount} initial ${readyDocumentCount === 1 ? "article is" : "articles are"} ready in the library and synced to your devices.`
    };
  }

  return {
    toolStatus: "subscribed",
    resourceStatus: "Subscribed · Initial sync complete",
    message: `${owner} RSS subscription is active. Initial feed sync is complete, and available articles are ready in the library.`
  };
}
