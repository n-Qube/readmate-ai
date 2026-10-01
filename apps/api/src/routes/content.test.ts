import express from "express";
import { readFileSync } from "node:fs";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthedRequest } from "../auth.js";
import { supportedDocumentInfo, type ExtractedDocumentBlock } from "../documents/extractDocumentText.js";
import type { MediaStorage } from "../media.js";
import type { HostLookup } from "../safeRemoteFetch.js";
import type { WorkLimiter } from "../workLimiter.js";
import { entitlementForPlan, PremiumRequiredError } from "../entitlements.js";
import { contentRouter, saveRssFeed } from "./content.js";
import type { DocumentRepository } from "./documents.js";
import type { SettingsRepository } from "./settings.js";
import { TrackedRssDocumentHydrationError } from "./sources.js";
import type { FinalizedSourceSync, SourceRepository, SourceSubscriptionResponse } from "./sources.js";
import type { UploadRecordResponse, UploadRepository, UploadStorage } from "./uploads.js";
import { WebMcpActionIdempotencyError } from "../webmcp/actionIdempotency.js";
import { AccountDeletionFencedError } from "../webmcp/accountDeletionFence.js";
import type {
  ClaimedWebMcpAuditEvent,
  WebMcpActionIdempotencyRepository,
  WebMcpAuditEvent,
  RecordWebMcpAuditEventInput
} from "../webmcp/auditRepository.js";

function createTestApp(deps: {
  documentRepository: DocumentRepository;
  sourceRepository: SourceRepository;
  uploadRepository: UploadRepository;
  storage: UploadStorage;
  mediaStorage: MediaStorage;
  fetcher?: typeof fetch;
  lookup?: HostLookup;
  documentTextExtractor?: (bytes: Uint8Array, info: ReturnType<typeof supportedDocumentInfo>) => Promise<ExtractedDocumentBlock[]>;
  settingsRepository?: SettingsRepository;
  documentWorkLimiter?: WorkLimiter;
  webMcpActionRepository?: WebMcpActionIdempotencyRepository;
  webMcpDigestKey?: string;
  accountDeletionGuard?: (userId: string) => Promise<void>;
}) {
  const app = express();
  app.use(express.json());
  app.use((req: AuthedRequest, _res, next) => {
    req.userId = String(req.header("x-test-user") ?? "user_a");
    next();
  });
  app.use(
    "/api/content",
    contentRouter({
      ...deps,
      lookup: deps.lookup ?? (async () => ["93.184.216.34"]),
      settingsRepository: deps.settingsRepository ?? createMemorySettingsRepository(),
      accountDeletionGuard: deps.accountDeletionGuard ?? (async () => undefined),
      documentTextExtractor: deps.documentTextExtractor ?? (async (_bytes: Uint8Array, info) => [
        {
          orderIndex: 0,
          blockType: "page",
          text: `Readable ${info.label} text`,
          sourcePageNumber: 1
        },
        {
          orderIndex: 1,
          blockType: "page",
          text: `Second readable ${info.label} page`,
          sourcePageNumber: 2
        }
      ])
    })
  );
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof WebMcpActionIdempotencyError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof AccountDeletionFencedError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : "Unexpected error" });
  });
  return app;
}

function createMemorySettingsRepository(articlesPerFeed = 10): SettingsRepository {
  return {
    async getOrCreateSettings(userId) {
      return {
        userId,
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1,
        tone: "calm and clear",
        targetLanguage: "en",
        autoScroll: true,
        highlightMode: "paragraph",
        preferredContentTypes: ["webpage", "pdf", "rss", "url"],
        articlesPerFeed,
        updatedAt: "2026-05-23T12:00:00.000Z"
      };
    },
    async updateSettings(userId, input) {
      return {
        userId,
        ...input,
        tone: input.tone ?? undefined,
        updatedAt: "2026-05-23T12:00:00.000Z"
      };
    }
  };
}

function createMemoryDocumentRepository(): DocumentRepository {
  const documents = new Map<string, Awaited<ReturnType<DocumentRepository["createDocument"]>>>();
  let nextId = 1;

  return {
    async createDocument(userId, input) {
      const duplicate = [...documents.values()].find(
        (document) =>
          document.userId === userId &&
          ((input.dedupeKey && document.dedupeKey === input.dedupeKey) ||
            (input.canonicalUrl && document.canonicalUrl === input.canonicalUrl) ||
            (input.sourceUrl && document.sourceUrl === input.sourceUrl))
      );
      if (duplicate) return duplicate;

      const now = "2026-05-23T12:00:00.000Z";
      const document = {
        id: `doc_${nextId++}`,
        userId,
        title: input.title,
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl,
        canonicalUrl: input.canonicalUrl,
        rssFeedUrl: input.rssFeedUrl,
        dedupeKey: input.dedupeKey,
        category: input.category,
        sourceLabel: input.sourceLabel,
        thumbnailUrl: input.thumbnailUrl,
        coverImageUrl: input.coverImageUrl,
        author: input.author,
        description: input.description,
        contentHtml: input.contentHtml,
        topicTags: input.topicTags,
        estimatedListeningSeconds: input.estimatedListeningSeconds,
        pageCount: input.pageCount,
        status: input.status ?? "unread",
        summary: input.summary,
        keyPoints: input.keyPoints,
        quizQuestions: input.quizQuestions,
        flashcards: input.flashcards,
        createdAt: now,
        updatedAt: now,
        progress: input.progress,
        provider: input.provider,
        voice: input.voice,
        speed: input.speed,
        blocks: input.blocks.map((block, index) => ({
          id: `block_${nextId}_${index}`,
          orderIndex: block.orderIndex ?? index,
          blockType: block.blockType,
          text: block.text,
          sourceSelector: block.sourceSelector,
          sourcePageNumber: block.sourcePageNumber
        }))
      };
      documents.set(document.id, document);
      return document;
    },
    async listDocuments(userId) {
      return [...documents.values()].filter((document) => document.userId === userId);
    },
    async getDocument(userId, documentId) {
      const document = documents.get(documentId);
      return document?.userId === userId ? document : null;
    },
    async updateProgress() {
      return null;
    },
    async updateDocument() {
      return null;
    },
    async clearDocumentHistory() {
      return null;
    },
    async clearHistory() {
      return 0;
    },
    async deleteDocument(userId, documentId) {
      const document = documents.get(documentId);
      if (!document || document.userId !== userId) return false;
      documents.delete(documentId);
      return true;
    },
    async deleteCompletedDocuments() {
      return 0;
    }
  };
}

