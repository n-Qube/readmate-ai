import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthedRequest } from "../auth.js";
import { WebMcpActionIdempotencyError } from "../webmcp/actionIdempotency.js";
import { AccountDeletionFencedError } from "../webmcp/accountDeletionFence.js";
import type {
  ClaimWebMcpActionInput,
  ClaimedWebMcpAuditEvent,
  RecordWebMcpAuditEventInput,
  WebMcpActionIdempotencyRepository,
  WebMcpAuditEvent
} from "../webmcp/auditRepository.js";
import {
  DEFAULT_WEBMCP_RSS_INITIAL_SYNCS_DAILY_LIMIT,
  WEBMCP_RSS_INITIAL_SYNC_MAX_ARTICLES,
  sourcesRouter,
  type SubscribeSourceInput,
  type SourceRepository,
  type SourceSubscriptionResponse
} from "./sources.js";

const digestKey = "readmate-test-webmcp-digest-key-32-characters";

function createTestApp(
  sourceRepository: SourceRepository,
  webMcpActionRepository: WebMcpActionIdempotencyRepository,
  initialRssSync = async (input: {
    userId: string;
    payload: SubscribeSourceInput;
    sourceRepository: SourceRepository;
  }) => {
    const pending = await input.sourceRepository.subscribeSource(input.userId, input.payload);
    const source = await input.sourceRepository.markSourceSynced?.(input.userId, pending.id, new Date("2026-08-29T10:01:00.000Z"));
    if (!source) throw new Error("Test source could not be marked synced.");
    return { source, readyDocumentCount: 2 };
  },
  consumeUsage = async () => 1,
  accountDeletionGuard: (userId: string) => Promise<void> = async () => undefined
) {
  const app = express();
  app.use(express.json());
  app.use((req: AuthedRequest, _res, next) => {
    req.userId = String(req.header("x-test-user") ?? "owner");
    next();
  });
  app.use("/api/sources", sourcesRouter({
    repository: sourceRepository,
    initialRssSync,
    consumeUsage,
    webMcpActionRepository,
    webMcpDigestKey: digestKey,
    accountDeletionGuard
  }));
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

function createMemorySourceRepository() {
  const sources = new Map<string, SourceSubscriptionResponse>();
  let nextId = 1;
  const subscribeSource = vi.fn<SourceRepository["subscribeSource"]>(async (userId, input) => {
    const existing = [...sources.values()].find((source) =>
      source.userId === userId &&
      ((input.rssFeedUrl && source.rssFeedUrl === input.rssFeedUrl) ||
        (input.websiteUrl && source.websiteUrl === input.websiteUrl))
    );
    if (existing) {
      const updated = {
        ...existing,
        sourceName: input.sourceName,
        websiteUrl: input.websiteUrl,
        rssFeedUrl: input.rssFeedUrl,
        sourceType: input.sourceType,
        topics: input.topics,
        isSubscribed: true,
        updatedAt: "2026-08-29T10:00:30.000Z"
      };
      sources.set(updated.id, updated);
      return updated;
    }
    const now = "2026-08-29T10:00:00.000Z";
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
  });

  const repository: SourceRepository = {
    async listSources(userId) {
      return [...sources.values()].filter((source) => source.userId === userId && source.isSubscribed);
    },
    subscribeSource,
    async markSourceSynced(userId, sourceId, syncedAt) {
      const source = sources.get(sourceId);
      if (!source || source.userId !== userId || !source.isSubscribed) return null;
      const updated = { ...source, lastSyncedAt: syncedAt.toISOString(), updatedAt: syncedAt.toISOString() };
      sources.set(sourceId, updated);
      return updated;
    },
    async updateSource() {
      return null;
    },
    async removeSource() {
      return false;
    }
  };
  const mutateSource = (sourceId: string, patch: Partial<SourceSubscriptionResponse>) => {
    const source = sources.get(sourceId);
    if (!source) throw new Error(`Unknown test source: ${sourceId}`);
    sources.set(sourceId, {
      ...source,
      ...patch,
      updatedAt: "2026-08-29T10:02:00.000Z"
    });
  };
  return { repository, subscribeSource, mutateSource };
}

function createMemoryActionRepository(): WebMcpActionIdempotencyRepository {
  const events = new Map<string, WebMcpAuditEvent & { claimToken?: string }>();
  let nextId = 1;
  const keyFor = (input: Pick<RecordWebMcpAuditEventInput, "userId" | "requestId" | "toolName">) =>
    `${input.userId}:${input.requestId ?? "none"}:${input.toolName}`;

  return {
    async claimAction(input: ClaimWebMcpActionInput) {
      const key = keyFor(input);
      const existing = events.get(key);
      if (!existing) {
        const event: ClaimedWebMcpAuditEvent = {
          id: `event_${nextId++}`,
          ...input,
          claimToken: "2".repeat(64),
          status: "started",
          createdAt: "2026-08-29T10:00:00.000Z"
        };
        events.set(key, event);
        return { kind: "execute", event };
      }
      if (existing.actionClass !== input.actionClass || existing.actionDigest !== input.actionDigest) {
        return { kind: "conflict", event: withoutClaimToken(existing) };
      }
      if (existing.status === "succeeded") return { kind: "replay", event: withoutClaimToken(existing) };
      if (existing.status === "failed") return { kind: "failed", event: withoutClaimToken(existing) };
      if (existing.status === "cancelled") return { kind: "cancelled", event: withoutClaimToken(existing) };
      return { kind: "in_progress", event: withoutClaimToken(existing) };
    },
    async recordEvent(input: RecordWebMcpAuditEventInput) {
      const key = keyFor(input);
      const existing = events.get(key);
      if (
        existing &&
        (input.actionDigest !== existing.actionDigest || input.claimToken !== existing.claimToken)
      ) {
        return { kind: "conflict", event: withoutClaimToken(existing) };
      }
      const event = {
        id: existing?.id ?? `event_${nextId++}`,
        ...existing,
        ...input,
        claimToken: ["succeeded", "failed", "cancelled"].includes(input.status)
          ? undefined
          : existing?.claimToken,
        createdAt: existing?.createdAt ?? "2026-08-29T10:00:00.000Z"
      };
      events.set(key, event);
      return { kind: "recorded", event: withoutClaimToken(event), reused: Boolean(existing) };
    }
  };
}

function withoutClaimToken(event: WebMcpAuditEvent & { claimToken?: string }): WebMcpAuditEvent {
  const { claimToken: _privateClaimToken, ...safe } = event;
  return safe;
}

describe("source subscription WebMCP idempotency", () => {
  it("replays canonical-equivalent RSS input and rejects conflicting reuse without another subscription", async () => {
    const { repository, subscribeSource } = createMemorySourceRepository();
    const consumeUsage = vi.fn(async () => 1);
    const app = createTestApp(repository, createMemoryActionRepository(), undefined, consumeUsage);
    const requestId = "rss_request_001";

    const first = await request(app)
      .post("/api/sources/subscribe")
      .set("X-ReadMate-Request-Id", requestId)
      .send({
        sourceName: "Tech News",
        websiteUrl: "https://EXAMPLE.com",
        rssFeedUrl: "https://Example.com/feed?b=2&a=1#latest",
        sourceType: "rss",
        topics: ["AI", "Design", "AI"],
        articlesPerRefresh: 10
      });

    expect(first.status).toBe(201);
    expect(first.body.id).toBe("source_1");
    expect(first.body.initialSync).toEqual({
      status: "completed",
      readyDocumentCount: 2,
      completedAt: "2026-08-29T10:01:00.000Z"
    });

    const replay = await request(app)
      .post("/api/sources/subscribe")
      .set("X-ReadMate-Request-Id", requestId)
      .send({
        sourceName: "Tech News",
        websiteUrl: "https://example.com/",
        rssFeedUrl: "https://example.com/feed?a=1&b=2",
        sourceType: "rss",
        topics: ["Design", "AI"],
        articlesPerRefresh: 10
      });

    expect(replay.status).toBe(200);
    expect(replay.headers["x-readmate-idempotent-replay"]).toBe("true");
    expect(replay.body.id).toBe("source_1");
    expect(replay.body.initialSync).toEqual({
      status: "completed",
      completedAt: "2026-08-29T10:01:00.000Z"
    });
    expect(subscribeSource).toHaveBeenCalledTimes(1);
    expect(consumeUsage).toHaveBeenCalledTimes(1);

    const conflict = await request(app)
      .post("/api/sources/subscribe")
      .set("X-ReadMate-Request-Id", requestId)
      .send({
        sourceName: "Tech News",
        websiteUrl: "https://example.com/",
        rssFeedUrl: "https://example.com/feed?a=1&b=2",
        sourceType: "rss",
        topics: ["AI", "Design"],
        articlesPerRefresh: 25
      });

    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(subscribeSource).toHaveBeenCalledTimes(1);
    expect(consumeUsage).toHaveBeenCalledTimes(1);
  });

  it("rejects replay when the completed source has been mutated to a different canonical feed", async () => {
    const { repository, subscribeSource, mutateSource } = createMemorySourceRepository();
    const consumeUsage = vi.fn(async () => 1);
    const initialRssSync = vi.fn(async (input: {
      userId: string;
      payload: SubscribeSourceInput;
      sourceRepository: SourceRepository;
    }) => {
      const pending = await input.sourceRepository.subscribeSource(input.userId, input.payload);
      const source = await input.sourceRepository.markSourceSynced?.(
        input.userId,
        pending.id,
        new Date("2026-08-29T10:01:00.000Z")
      );
      if (!source) throw new Error("Test source could not be marked synced.");
      return { source, readyDocumentCount: 1 };
    });
    const app = createTestApp(
      repository,
      createMemoryActionRepository(),
      initialRssSync,
      consumeUsage
    );
    const payload = {
      sourceName: "Stable feed",
      websiteUrl: "https://example.com/",
      rssFeedUrl: "https://Example.com/feed?b=2&a=1#latest",
      sourceType: "rss",
      topics: ["News"],
      articlesPerRefresh: 5
    };

    await request(app)
      .post("/api/sources/subscribe")
      .set("X-ReadMate-Request-Id", "rss_mutation_replay_001")
      .send(payload)
      .expect(201);

    mutateSource("source_1", {
      sourceName: "Renamed feed",
      topics: ["News", "Technology"]
    });
    await request(app)
      .post("/api/sources/subscribe")
      .set("X-ReadMate-Request-Id", "rss_mutation_replay_001")
      .send(payload)
      .expect(200);

    mutateSource("source_1", { rssFeedUrl: "https://example.com/different-feed.xml" });
    const rejectedReplay = await request(app)
      .post("/api/sources/subscribe")
      .set("X-ReadMate-Request-Id", "rss_mutation_replay_001")
      .send(payload)
      .expect(409);

    expect(rejectedReplay.body.code).toBe("IDEMPOTENCY_RESOURCE_UNAVAILABLE");
    expect(rejectedReplay.headers["x-readmate-idempotent-replay"]).toBeUndefined();
    expect(initialRssSync).toHaveBeenCalledTimes(1);
    expect(subscribeSource).toHaveBeenCalledTimes(1);
    expect(consumeUsage).toHaveBeenCalledTimes(1);
  });

  it("hard-limits the confirmed initial batch independently of caller input", async () => {
    const { repository } = createMemorySourceRepository();
    const consumeUsage = vi.fn(async () => 1);
    const initialRssSync = vi.fn(async (input: {
      userId: string;
      payload: SubscribeSourceInput;
      sourceRepository: SourceRepository;
    }) => {
      const pending = await input.sourceRepository.subscribeSource(input.userId, input.payload);
      const source = await input.sourceRepository.markSourceSynced?.(
        input.userId,
        pending.id,
        new Date("2026-08-29T10:01:00.000Z")
      );
      if (!source) throw new Error("Test source could not be marked synced.");
      return { source, readyDocumentCount: WEBMCP_RSS_INITIAL_SYNC_MAX_ARTICLES };
    });
    const app = createTestApp(repository, createMemoryActionRepository(), initialRssSync, consumeUsage);

    const response = await request(app)
      .post("/api/sources/subscribe")
      .set("X-ReadMate-Request-Id", "rss_bounded_batch_001")
      .send({
        sourceName: "Large requested batch",
        rssFeedUrl: "https://example.com/feed.xml",
        sourceType: "rss",
        articlesPerRefresh: 50
      });

    expect(response.status).toBe(201);
    expect(initialRssSync).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ articlesPerRefresh: WEBMCP_RSS_INITIAL_SYNC_MAX_ARTICLES })
    }));
    expect(consumeUsage).toHaveBeenCalledWith(
      "owner",
      "webmcp_rss_initial_sync",
      1,
      DEFAULT_WEBMCP_RSS_INITIAL_SYNCS_DAILY_LIMIT
    );
  });

  it("rejects non-HTTPS WebMCP feeds before quota consumption or sync work", async () => {
    const { repository, subscribeSource } = createMemorySourceRepository();
    const consumeUsage = vi.fn(async () => 1);
    const initialRssSync = vi.fn();
    const app = createTestApp(repository, createMemoryActionRepository(), initialRssSync, consumeUsage);

    const response = await request(app)
      .post("/api/sources/subscribe")
      .set("X-ReadMate-Request-Id", "rss_http_rejected_001")
      .send({ sourceName: "Unsafe feed", rssFeedUrl: "http://example.com/feed.xml", sourceType: "rss" });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: "WebMCP RSS subscriptions require an HTTPS feed URL.",
      code: "RSS_INITIAL_SYNC_FAILED",
      initialSync: { status: "failed" }
    });
    expect(consumeUsage).not.toHaveBeenCalled();
    expect(initialRssSync).not.toHaveBeenCalled();
    expect(subscribeSource).not.toHaveBeenCalled();
  });

  it("does not recreate a source when deletion is fenced after the action claim", async () => {
    const { repository, subscribeSource } = createMemorySourceRepository();
    const consumeUsage = vi.fn(async () => 1);
    const initialRssSync = vi.fn();
    const app = createTestApp(
      repository,
      createMemoryActionRepository(),
      initialRssSync,
      consumeUsage,
      async () => { throw new AccountDeletionFencedError(); }
    );

    const response = await request(app)
      .post("/api/sources/subscribe")
      .set("X-ReadMate-Request-Id", "rss-delete-race-001")
      .send({ sourceName: "Deleted feed", rssFeedUrl: "https://example.com/feed.xml", sourceType: "rss" })
      .expect(409);

    expect(response.body.code).toBe("ACCOUNT_DELETION_IN_PROGRESS");
    expect(consumeUsage).not.toHaveBeenCalled();
    expect(initialRssSync).not.toHaveBeenCalled();
    expect(subscribeSource).not.toHaveBeenCalled();
  });

  it("rolls back a completed initial sync if the durable success audit fails", async () => {
    const { repository } = createMemorySourceRepository();
    const baseActions = createMemoryActionRepository();
    const recordEvent = baseActions.recordEvent.bind(baseActions);
    const actions: WebMcpActionIdempotencyRepository = {
      ...baseActions,
      async recordEvent(input) {
        if (input.status === "succeeded") throw new Error("audit unavailable");
        return recordEvent(input);
      }
    };
    const rollback = vi.fn(async () => undefined);
    const initialRssSync = async (input: {
      userId: string;
      payload: SubscribeSourceInput;
      sourceRepository: SourceRepository;
    }) => {
      const pending = await input.sourceRepository.subscribeSource(input.userId, input.payload);
      const source = await input.sourceRepository.markSourceSynced?.(
        input.userId,
        pending.id,
        new Date("2026-08-29T10:01:00.000Z")
      );
      if (!source) throw new Error("Test source could not be marked synced.");
      return { source, readyDocumentCount: 1, rollback };
    };
    const app = createTestApp(repository, actions, initialRssSync);

    const response = await request(app)
      .post("/api/sources/subscribe")
      .set("X-ReadMate-Request-Id", "rss_audit_failure_001")
      .send({ sourceName: "Audited feed", rssFeedUrl: "https://example.com/feed.xml", sourceType: "rss" });

    expect(response.status).toBe(500);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it("leaves ordinary callers without the request header unchanged", async () => {
    const { repository, subscribeSource } = createMemorySourceRepository();
    const app = createTestApp(repository, createMemoryActionRepository());

    const response = await request(app)
      .post("/api/sources/subscribe")
      .send({ sourceName: "Regular feed", rssFeedUrl: "https://example.com/rss", sourceType: "rss" });

    expect(response.status).toBe(201);
    expect(response.headers["x-readmate-idempotent-replay"]).toBeUndefined();
    expect(subscribeSource).toHaveBeenCalledTimes(1);
    expect(response.body.initialSync).toBeUndefined();
    expect(response.body.lastSyncedAt).toBeUndefined();
  });

  it("returns a truthful failure and does not create a subscription when initial feed validation fails", async () => {
    const { repository, subscribeSource } = createMemorySourceRepository();
    const validationError = Object.assign(new Error("The URL is not a readable RSS feed."), {
      name: "ContentRequestError",
      statusCode: 422
    });
    const app = createTestApp(repository, createMemoryActionRepository(), async () => {
      throw validationError;
    });

    const response = await request(app)
      .post("/api/sources/subscribe")
      .set("X-ReadMate-Request-Id", "rss_invalid_feed_001")
      .send({ sourceName: "Not a feed", rssFeedUrl: "https://example.com/about", sourceType: "rss" });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      error: "The URL is not a readable RSS feed.",
      code: "RSS_INITIAL_SYNC_FAILED",
      initialSync: { status: "failed" }
    });
    expect(subscribeSource).not.toHaveBeenCalled();
    await expect(repository.listSources("owner")).resolves.toEqual([]);
  });

  it("refreshes an existing subscription in place instead of creating a duplicate", async () => {
    const { repository, subscribeSource } = createMemorySourceRepository();
    const app = createTestApp(repository, createMemoryActionRepository());

    const ordinary = await request(app)
      .post("/api/sources/subscribe")
      .send({ sourceName: "Existing feed", rssFeedUrl: "https://example.com/feed.xml", sourceType: "rss" });
    expect(ordinary.status).toBe(201);
    expect(ordinary.body.id).toBe("source_1");
    expect(ordinary.body.lastSyncedAt).toBeUndefined();

    const refreshed = await request(app)
      .post("/api/sources/subscribe")
      .set("X-ReadMate-Request-Id", "rss_existing_refresh_001")
      .send({
        sourceName: "Existing feed",
        rssFeedUrl: "https://example.com/feed.xml",
        sourceType: "rss",
        articlesPerRefresh: 5
      });

    expect(refreshed.status).toBe(201);
    expect(refreshed.body.id).toBe("source_1");
    expect(refreshed.body.initialSync.status).toBe("completed");
    expect(subscribeSource).toHaveBeenCalledTimes(2);
    await expect(repository.listSources("owner")).resolves.toHaveLength(1);
  });
});