function createMemorySourceRepository(): SourceRepository {
  const sources = new Map<string, SourceSubscriptionResponse>();
  let nextId = 1;
  return {
    async listSources(userId) {
      return [...sources.values()].filter((source) => source.userId === userId && source.isSubscribed);
    },
    async subscribeSource(userId, input) {
      const existing = [...sources.values()].find(
        (source) =>
          source.userId === userId &&
          ((input.websiteUrl && source.websiteUrl === input.websiteUrl) || (input.rssFeedUrl && source.rssFeedUrl === input.rssFeedUrl))
      );
      if (existing) {
        const updated = {
          ...existing,
          sourceName: input.sourceName,
          websiteUrl: input.websiteUrl,
          rssFeedUrl: input.rssFeedUrl,
          sourceType: input.sourceType,
          topics: input.topics,
          isSubscribed: true
        };
        sources.set(existing.id, updated);
        return updated;
      }
      const now = "2026-05-23T12:00:00.000Z";
      const source: SourceSubscriptionResponse = {
        id: `source_${nextId++}`,
        userId,
        sourceName: input.sourceName,
        websiteUrl: input.websiteUrl,
        rssFeedUrl: input.rssFeedUrl,
        sourceType: input.sourceType,
        topics: input.topics,
        isSubscribed: true,
        createdAt: now,
        updatedAt: now
      };
      sources.set(source.id, source);
      return source;
    },
    async markSourceSynced(userId, sourceId, syncedAt) {
      const source = sources.get(sourceId);
      if (!source || source.userId !== userId || !source.isSubscribed) return null;
      const updated = {
        ...source,
        lastSyncedAt: syncedAt.toISOString(),
        updatedAt: syncedAt.toISOString()
      };
      sources.set(sourceId, updated);
      return updated;
    },
    async finalizeSourceSync(userId, input, syncedAt) {
      const existing = [...sources.values()].find(
        (source) => source.userId === userId &&
          ((input.websiteUrl && source.websiteUrl === input.websiteUrl) ||
            (input.rssFeedUrl && source.rssFeedUrl === input.rssFeedUrl))
      );
      const previousSource = existing ? { ...existing } : undefined;
      const now = syncedAt.toISOString();
      const source: SourceSubscriptionResponse = existing
        ? {
            ...existing,
            sourceName: input.sourceName,
            websiteUrl: input.websiteUrl,
            rssFeedUrl: input.rssFeedUrl,
            sourceType: input.sourceType,
            topics: input.topics,
            isSubscribed: true,
            lastSyncedAt: now,
            updatedAt: now
          }
        : {
            id: `source_${nextId++}`,
            userId,
            sourceName: input.sourceName,
            websiteUrl: input.websiteUrl,
            rssFeedUrl: input.rssFeedUrl,
            sourceType: input.sourceType,
            topics: input.topics,
            isSubscribed: true,
            lastSyncedAt: now,
            createdAt: now,
            updatedAt: now
          };
      sources.set(source.id, source);
      return { source, previousSource };
    },
    async rollbackFinalizedSourceSync(userId, mutation: FinalizedSourceSync) {
      const current = sources.get(mutation.source.id);
      if (!current || current.userId !== userId) throw new Error("Test source is unavailable for rollback.");
      if (mutation.previousSource) sources.set(mutation.source.id, mutation.previousSource);
      else sources.delete(mutation.source.id);
    },
    async updateSource() {
      return null;
    },
    async removeSource() {
      return false;
    }
  };
}

function createMemoryUploadRepository(): UploadRepository {
  const uploads = new Map<string, UploadRecordResponse & { userId: string }>();
  let nextId = 1;
  return {
    async createUpload(userId, input, storageKey) {
      const upload = {
        id: `upload_${nextId++}`,
        userId,
        filename: input.filename,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        storageBucket: "readmate-uploads",
        storageKey,
        documentId: input.documentId,
        createdAt: "2026-05-23T12:00:00.000Z"
      };
      uploads.set(upload.id, upload);
      return upload;
    },
    async getUpload(userId, uploadId) {
      const upload = uploads.get(uploadId);
      return upload?.userId === userId ? upload : null;
    },
    async attachDocument(userId, uploadId, documentId) {
      const upload = uploads.get(uploadId);
      if (!upload || upload.userId !== userId) return null;
      const updated = { ...upload, documentId };
      uploads.set(uploadId, updated);
      return updated;
    },
    async deleteUpload(userId, uploadId) {
      const upload = uploads.get(uploadId);
      if (!upload || upload.userId !== userId) return false;
      uploads.delete(uploadId);
      return true;
    }
  };
}

function createMemoryStorage(): UploadStorage {
  const files = new Map<string, Uint8Array>();
  return {
    async createSignedUploadUrl(storageKey) {
      return { signedUrl: `https://storage.example/upload/${storageKey}` };
    },
    async createSignedDownloadUrl(storageKey) {
      return { signedUrl: `https://storage.example/download/${storageKey}` };
    },
    async uploadFile(storageKey, bytes) {
      files.set(storageKey, bytes);
    },
    async deleteFile(storageKey) {
      files.delete(storageKey);
    },
    async downloadFile(storageKey) {
      return files.get(storageKey) ?? new Uint8Array();
    }
  };
}

function createMemoryMediaStorage(): MediaStorage {
  const files = new Map<string, { bytes: Uint8Array; mimeType: string }>();
  return {
    async uploadPublicObject(storageKey, bytes, mimeType) {
      files.set(storageKey, { bytes, mimeType });
      return { storageKey, publicUrl: `https://media.example/${storageKey}` };
    },
    async deletePublicObjects(storageKeys) {
      storageKeys.forEach((storageKey) => files.delete(storageKey));
    }
  };
}

function createMemoryWebMcpActionRepository(): WebMcpActionIdempotencyRepository {
  const events = new Map<string, WebMcpAuditEvent & { claimToken?: string }>();
  const keyFor = (input: { userId: string; requestId?: string; toolName: string }) =>
    `${input.userId}\u0000${input.requestId ?? ""}\u0000${input.toolName}`;
  return {
    async claimAction(input) {
      const key = keyFor(input);
      const existing = events.get(key);
      if (existing) {
        if (existing.actionClass !== input.actionClass || existing.actionDigest !== input.actionDigest) {
          return { kind: "conflict", event: withoutClaimToken(existing) };
        }
        if (existing.status === "succeeded") return { kind: "replay", event: withoutClaimToken(existing) };
        if (existing.status === "failed") return { kind: "failed", event: withoutClaimToken(existing) };
        if (existing.status === "cancelled") return { kind: "cancelled", event: withoutClaimToken(existing) };
        return { kind: "in_progress", event: withoutClaimToken(existing) };
      }
      const event: ClaimedWebMcpAuditEvent = {
        id: `audit_${events.size + 1}`,
        userId: input.userId,
        requestId: input.requestId,
        toolName: input.toolName,
        actionClass: input.actionClass,
        actionDigest: input.actionDigest,
        claimToken: "1".repeat(64),
        status: "started",
        createdAt: "2026-08-29T12:00:00.000Z"
      };
      events.set(key, event);
      return { kind: "execute", event };
    },
    async recordEvent(input: RecordWebMcpAuditEventInput) {
      const key = keyFor(input);
      const existing = events.get(key);
      if (!existing) throw new Error("missing action claim");
      if (input.actionDigest !== existing.actionDigest || input.claimToken !== existing.claimToken) {
        return { kind: "conflict", event: withoutClaimToken(existing) };
      }
      const event = {
        ...existing,
        status: input.status,
        resourceType: input.resourceType ?? existing.resourceType,
        resourceId: input.resourceId ?? existing.resourceId,
        claimToken: ["succeeded", "failed", "cancelled"].includes(input.status)
          ? undefined
          : existing.claimToken,
        errorCode: input.errorCode,
        latencyMs: input.latencyMs
      };
      events.set(key, event);
      return { kind: "recorded", event: withoutClaimToken(event), reused: true };
    }
  };
}

function withoutClaimToken(event: WebMcpAuditEvent & { claimToken?: string }): WebMcpAuditEvent {
  const { claimToken: _privateClaimToken, ...safe } = event;
  return safe;
}

const tinyImage = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="24"><rect width="40" height="24" fill="#0e7490"/></svg>`);

describe("contentRouter", () => {
  it("imports the exact first-party WebMCP challenge Atom feed", async () => {
    const challengeFeed = readFileSync(
      new URL("../../../mobile/public/challenge-feed.xml", import.meta.url),
      "utf8"
    );
    const documentRepository = createMemoryDocumentRepository();
    const sourceRepository = createMemorySourceRepository();
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("/challenge-feed.xml")) {
        return new Response(challengeFeed, {
          status: 200,
          headers: { "content-type": "application/atom+xml; charset=utf-8" }
        });
      }
      return new Response("Article fixture unavailable during parser-only test.", { status: 404 });
    });

    const result = await saveRssFeed({
      userId: "challenge_judge",
      url: "https://app.readmate.n-qube.com/challenge-feed.xml",
      provider: "google",
      voice: "en-US-Neural2-F",
      speed: 1,
      documentRepository,
      sourceRepository,
      mediaStorage: createMemoryMediaStorage(),
      fetcher,
      lookup: async () => ["93.184.216.34"],
      entitlement: entitlementForPlan("free"),
      requireHttps: true
    });

    expect(result.source.sourceName).toBe("ReadMate AI Challenge Reading");
    expect(result.source.rssFeedUrl).toBe("https://app.readmate.n-qube.com/challenge-feed.xml");
    expect(result.documents).toHaveLength(2);
    expect(result.documents.map((document) => document.title)).toEqual([
      "Reading and digital learning in Ghana",
      "ReadMate AI WebMCP Challenge walkthrough"
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("enforces the owner's document limit during background-style RSS ingestion", async () => {
    const free = entitlementForPlan("free");
    const fetcher = vi.fn<typeof fetch>(async () => new Response(
      `<?xml version="1.0"?><rss version="2.0"><channel><title>Controlled Feed</title><item><title>Oversized update</title><description>${"Readable feed content ".repeat(30)}</description></item></channel></rss>`,
      { status: 200, headers: { "content-type": "application/rss+xml" } }
    ));

    await expect(saveRssFeed({
      userId: "free_reader",
      url: "https://example.com/feed.xml",
      provider: "google",
      voice: "en-US-Neural2-F",
      speed: 1,
      documentRepository: createMemoryDocumentRepository(),
      sourceRepository: createMemorySourceRepository(),
      mediaStorage: createMemoryMediaStorage(),
      fetcher,
      lookup: async () => ["93.184.216.34"],
      entitlement: { ...free, limits: { ...free.limits, maxDocumentCharacters: 80 } }
    })).rejects.toBeInstanceOf(PremiumRequiredError);
  });

  it("does not follow an HTTPS WebMCP feed redirect to HTTP or leave hidden data", async () => {
    const documentRepository = createMemoryDocumentRepository();
    const sourceRepository = createMemorySourceRepository();
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, {
      status: 302,
      headers: { location: "http://feeds.example.com/downgraded.xml" }
    }));

    await expect(saveRssFeed({
      userId: "webmcp_reader",
      url: "https://feeds.example.com/feed.xml",
      provider: "google",
      voice: "en-US-Neural2-F",
      speed: 1,
      documentRepository,
      sourceRepository,
      mediaStorage: createMemoryMediaStorage(),
      fetcher,
      lookup: async () => ["93.184.216.34"],
      entitlement: entitlementForPlan("free"),
      requireHttps: true
    })).rejects.toThrow("could not find a working RSS feed");

    expect(fetcher).toHaveBeenCalled();
    expect(fetcher.mock.calls.every(([url]) => String(url).startsWith("https://"))).toBe(true);
    await expect(documentRepository.listDocuments("webmcp_reader")).resolves.toEqual([]);
    await expect(sourceRepository.listSources("webmcp_reader")).resolves.toEqual([]);
  });

  it("preserves the confirmed canonical feed identity when HTTPS fetching resolves to another URL", async () => {
    const requestedFeed = "https://Feeds.Example.com/original.xml?b=2&a=1#latest";
    const confirmedFeed = "https://feeds.example.com/original.xml?a=1&b=2";
    const resolvedFeed = "https://cdn.example.com/resolved.xml";
    const documentRepository = createMemoryDocumentRepository();
    const sourceRepository = createMemorySourceRepository();
    const mediaStorage = createMemoryMediaStorage();
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes("/original.xml")) {
        return new Response(null, { status: 302, headers: { location: resolvedFeed } });
      }
      return new Response(
        `<?xml version="1.0"?><rss version="2.0"><channel><title>Redirected Feed</title>
          <item><guid>redirected-story</guid><title>Redirected story</title><description>This redirected story contains enough readable words for a complete ReadMate listening document.</description></item>
        </channel></rss>`,
        { status: 200, headers: { "content-type": "application/rss+xml" } }
      );
    });

    const result = await saveRssFeed({
      userId: "webmcp_reader",
      url: requestedFeed,
      subscriptionFeedUrl: confirmedFeed,
      provider: "google",
      voice: "en-US-Neural2-F",
      speed: 1,
      documentRepository,
      sourceRepository,
      mediaStorage,
      fetcher,
      lookup: async () => ["93.184.216.34"],
      entitlement: entitlementForPlan("free"),
      requireHttps: true
    });

    expect(result.source.rssFeedUrl).toBe(confirmedFeed);
    expect(result.documents[0]?.rssFeedUrl).toBe(resolvedFeed);

    const refreshed = await saveRssFeed({
      userId: "webmcp_reader",
      url: result.source.rssFeedUrl!,
      subscriptionFeedUrl: result.source.rssFeedUrl!,
      title: result.source.sourceName,
      provider: "google",
      voice: "en-US-Neural2-F",
      speed: 1,
      documentRepository,
      sourceRepository,
      mediaStorage,
      fetcher,
      lookup: async () => ["93.184.216.34"],
      entitlement: entitlementForPlan("free"),
      requireHttps: true
    });

    expect(refreshed.source.id).toBe(result.source.id);
    expect(refreshed.source.rssFeedUrl).toBe(confirmedFeed);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("deletes newly imported documents when source finalization fails", async () => {
    const documentRepository = createMemoryDocumentRepository();
    const cachedMedia = new Set<string>();
    const deletePublicObjects = vi.fn(async (storageKeys: string[]) => {
      storageKeys.forEach((storageKey) => cachedMedia.delete(storageKey));
    });
    const mediaStorage: MediaStorage = {
      async uploadPublicObject(storageKey) {
        cachedMedia.add(storageKey);
        return { storageKey, publicUrl: `https://media.example/${storageKey}` };
      },
      deletePublicObjects
    };
    const baseSourceRepository = createMemorySourceRepository();
    const sourceRepository: SourceRepository = {
      ...baseSourceRepository,
      async finalizeSourceSync() {
        throw new Error("source finalization failed");
      },
      async rollbackFinalizedSourceSync() {}
    };
    const fetcher = vi.fn<typeof fetch>(async () => new Response(
      `<?xml version="1.0"?><rss version="2.0"><channel><title>Atomic Feed</title>
        <item><guid>first</guid><title>First readable story</title><description>First story has enough readable words for a complete ReadMate listening document today.</description></item>
        <item><guid>second</guid><title>Second readable story</title><description>Second story also has enough readable words for another ReadMate listening document today.</description></item>
      </channel></rss>`,
      { status: 200, headers: { "content-type": "application/rss+xml" } }
    ));
    const createDocumentTracked = async (userId: string, input: Parameters<DocumentRepository["createDocument"]>[1]) => {
      const before = new Set((await documentRepository.listDocuments(userId)).map((document) => document.id));
      const document = await documentRepository.createDocument(userId, input);
      return { document, created: !before.has(document.id) };
    };

    await expect(saveRssFeed({
      userId: "webmcp_reader",
      url: "https://feeds.example.com/feed.xml",
      provider: "google",
      voice: "en-US-Neural2-F",
      speed: 1,
      documentRepository,
      sourceRepository,
      mediaStorage,
      fetcher,
      lookup: async () => ["93.184.216.34"],
      entitlement: entitlementForPlan("free"),
      requireHttps: true,
      createDocumentTracked,
      deleteCreatedDocument: async (userId, documentId) => {
        if (!await documentRepository.deleteDocument(userId, documentId)) {
          throw new Error("Test document could not be removed.");
        }
      }
    })).rejects.toThrow("source finalization failed");

    await expect(documentRepository.listDocuments("webmcp_reader")).resolves.toEqual([]);
    await expect(sourceRepository.listSources("webmcp_reader")).resolves.toEqual([]);
    expect(cachedMedia.size).toBe(0);
    expect(deletePublicObjects).toHaveBeenCalledTimes(1);
    expect(deletePublicObjects.mock.calls[0]?.[0]).toHaveLength(4);
    expect(deletePublicObjects.mock.calls[0]?.[0].every((key) => key.includes("webmcp_reader/documents/"))).toBe(true);
  });

  it("retries cleanup of a partial cover upload through the RSS compensation path", async () => {
    const documentRepository = createMemoryDocumentRepository();
    const sourceRepository = createMemorySourceRepository();
    const cachedMedia = new Set<string>();
    let deleteAttempts = 0;
    const mediaStorage: MediaStorage = {
      async uploadPublicObject(storageKey) {
        if (storageKey.endsWith("thumb.svg")) throw new Error("thumbnail upload failed");
        cachedMedia.add(storageKey);
        return { storageKey, publicUrl: `https://media.example/${storageKey}` };
      },
      async deletePublicObjects(storageKeys) {
        deleteAttempts += 1;
        if (deleteAttempts === 1) throw new Error("temporary media deletion failure");
        storageKeys.forEach((storageKey) => cachedMedia.delete(storageKey));
      }
    };
    const fetcher = vi.fn<typeof fetch>(async () => new Response(
      `<?xml version="1.0"?><rss version="2.0"><channel><title>Partial Media Feed</title>
        <item><guid>partial-media</guid><title>Readable story</title><description>This story contains enough readable words to make a complete ReadMate listening document today.</description></item>
      </channel></rss>`,
      { status: 200, headers: { "content-type": "application/rss+xml" } }
    ));
    const createDocumentTracked = vi.fn(async () => {
      throw new Error("Document creation must not run after cover preparation fails.");
    });

    await expect(saveRssFeed({
      userId: "webmcp_reader",
      url: "https://feeds.example.com/feed.xml",
      provider: "google",
      voice: "en-US-Neural2-F",
      speed: 1,
      documentRepository,
      sourceRepository,
      mediaStorage,
      fetcher,
      lookup: async () => ["93.184.216.34"],
      entitlement: entitlementForPlan("free"),
      requireHttps: true,
      createDocumentTracked,
      deleteCreatedDocument: async () => undefined
    })).rejects.toThrow("Cached cover upload failed and its partial upload could not be removed.");

    expect(createDocumentTracked).not.toHaveBeenCalled();
    expect(deleteAttempts).toBe(2);
    expect(cachedMedia.size).toBe(0);
    await expect(documentRepository.listDocuments("webmcp_reader")).resolves.toEqual([]);
    await expect(sourceRepository.listSources("webmcp_reader")).resolves.toEqual([]);
  });

  it("retries deletion when tracked-document hydration cleanup exposes an orphan ID", async () => {
    const documentRepository = createMemoryDocumentRepository();
    const sourceRepository = createMemorySourceRepository();
    const deleteCreatedDocument = vi.fn(async () => undefined);
    const fetcher = vi.fn<typeof fetch>(async () => new Response(
      `<?xml version="1.0"?><rss version="2.0"><channel><title>Hydration Feed</title>
        <item><guid>hydration-story</guid><title>Hydration story</title><description>This story contains enough readable words to create a ReadMate listening document for rollback testing.</description></item>
      </channel></rss>`,
      { status: 200, headers: { "content-type": "application/rss+xml" } }
    ));

    await expect(saveRssFeed({
      userId: "webmcp_reader",
      url: "https://feeds.example.com/feed.xml",
      provider: "google",
      voice: "en-US-Neural2-F",
      speed: 1,
      documentRepository,
      sourceRepository,
      mediaStorage: createMemoryMediaStorage(),
      fetcher,
      lookup: async () => ["93.184.216.34"],
      entitlement: entitlementForPlan("free"),
      requireHttps: true,
      createDocumentTracked: async () => {
        throw new TrackedRssDocumentHydrationError(
          "orphaned_rss_document",
          new Error("hydration failed"),
          new Error("first cleanup failed")
        );
      },
      deleteCreatedDocument
    })).rejects.toThrow("A newly imported RSS document could not be loaded or removed.");

    expect(deleteCreatedDocument).toHaveBeenCalledWith("webmcp_reader", "orphaned_rss_document");
    await expect(sourceRepository.listSources("webmcp_reader")).resolves.toEqual([]);
  });

  it("restores an existing subscription and removes only new documents on late rollback", async () => {
    const documentRepository = createMemoryDocumentRepository();
    const sourceRepository = createMemorySourceRepository();
    const original = await sourceRepository.subscribeSource("webmcp_reader", {
      sourceName: "Original feed name",
      rssFeedUrl: "https://feeds.example.com/feed.xml",
      sourceType: "rss",
      topics: ["Original"]
    });
    const fetcher = vi.fn<typeof fetch>(async () => new Response(
      `<?xml version="1.0"?><rss version="2.0"><channel><title>Updated feed name</title>
        <item><guid>new-story</guid><title>New readable story</title><description>This new story contains enough readable words to create a ReadMate listening document today.</description></item>
      </channel></rss>`,
      { status: 200, headers: { "content-type": "application/rss+xml" } }
    ));
    const createDocumentTracked = async (userId: string, input: Parameters<DocumentRepository["createDocument"]>[1]) => {
      const before = new Set((await documentRepository.listDocuments(userId)).map((document) => document.id));
      const document = await documentRepository.createDocument(userId, input);
      return { document, created: !before.has(document.id) };
    };

    const result = await saveRssFeed({
      userId: "webmcp_reader",
      url: "https://feeds.example.com/feed.xml",
      provider: "google",
      voice: "en-US-Neural2-F",
      speed: 1,
      documentRepository,
      sourceRepository,
      mediaStorage: createMemoryMediaStorage(),
      fetcher,
      lookup: async () => ["93.184.216.34"],
      entitlement: entitlementForPlan("free"),
      requireHttps: true,
      createDocumentTracked,
      deleteCreatedDocument: async (userId, documentId) => {
        if (!await documentRepository.deleteDocument(userId, documentId)) {
          throw new Error("Test document could not be removed.");
        }
      }
    });

    expect(result.source.id).toBe(original.id);
    expect(result.source.lastSyncedAt).toEqual(expect.any(String));
    await expect(documentRepository.listDocuments("webmcp_reader")).resolves.toHaveLength(1);
    await result.rollback?.();
    await expect(documentRepository.listDocuments("webmcp_reader")).resolves.toEqual([]);
    await expect(sourceRepository.listSources("webmcp_reader")).resolves.toEqual([original]);
  });

  it("rejects a loopback save URL before invoking the fetcher", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const app = createTestApp({
      documentRepository: createMemoryDocumentRepository(),
      sourceRepository: createMemorySourceRepository(),
      uploadRepository: createMemoryUploadRepository(),
      storage: createMemoryStorage(),
      mediaStorage: createMemoryMediaStorage(),
      fetcher
    });

    await request(app)
      .post("/api/content/save-url")
      .send({
        url: "http://127.0.0.1:8080/internal",
        sourceType: "url",
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1
      })
      .expect(422);

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns a useful error when a public webpage cannot be fetched", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error("temporary upstream failure");
    });
    const app = createTestApp({
      documentRepository: createMemoryDocumentRepository(),
      sourceRepository: createMemorySourceRepository(),
      uploadRepository: createMemoryUploadRepository(),
      storage: createMemoryStorage(),
      mediaStorage: createMemoryMediaStorage(),
      fetcher
    });

    const response = await request(app)
      .post("/api/content/save-url")
      .send({
        url: "https://example.com/article",
        sourceType: "url",
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1
      })
      .expect(422);

    expect(response.body).toEqual({
      error: "ReadMate could not read this webpage. Check that the link is public and opens normally, then try again."
    });
  });

  let documentRepository: DocumentRepository;
  let sourceRepository: SourceRepository;
  let uploadRepository: UploadRepository;
  let storage: UploadStorage;
  let mediaStorage: MediaStorage;

  beforeEach(() => {
    documentRepository = createMemoryDocumentRepository();
    sourceRepository = createMemorySourceRepository();
    uploadRepository = createMemoryUploadRepository();
    storage = createMemoryStorage();
    mediaStorage = createMemoryMediaStorage();
  });

  it("fetches URL content and stores a rich shared document", async () => {
    const fetcher = (async (url: Parameters<typeof fetch>[0]) => {
      if (String(url) === "https://example.com/cover.jpg") {
        return new Response(tinyImage, { status: 200, headers: { "content-type": "image/svg+xml" } });
      }
      return new Response(
        `<html><head>
          <title>AI gadgets reshape work</title>
          <link rel="canonical" href="https://example.com/ai-gadgets" />
          <meta property="og:site_name" content="Example Tech" />
          <meta property="og:image" content="https://example.com/cover.jpg" />
          <meta name="author" content="Ada Writer" />
          <meta name="description" content="A useful technology report." />
        </head><body><article>
          <h1>AI gadgets reshape work</h1>
          <p>Artificial intelligence software and new gadgets are changing how teams study and work every day.</p>
          <p>The article includes enough clean readable article text for ReadMate to create useful listening blocks.</p>
        </article></body></html>`,
        { status: 200 }
      );
    }) as typeof fetch;
    const app = createTestApp({ documentRepository, sourceRepository, uploadRepository, storage, mediaStorage, fetcher });

    const response = await request(app)
      .post("/api/content/save-url")
      .send({
        url: "https://example.com/story",
        sourceType: "url",
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1
      });

    if (response.status !== 201) throw new Error(JSON.stringify(response.body));

    expect(response.body.document).toMatchObject({
      title: "AI gadgets reshape work",
      sourceType: "webpage",
      canonicalUrl: "https://example.com/ai-gadgets",
      sourceLabel: "Example Tech",
      thumbnailUrl: "https://media.example/user_a/documents/ai-gadgets-reshape-work/thumb.webp",
      coverImageUrl: "https://media.example/user_a/documents/ai-gadgets-reshape-work/cover.webp",
      author: "Ada Writer",
      category: "Technology",
      status: "unread",
      // The heading is a sentence of its own now, not glued onto the body.
      summary: expect.stringContaining("Artificial intelligence software"),
      keyPoints: expect.arrayContaining([expect.stringContaining("Artificial intelligence")]),
      quizQuestions: expect.arrayContaining([expect.objectContaining({ question: expect.any(String), answer: expect.any(String) })]),
      flashcards: expect.arrayContaining([expect.objectContaining({ front: expect.any(String), back: expect.any(String) })])
    });
    expect(response.body.document.blocks.length).toBeGreaterThan(1);
    expect(response.body.source).toMatchObject({ sourceName: "Example Tech", websiteUrl: "https://example.com" });
  });

  it("replays a confirmed WebMCP webpage save without fetching or creating it twice", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(
      `<html><head><title>Stable action</title></head><body><article>
        <h1>Stable action</h1>
        <p>This public article contains enough readable content for the first confirmed save request.</p>
        <p>A retry with the same canonical input must reuse the saved document without fetching again.</p>
      </article></body></html>`,
      { status: 200, headers: { "content-type": "text/html" } }
    ));
    const app = createTestApp({
      documentRepository,
      sourceRepository,
      uploadRepository,
      storage,
      mediaStorage,
      fetcher,
      webMcpActionRepository: createMemoryWebMcpActionRepository(),
      webMcpDigestKey: "test-webmcp-action-digest-key-1234567890"
    });
    const payload = {
      url: "https://example.com/stable?action=save",
      sourceType: "webpage",
      category: "Technology",
      preferredLanguage: "gaa",
      provider: "google",
      voice: "en-US-Neural2-F",
      speed: 1
    };

    const first = await request(app)
      .post("/api/content/save-url")
      .set("X-ReadMate-Request-Id", "webmcp-save-12345678")
      .send(payload)
      .expect(201);
    const retry = await request(app)
      .post("/api/content/save-url")
      .set("X-ReadMate-Request-Id", "webmcp-save-12345678")
      .send(payload)
      .expect(200);
    const conflict = await request(app)
      .post("/api/content/save-url")
      .set("X-ReadMate-Request-Id", "webmcp-save-12345678")
      .send({ ...payload, category: "News" })
      .expect(409);

    expect(retry.headers["x-readmate-idempotent-replay"]).toBe("true");
    expect(retry.body.document.id).toBe(first.body.document.id);
    expect(conflict.body.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects an add-page replay whose seeded result is an RSS source", async () => {
    const sourceRepository = createMemorySourceRepository();
    const seededSource = await sourceRepository.subscribeSource("user_a", {
      sourceName: "Seeded RSS result",
      rssFeedUrl: "https://feeds.example.com/seeded.xml",
      sourceType: "rss",
      topics: ["News"]
    });
    const fetcher = vi.fn<typeof fetch>();
    const webMcpActionRepository: WebMcpActionIdempotencyRepository = {
      async claimAction(input) {
        return {
          kind: "replay",
          event: {
            id: "audit_seeded_source",
            userId: input.userId,
            requestId: input.requestId,
            toolName: input.toolName,
            actionClass: input.actionClass,
            actionDigest: input.actionDigest,
            status: "succeeded",
            resourceType: "source",
            resourceId: seededSource.id,
            createdAt: "2026-08-29T12:00:00.000Z"
          }
        };
      },
      async recordEvent() {
        throw new Error("A replay must not record another event.");
      }
    };
    const app = createTestApp({
      documentRepository: createMemoryDocumentRepository(),
      sourceRepository,
      uploadRepository,
      storage,
      mediaStorage,
      fetcher,
      webMcpActionRepository,
      webMcpDigestKey: "test-webmcp-action-digest-key-1234567890"
    });

    const response = await request(app)
      .post("/api/content/save-url")
      .set("X-ReadMate-Request-Id", "webmcp-seeded-source-12345678")
      .send({
        url: "https://example.com/article",
        sourceType: "webpage",
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1
      })
      .expect(409);

    expect(response.body.code).toBe("IDEMPOTENCY_RESOURCE_UNAVAILABLE");
    expect(response.headers["x-readmate-idempotent-replay"]).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(sourceRepository.listSources("user_a")).resolves.toEqual([seededSource]);
  });

  it("does not recreate webpage data when deletion is fenced after the action claim", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(
      `<html><head><title>Late write</title></head><body><article>
        <h1>Late write</h1><p>This article is fetched before account deletion finishes and must not be persisted afterward.</p>
        <p>The deletion fence is checked again immediately before durable source and document writes.</p>
      </article></body></html>`,
      { status: 200, headers: { "content-type": "text/html" } }
    ));
    const subscribeSource = vi.spyOn(sourceRepository, "subscribeSource");
    const createDocument = vi.spyOn(documentRepository, "createDocument");
    const app = createTestApp({
      documentRepository,
      sourceRepository,
      uploadRepository,
      storage,
      mediaStorage,
      fetcher,
      webMcpActionRepository: createMemoryWebMcpActionRepository(),
      webMcpDigestKey: "test-webmcp-action-digest-key-1234567890",
      accountDeletionGuard: async () => { throw new AccountDeletionFencedError(); }
    });

    const response = await request(app)
      .post("/api/content/save-url")
      .set("X-ReadMate-Request-Id", "webmcp-delete-race-12345678")
      .send({
        url: "https://example.com/late-write",
        sourceType: "webpage",
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1
      })
      .expect(409);

    expect(response.body.code).toBe("ACCOUNT_DELETION_IN_PROGRESS");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(subscribeSource).not.toHaveBeenCalled();
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("keeps an explicit WebMCP webpage save on the webpage path when its URL looks like a feed", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(
      `<html><head><title>RSS-shaped article URL</title></head><body><article>
        <h1>RSS-shaped article URL</h1>
        <p>This ordinary webpage happens to end in rss but still contains readable article content for listening.</p>
        <p>An explicit add-webpage action must save one webpage document instead of subscribing to an RSS source.</p>
      </article></body></html>`,
      { status: 200, headers: { "content-type": "text/html" } }
    ));
    const webMcpActionRepository = createMemoryWebMcpActionRepository();
    const recordEvent = vi.spyOn(webMcpActionRepository, "recordEvent");
    const app = createTestApp({
      documentRepository,
      sourceRepository,
      uploadRepository,
      storage,
      mediaStorage,
      fetcher,
      webMcpActionRepository,
      webMcpDigestKey: "test-webmcp-action-digest-key-1234567890"
    });
    const payload = {
      url: "https://example.com/articles/rss",
      sourceType: "webpage",
      provider: "google",
      voice: "en-US-Neural2-F",
      speed: 1
    };

    const first = await request(app)
      .post("/api/content/save-url")
      .set("X-ReadMate-Request-Id", "webmcp-rss-shaped-page-12345678")
      .send(payload)
      .expect(201);
    const retry = await request(app)
      .post("/api/content/save-url")
      .set("X-ReadMate-Request-Id", "webmcp-rss-shaped-page-12345678")
      .send(payload)
      .expect(200);

    expect(first.body.document).toMatchObject({
      title: "RSS-shaped article URL",
      sourceType: "webpage",
      sourceUrl: "https://example.com/articles/rss"
    });
    expect(first.body.source).toMatchObject({ sourceType: "website" });
    expect(first.body.documents).toBeUndefined();
    expect(retry.headers["x-readmate-idempotent-replay"]).toBe("true");
    expect(retry.body.document.id).toBe(first.body.document.id);
    expect(retry.body.documents).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "readmate_add_web_page",
      status: "succeeded",
      resourceType: "document",
      resourceId: first.body.document.id
    }));
    expect(recordEvent).not.toHaveBeenCalledWith(expect.objectContaining({ resourceType: "source" }));
  });

  it.each(["url", "rss"] as const)(
    "rejects confirmed RSS-shaped %s saves before they can bypass the dedicated RSS flow",
    async (sourceType) => {
      const documentRepository = createMemoryDocumentRepository();
      const sourceRepository = createMemorySourceRepository();
      const fetcher = vi.fn<typeof fetch>();
      const webMcpActionRepository = createMemoryWebMcpActionRepository();
      const claimAction = vi.spyOn(webMcpActionRepository, "claimAction");
      const app = createTestApp({
        documentRepository,
        sourceRepository,
        uploadRepository,
        storage,
        mediaStorage,
        fetcher,
        webMcpActionRepository,
        webMcpDigestKey: "test-webmcp-action-digest-key-1234567890"
      });

      const response = await request(app)
        .post("/api/content/save-url")
        .set("X-ReadMate-Request-Id", `webmcp-rss-endpoint-${sourceType}-12345678`)
        .send({
          url: "https://example.com/feed.xml",
          sourceType,
          provider: "google",
          voice: "en-US-Neural2-F",
          speed: 1
        })
        .expect(409);

      expect(response.body.code).toBe("WEBMCP_RSS_ENDPOINT_REQUIRED");
      expect(claimAction).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
      await expect(documentRepository.listDocuments("user_a")).resolves.toEqual([]);
      await expect(sourceRepository.listSources("user_a")).resolves.toEqual([]);
    }
  );

  it("still saves URL content when media storage is unavailable", async () => {
    const fetcher = (async (url: Parameters<typeof fetch>[0]) => {
      if (String(url) === "https://example.com/cover.jpg") {
        return new Response(tinyImage, { status: 200, headers: { "content-type": "image/svg+xml" } });
      }
      return new Response(
        `<html><head>
          <title>AI gadgets reshape work</title>
          <meta property="og:site_name" content="Example Tech" />
          <meta property="og:image" content="https://example.com/cover.jpg" />
        </head><body><article>
          <p>Artificial intelligence software and new gadgets are changing how teams study and work every day.</p>
          <p>The article includes enough clean readable article text for ReadMate to create useful listening blocks.</p>
        </article></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } }
      );
    }) as typeof fetch;
    const failingMediaStorage: MediaStorage = {
      async uploadPublicObject() {
        throw new Error("Storage bucket is unavailable.");
      }
    };
    const app = createTestApp({
      documentRepository,
      sourceRepository,
      uploadRepository,
      storage,
      mediaStorage: failingMediaStorage,
      fetcher
    });

    const response = await request(app)
      .post("/api/content/save-url")
      .send({
        url: "https://example.com/story",
        sourceType: "url",
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1
      })
      .expect(201);

    expect(response.body.document).toMatchObject({
      title: "AI gadgets reshape work",
      sourceType: "webpage",
      thumbnailUrl: "https://example.com/cover.jpg",
      coverImageUrl: "https://example.com/cover.jpg"
    });
    expect(response.body.document.blocks.length).toBeGreaterThan(1);
  });

  it("saves captured webpage text through the content pipeline when source fetching fails", async () => {
    const app = createTestApp({ documentRepository, sourceRepository, uploadRepository, storage, mediaStorage });

    const response = await request(app)
      .post("/api/content/save-selection")
      .send({
        title: "Captured article",
        text: "Google announced several technology updates. The captured article text is still readable enough for listening.",
        sourceUrl: "https://example.com/captured",
        sourceType: "webpage",
        thumbnailUrl: "https://example.com/card.jpg",
        description: "Captured fallback article text.",
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1
      })
      .expect(201);

    expect(response.body.document).toMatchObject({
      title: "Captured article",
      sourceType: "webpage",
      sourceUrl: "https://example.com/captured",
      canonicalUrl: "https://example.com/captured",
      sourceLabel: "example.com",
      thumbnailUrl: "https://example.com/card.jpg",
      description: "Captured fallback article text.",
      status: "unread"
    });
    expect(response.body.document.blocks.length).toBeGreaterThan(0);
  });

  it("discovers RSS feeds from website URLs and stores feed articles", async () => {
    const fetcher = (async (url: Parameters<typeof fetch>[0]) => {
      const value = String(url);
      if (value === "https://example.com/") {
        return new Response(
          `<html><head>
            <title>Example News</title>
            <link rel="alternate" type="application/rss+xml" title="Example RSS" href="/feed.xml" />
          </head><body>Example News</body></html>`,
          { status: 200, headers: { "content-type": "text/html" } }
        );
      }
      if (value === "https://example.com/feed.xml") {
        return new Response(
          `<?xml version="1.0"?>
          <rss version="2.0"><channel>
            <title>Example News Feed</title>
            <link>https://example.com</link>
            <item>
              <title>Markets rally as software stocks rise</title>
              <link>https://example.com/markets</link>
              <description>Business and technology teams reported a strong market rally after software stocks rose sharply.</description>
              <media:thumbnail url="https://example.com/rss-cover.jpg" />
            </item>
          </channel></rss>`,
          { status: 200, headers: { "content-type": "application/rss+xml" } }
        );
      }
      if (value === "https://example.com/rss-cover.jpg" || value === "https://example.com/article-cover.jpg") {
        return new Response(tinyImage, { status: 200, headers: { "content-type": "image/svg+xml" } });
      }
      return new Response(
        `<html><head>
          <title>Markets rally as software stocks rise</title>
          <meta property="og:image" content="https://example.com/article-cover.jpg" />
        </head><body><article>
          <p>Business and technology teams reported a strong market rally after software stocks rose sharply across the sector.</p>
          <p>The readable article contains enough context for ReadMate to create a useful synced listening item.</p>
        </article></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } }
      );
    }) as typeof fetch;
    const app = createTestApp({ documentRepository, sourceRepository, uploadRepository, storage, mediaStorage, fetcher });

    const response = await request(app)
      .post("/api/content/save-url")
      .send({
        url: "https://example.com",
        sourceType: "rss",
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1
      });

    if (response.status !== 201) throw new Error(JSON.stringify(response.body));

    expect(response.body.source).toMatchObject({
      sourceName: "Example News Feed",
      rssFeedUrl: "https://example.com/feed.xml",
      websiteUrl: "https://example.com/",
      sourceType: "rss",
      lastSyncedAt: expect.any(String)
    });
    expect(response.body.documents).toHaveLength(1);
    expect(response.body.documents[0]).toMatchObject({
      title: "Markets rally as software stocks rise",
      sourceType: "rss",
      rssFeedUrl: "https://example.com/feed.xml",
      sourceUrl: "https://example.com/markets",
      category: "Technology",
      thumbnailUrl: "https://media.example/user_a/documents/markets-rally-as-software-stocks-rise/thumb.webp",
      coverImageUrl: "https://media.example/user_a/documents/markets-rally-as-software-stocks-rise/cover.webp"
    });
  });

  it("normalizes known source names to RSS subscriptions", async () => {
    const fetcher = (async (url: Parameters<typeof fetch>[0]) => {
      expect(String(url)).toBe("http://rss.cnn.com/rss/edition.rss");
      return new Response(
        `<?xml version="1.0"?>
        <rss version="2.0"><channel>
          <title>CNN Feed</title>
          <link>https://edition.cnn.com</link>
          <item>
            <title>Global technology story</title>
            <description>Global technology story contains enough readable feed text for ReadMate to save and play later.</description>
          </item>
        </channel></rss>`,
        { status: 200, headers: { "content-type": "application/rss+xml" } }
      );
    }) as typeof fetch;
    const app = createTestApp({ documentRepository, sourceRepository, uploadRepository, storage, mediaStorage, fetcher });

    const response = await request(app)
      .post("/api/content/save-url")
      .send({
        url: "CNN",
        sourceType: "rss",
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1
      })
      .expect(201);

    expect(response.body.source).toMatchObject({
      sourceName: "CNN Feed",
      rssFeedUrl: "http://rss.cnn.com/rss/edition.rss",
      websiteUrl: "https://edition.cnn.com/",
      sourceType: "rss"
    });
    expect(response.body.documents[0]).toMatchObject({ title: "Global technology story", sourceType: "rss" });
  });

  it("normalizes bare domains before fetching website content", async () => {
    const fetcher = (async (url: Parameters<typeof fetch>[0]) => {
      expect(String(url)).toBe("https://engadget.com/");
      return new Response(
        `<html><head><title>Engadget story</title><meta property="og:site_name" content="Engadget" /></head>
        <body><article>
          <p>Technology writers published a useful story with enough readable article text for ReadMate to save.</p>
          <p>The second paragraph gives listeners enough context to continue across mobile and Chrome.</p>
        </article></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } }
      );
    }) as typeof fetch;
    const app = createTestApp({ documentRepository, sourceRepository, uploadRepository, storage, mediaStorage, fetcher });

    const response = await request(app)
      .post("/api/content/save-url")
      .send({
        url: "engadget.com",
        sourceType: "url",
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1
      })
      .expect(201);

    expect(response.body.document).toMatchObject({
      title: "Engadget story",
      sourceType: "webpage",
      sourceLabel: "Engadget",
      sourceUrl: "https://engadget.com/"
    });
  });

  it("returns a helpful error when a website has no readable article or feed", async () => {
    const fetcher = (async () =>
      new Response(
        `<html><head><title>Empty portal</title></head><body>
          <nav>Home About Contact</nav>
          <footer>Copyright links</footer>
        </body></html>`,
        { status: 200, headers: { "content-type": "text/html" } }
      )) as typeof fetch;
    const app = createTestApp({ documentRepository, sourceRepository, uploadRepository, storage, mediaStorage, fetcher });

    const response = await request(app)
      .post("/api/content/save-url")
      .send({
        url: "https://example.com",
        sourceType: "url",
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1
      })
      .expect(422);

    expect(response.body).toEqual({
      error: "We found this website, but could not detect a readable article or RSS feed. Please check the URL or try another source."
    });
  });

  it("uses feed content fallbacks and skips RSS items that only have titles", async () => {
    const fetcher = (async (url: Parameters<typeof fetch>[0]) => {
      const value = String(url);
      if (value === "https://example.com/feed.xml") {
        return new Response(
          `<?xml version="1.0"?>
          <rss version="2.0"><channel>
            <title>Example News Feed</title>
            <item>
              <title>Only a headline</title>
              <link>https://example.com/headline-only</link>
            </item>
            <item>
              <title>Newsletter briefing has full text</title>
              <link>https://example.com/newsletter</link>
              <content:encoded><![CDATA[
                <p>This newsletter briefing contains enough readable article text for ReadMate to build a listening document.</p>
                <p>The content comes from the feed payload when the original article page is unavailable.</p>
              ]]></content:encoded>
            </item>
          </channel></rss>`,
          { status: 200, headers: { "content-type": "application/rss+xml" } }
        );
      }
      return new Response("blocked", { status: 403 });
    }) as typeof fetch;
    const app = createTestApp({ documentRepository, sourceRepository, uploadRepository, storage, mediaStorage, fetcher });

    const response = await request(app)
      .post("/api/content/save-url")
      .send({
        url: "https://example.com/feed.xml",
        sourceType: "rss",
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1
      })
      .expect(201);

    expect(response.body.documents).toHaveLength(1);
    expect(response.body.documents[0].title).toBe("Newsletter briefing has full text");
    expect(response.body.documents[0].blocks).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("feed payload") })])
    );
  });

  it("dedupes RSS items by guid after normalizing tracking URLs", async () => {
    const fetcher = (async (url: Parameters<typeof fetch>[0]) => {
      const value = String(url);
      if (value === "https://example.com/feed.xml") {
        return new Response(
          `<?xml version="1.0"?>
          <rss version="2.0"><channel>
            <title>Example Feed</title>
            <item>
              <guid>story-123</guid>
              <title>Repeated story</title>
              <link>https://example.com/story?utm_source=newsletter&amp;ref=rss</link>
              <description>Repeated story includes enough readable feed text for ReadMate to save only once.</description>
            </item>
            <item>
              <guid>story-123</guid>
              <title>Repeated story</title>
              <link>https://example.com/story?utm_campaign=morning#comments</link>
              <description>Repeated story includes enough readable feed text for ReadMate to save only once.</description>
            </item>
          </channel></rss>`,
          { status: 200, headers: { "content-type": "application/rss+xml" } }
        );
      }
      return new Response("blocked", { status: 403 });
    }) as typeof fetch;
    const app = createTestApp({ documentRepository, sourceRepository, uploadRepository, storage, mediaStorage, fetcher });

    const response = await request(app)
      .post("/api/content/save-url")
      .send({
        url: "https://example.com/feed.xml",
        sourceType: "rss",
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1
      })
      .expect(201);

    expect(response.body.documents).toHaveLength(1);
    expect(response.body.documents[0]).toMatchObject({
      dedupeKey: "rss:url:https://example.com/story",
      sourceUrl: "https://example.com/story"
    });
  });

  it("deduplicates the same RSS article across different feed URLs", async () => {
    const fetcher = (async (url: Parameters<typeof fetch>[0]) => {
      const value = String(url);
      if (value === "https://example.com/feed.xml" || value === "https://example.com/rss.xml") {
        return new Response(
          `<?xml version="1.0"?>
          <rss version="2.0"><channel>
            <title>${value.endsWith("feed.xml") ? "Morning Feed" : "Evening Feed"}</title>
            <item>
              <guid>${value}:story-123</guid>
              <title>Shared article</title>
              <link>http://www.example.com/story/?utm_source=${value.endsWith("feed.xml") ? "morning" : "evening"}#comments</link>
              <description>Shared article includes enough readable feed text for ReadMate to save only once.</description>
            </item>
          </channel></rss>`,
          { status: 200, headers: { "content-type": "application/rss+xml" } }
        );
      }
      return new Response("blocked", { status: 403 });
    }) as typeof fetch;
    const app = createTestApp({ documentRepository, sourceRepository, uploadRepository, storage, mediaStorage, fetcher });

    await request(app)
      .post("/api/content/save-url")
      .send({
        url: "https://example.com/feed.xml",
        sourceType: "rss",
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1
      })
      .expect(201);

    await request(app)
      .post("/api/content/save-url")
      .send({
        url: "https://example.com/rss.xml",
        sourceType: "rss",
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1
      })
      .expect(201);

    const documents = await documentRepository.listDocuments("user_a");
    expect(documents).toHaveLength(1);
    expect(documents[0].dedupeKey).toBe("rss:url:https://example.com/story");
  });

  it("respects the user's articles-per-feed setting", async () => {
    const fetcher = (async () =>
      new Response(
        `<?xml version="1.0"?>
        <rss version="2.0"><channel>
          <title>Limited Feed</title>
          ${[1, 2, 3]
            .map(
              (index) => `<item>
                <title>Feed item ${index}</title>
                <description>Feed item ${index} contains enough readable article content to become a document.</description>
              </item>`
            )
            .join("")}
        </channel></rss>`,
        { status: 200, headers: { "content-type": "application/rss+xml" } }
      )) as typeof fetch;
    const app = createTestApp({
      documentRepository,
      sourceRepository,
      uploadRepository,
      storage,
      mediaStorage,
      fetcher,
      settingsRepository: createMemorySettingsRepository(2)
    });

    const response = await request(app)
      .post("/api/content/save-url")
      .send({
        url: "https://example.com/feed.xml",
        sourceType: "rss",
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1
      })
      .expect(201);

    expect(response.body.documents).toHaveLength(2);
    expect(response.body.source.lastSyncedAt).toEqual(expect.any(String));
  });

  it("returns a clear error when an RSS feed has no items", async () => {
    const fetcher = (async () =>
      new Response(`<?xml version="1.0"?><rss version="2.0"><channel><title>Empty Feed</title></channel></rss>`, {
        status: 200,
        headers: { "content-type": "application/rss+xml" }
      })) as typeof fetch;
    const app = createTestApp({ documentRepository, sourceRepository, uploadRepository, storage, mediaStorage, fetcher });

    const response = await request(app)
      .post("/api/content/save-url")
      .send({
        url: "https://example.com/feed.xml",
        sourceType: "rss",
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1
      })
      .expect(422);

    expect(response.body.error).toContain("could not find a working RSS feed");
    await expect(sourceRepository.listSources("user_a")).resolves.toEqual([]);
  });

  it("does not activate a subscription when feed items contain no importable article text", async () => {
    const fetcher = (async () =>
      new Response(
        `<?xml version="1.0"?><rss version="2.0"><channel><title>Titles Only</title><item><title>No body</title></item></channel></rss>`,
        { status: 200, headers: { "content-type": "application/rss+xml" } }
      )) as typeof fetch;
    const app = createTestApp({ documentRepository, sourceRepository, uploadRepository, storage, mediaStorage, fetcher });

    const response = await request(app)
      .post("/api/content/save-url")
      .send({
        url: "https://example.com/feed.xml",
        sourceType: "rss",
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1
      })
      .expect(422);

    expect(response.body.error).toContain("did not include readable article content");
    await expect(sourceRepository.listSources("user_a")).resolves.toEqual([]);
  });

  it("accepts mobile multipart PDF uploads and creates a readable document", async () => {
    const uploadFile = vi.fn(storage.uploadFile.bind(storage));
    const app = createTestApp({
      documentRepository,
      sourceRepository,
      uploadRepository,
      storage: { ...storage, uploadFile },
      mediaStorage
    });

    const response = await request(app)
      .post("/api/content/upload-pdf")
      .field("title", "Lecture Notes")
      .field("provider", "google")
      .field("voice", "en-US-Neural2-J")
      .field("speed", "1.1")
      .attach("file", Buffer.from("%PDF-1.7 test"), { filename: "lecture.pdf", contentType: "application/pdf" })
      .expect(201);

    expect(response.body.document).toMatchObject({
      title: "Lecture Notes",
      sourceType: "pdf",
      sourceLabel: "PDF upload",
      pageCount: 2,
      thumbnailUrl: "https://media.example/user_a/documents/lecture-notes/thumb.svg",
      coverImageUrl: "https://media.example/user_a/documents/lecture-notes/cover.svg",
      provider: "google",
      voice: "en-US-Neural2-J",
      speed: 1.1
    });
    expect(response.body.document.blocks[0]).toMatchObject({ text: "Readable PDF text", sourcePageNumber: 1 });
    expect(response.body.upload).toMatchObject({ filename: "lecture.pdf", documentId: "doc_1" });
    expect(uploadFile).toHaveBeenCalledOnce();
    expect(uploadFile.mock.calls[0]?.[1].constructor).toBe(Uint8Array);
    expect(Buffer.isBuffer(uploadFile.mock.calls[0]?.[1])).toBe(false);
  });

  it("accepts standard document uploads through the same mobile pipeline", async () => {
    const app = createTestApp({ documentRepository, sourceRepository, uploadRepository, storage, mediaStorage });

    const response = await request(app)
      .post("/api/content/upload-pdf")
      .field("title", "Project Brief")
      .field("provider", "google")
      .field("voice", "en-US-Neural2-F")
      .field("speed", "1")
      .attach("file", Buffer.from("PK test docx"), {
        filename: "project-brief.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      })
      .expect(201);

    expect(response.body.document).toMatchObject({
      title: "Project Brief",
      sourceType: "document",
      sourceLabel: "DOCX upload",
      provider: "google"
    });
    expect(response.body.document.blocks[0]).toMatchObject({ text: "Readable DOCX text" });
    expect(response.body.upload).toMatchObject({ filename: "project-brief.docx", documentId: "doc_1" });
  });

  it("decodes iOS percent-encoded document filenames and titles", async () => {
    const app = createTestApp({ documentRepository, sourceRepository, uploadRepository, storage, mediaStorage });

    const response = await request(app)
      .post("/api/content/upload-pdf")
      .field("title", "Company%20Profile-%20Don%20Emilio")
      .field("provider", "google")
      .field("voice", "en-US-Neural2-F")
      .field("speed", "1")
      .attach("file", Buffer.from("PK test docx"), {
        filename: "Company%20Profile-%20Don%20Emilio.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      })
      .expect(201);

    expect(response.body.document).toMatchObject({
      title: "Company Profile- Don Emilio",
      sourceType: "document",
      category: "Documents"
    });
    expect(response.body.upload).toMatchObject({
      filename: "Company Profile- Don Emilio.docx",
      documentId: "doc_1"
    });
  });

  it("removes path separators decoded from multipart filenames", async () => {
    const app = createTestApp({ documentRepository, sourceRepository, uploadRepository, storage, mediaStorage });

    const response = await request(app)
      .post("/api/content/upload-pdf")
      .field("provider", "google")
      .field("voice", "en-US-Neural2-F")
      .field("speed", "1")
      .attach("file", Buffer.from("PK test docx"), {
        filename: "Company%2FProfile.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      })
      .expect(201);

    expect(response.body.document.title).toBe("Company-Profile");
    expect(response.body.upload.filename).toBe("Company-Profile.docx");
  });

  it("rejects excess document work before buffering or storing the upload", async () => {
    const uploadFile = vi.fn();
    const app = createTestApp({
      documentRepository,
      sourceRepository,
      uploadRepository,
      storage: { ...storage, uploadFile },
      mediaStorage,
      documentWorkLimiter: { tryAcquire: () => null }
    });

    const response = await request(app)
      .post("/api/content/upload-pdf")
      .attach("file", Buffer.from("%PDF-1.7 test"), { filename: "busy.pdf", contentType: "application/pdf" })
      .expect(503);

    expect(response.headers["retry-after"]).toBe("5");
    expect(response.body.error).toContain("processing is busy");
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("cleans up stored uploads when extraction returns no blocks", async () => {
    const deletedFiles: string[] = [];
    const deletedUploads: string[] = [];
    const baseStorage = createMemoryStorage();
    const baseUploads = createMemoryUploadRepository();
    const storage: UploadStorage = {
      ...baseStorage,
      async deleteFile(storageKey) {
        deletedFiles.push(storageKey);
        await baseStorage.deleteFile(storageKey);
      }
    };
    const uploadRepository: UploadRepository = {
      ...baseUploads,
      async deleteUpload(userId, uploadId) {
        deletedUploads.push(uploadId);
        return baseUploads.deleteUpload(userId, uploadId);
      }
    };
    const app = createTestApp({
      documentRepository,
      sourceRepository,
      uploadRepository,
      storage,
      mediaStorage,
      documentTextExtractor: async () => []
    });

    const response = await request(app)
      .post("/api/content/upload-pdf")
      .attach("file", Buffer.from("%PDF-1.7 test"), { filename: "empty.pdf", contentType: "application/pdf" })
      .expect(422);

    expect(response.body.error).toContain("could not extract readable text");
    expect(deletedUploads).toHaveLength(1);
    expect(deletedFiles).toHaveLength(1);
  });
});
