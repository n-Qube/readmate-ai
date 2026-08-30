import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { getUserId, type AuthedRequest } from "../auth.js";
import type { CreateDocumentInput, DocumentRepository, ReadingDocumentResponse } from "./documents.js";
import type { SettingsRepository } from "./settings.js";
import type { MediaStorage } from "../media.js";
import type { HostLookup } from "../safeRemoteFetch.js";
import type { MaybePromise, ReadMateEntitlement } from "../entitlements.js";
import {
  consumeDailyUsage,
  usageLimitFromEnv
} from "../usageQuota.js";
import type { prisma as PrismaSingleton } from "../prisma.js";
import { canonicalizeWebMcpUrl } from "../webmcp/audit.js";
import {
  beginWebMcpAction,
  completeWebMcpAction,
  failWebMcpAction,
  markWebMcpReplay,
  requireWebMcpReplayResourceId,
  WebMcpActionIdempotencyError
} from "../webmcp/actionIdempotency.js";
import { assertAccountDeletionNotFenced } from "../webmcp/accountDeletionFence.js";
import type { WebMcpActionIdempotencyRepository } from "../webmcp/auditRepository.js";

const sourceTypes = ["website", "rss"] as const;
export const WEBMCP_RSS_INITIAL_SYNC_MAX_ARTICLES = 5;
export const DEFAULT_WEBMCP_RSS_INITIAL_SYNCS_DAILY_LIMIT = 20;

const sourceInputSchema = z.object({
  sourceName: z.string().trim().min(1).max(160),
  websiteUrl: z.string().url().optional(),
  rssFeedUrl: z.string().url().optional(),
  sourceType: z.enum(sourceTypes).default("website"),
  topics: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  articlesPerRefresh: z.number().int().min(1).max(50).optional()
});

const subscribeSourceSchema = sourceInputSchema.refine((value) => Boolean(value.websiteUrl || value.rssFeedUrl), "A website or RSS URL is required.");

const updateSourceSchema = sourceInputSchema.partial().extend({
  isSubscribed: z.boolean().optional()
});

export type SubscribeSourceInput = z.infer<typeof subscribeSourceSchema>;
export type UpdateSourceInput = z.infer<typeof updateSourceSchema>;

export type SourceSubscriptionResponse = {
  id: string;
  userId: string;
  sourceName: string;
  websiteUrl?: string;
  rssFeedUrl?: string;
  sourceType: (typeof sourceTypes)[number];
  topics: string[];
  isSubscribed: boolean;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type SourceRepository = {
  listSources(userId: string): Promise<SourceSubscriptionResponse[]>;
  subscribeSource(userId: string, input: SubscribeSourceInput): Promise<SourceSubscriptionResponse>;
  markSourceSynced?(userId: string, sourceId: string, syncedAt: Date): Promise<SourceSubscriptionResponse | null>;
  finalizeSourceSync?(
    userId: string,
    input: SubscribeSourceInput,
    syncedAt: Date
  ): Promise<FinalizedSourceSync>;
  rollbackFinalizedSourceSync?(userId: string, mutation: FinalizedSourceSync): Promise<void>;
  updateSource(userId: string, sourceId: string, input: UpdateSourceInput): Promise<SourceSubscriptionResponse | null>;
  removeSource(userId: string, sourceId: string): Promise<boolean>;
};

export type FinalizedSourceSync = {
  source: SourceSubscriptionResponse;
  previousSource?: SourceSubscriptionResponse;
};

export type InitialRssSyncResponse = {
  status: "completed";
  readyDocumentCount?: number;
  completedAt: string;
};

type InitialRssSyncResult = {
  source: SourceSubscriptionResponse;
  readyDocumentCount: number;
  rollback?: () => Promise<void>;
};

type SourcesRouterDeps = {
  repository?: SourceRepository;
  documentRepository?: DocumentRepository;
  settingsRepository?: SettingsRepository;
  mediaStorage?: MediaStorage;
  fetcher?: typeof fetch;
  lookup?: HostLookup;
  getEntitlement?: (req: Request, userId: string) => MaybePromise<ReadMateEntitlement>;
  consumeUsage?: typeof consumeDailyUsage;
  initialRssSync?: (input: {
    req: Request;
    userId: string;
    payload: SubscribeSourceInput;
    sourceRepository: SourceRepository;
  }) => Promise<InitialRssSyncResult>;
  webMcpActionRepository?: WebMcpActionIdempotencyRepository;
  webMcpDigestKey?: string;
  accountDeletionGuard?: (userId: string) => Promise<void>;
};

export function sourcesRouter(deps: SourcesRouterDeps = {}): Router {
  const router = createRouter();
  const repository = deps.repository ?? new PrismaSourceRepository();

  router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
    res.json(await repository.listSources(getUserId(req)));
  }));

  router.post("/subscribe", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const payload = subscribeSourceSchema.parse(req.body);
    const userId = getUserId(req);
    const action = await beginWebMcpAction(
      req,
      {
        userId,
        toolName: "readmate_subscribe_rss",
        actionClass: "write",
        canonicalInput: canonicalSubscriptionInput(payload)
      },
      {
        repository: deps.webMcpActionRepository,
        digestKey: deps.webMcpDigestKey
      }
    );

    if (action.kind === "replay") {
      const sourceId = requireWebMcpReplayResourceId(action.event, "source");
      const source = (await repository.listSources(userId)).find((candidate) => candidate.id === sourceId);
      if (!source || !matchesConfirmedRssIdentity(source, payload)) throw replaySourceUnavailableError();
      markWebMcpReplay(res);
      res.status(200).json(withInitialSync(source));
      return;
    }

    let syncResult: InitialRssSyncResult | undefined;
    try {
      syncResult = action.kind === "execute"
        ? await runInitialWebMcpRssSync(req, userId, payload, repository, deps)
        : undefined;
      const source = syncResult?.source ?? await repository.subscribeSource(userId, payload);
      const responseBody = syncResult
        ? withInitialSync(source, syncResult.readyDocumentCount)
        : source;
      if (action.kind === "execute") {
        await completeWebMcpAction(action, {
          resourceType: "source",
          resourceId: source.id
        });
      }
      res.status(201).json(responseBody);
    } catch (error) {
      if (syncResult?.rollback) {
        await syncResult.rollback().catch((rollbackError) => {
          console.error(JSON.stringify({
            event: "webmcp_rss_initial_sync_rollback_failed",
            message: rollbackError instanceof Error ? rollbackError.message : "Unknown rollback error."
          }));
        });
      }
      if (action.kind === "execute") await failWebMcpAction(action, error);
      if (isRssContentRequestError(error)) {
        res.status(error.statusCode).json({
          error: error.message,
          code: "RSS_INITIAL_SYNC_FAILED",
          initialSync: { status: "failed" }
        });
        return;
      }
      throw error;
    }
  }));

  router.patch("/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const payload = updateSourceSchema.parse(req.body);
    const source = await repository.updateSource(getUserId(req), String(req.params.id), payload);
    if (!source) {
      res.status(404).json({ error: "Source not found." });
      return;
    }
    res.json(source);
  }));

  router.delete("/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const removed = await repository.removeSource(getUserId(req), String(req.params.id));
    if (!removed) {
      res.status(404).json({ error: "Source not found." });
      return;
    }
    res.status(204).end();
  }));

  return router;
}

function canonicalSubscriptionInput(input: SubscribeSourceInput) {
  return {
    sourceName: input.sourceName,
    websiteUrl: input.websiteUrl ? canonicalizeWebMcpUrl(input.websiteUrl) : null,
    rssFeedUrl: input.rssFeedUrl ? canonicalizeWebMcpUrl(input.rssFeedUrl) : null,
    sourceType: input.sourceType,
    topics: [...new Set(input.topics)].sort(),
    articlesPerRefresh: input.articlesPerRefresh ?? null
  };
}

async function runInitialWebMcpRssSync(
  req: Request,
  userId: string,
  payload: SubscribeSourceInput,
  sourceRepository: SourceRepository,
  deps: SourcesRouterDeps
): Promise<InitialRssSyncResult> {
  const accountDeletionGuard = deps.accountDeletionGuard ?? assertAccountDeletionNotFenced;
  await accountDeletionGuard(userId);
  if (payload.sourceType !== "rss" || !payload.rssFeedUrl) {
    throw new RssInitialSyncRequestError(
      "A confirmed WebMCP RSS subscription requires an RSS feed URL.",
      400
    );
  }
  const parsedFeedUrl = new URL(payload.rssFeedUrl);
  if (parsedFeedUrl.protocol !== "https:") {
    throw new RssInitialSyncRequestError(
      "WebMCP RSS subscriptions require an HTTPS feed URL.",
      400
    );
  }
  const boundedPayload: SubscribeSourceInput = {
    ...payload,
    rssFeedUrl: canonicalizeWebMcpUrl(parsedFeedUrl.href),
    articlesPerRefresh: Math.min(
      payload.articlesPerRefresh ?? WEBMCP_RSS_INITIAL_SYNC_MAX_ARTICLES,
      WEBMCP_RSS_INITIAL_SYNC_MAX_ARTICLES
    )
  };
  await (deps.consumeUsage ?? consumeDailyUsage)(
    userId,
    "webmcp_rss_initial_sync",
    1,
    usageLimitFromEnv(
      "WEBMCP_RSS_INITIAL_SYNCS_DAILY_LIMIT",
      DEFAULT_WEBMCP_RSS_INITIAL_SYNCS_DAILY_LIMIT
    )
  );
  if (deps.initialRssSync) {
    return deps.initialRssSync({ req, userId, payload: boundedPayload, sourceRepository });
  }

  const [
    { saveRssFeed },
    { PrismaDocumentRepository },
    { PrismaSettingsRepository },
    { SupabaseMediaStorage },
    { entitlementForRequest },
    { prisma }
  ] = await Promise.all([
    import("./content.js"),
    import("./documents.js"),
    import("./settings.js"),
    import("../media.js"),
    import("../entitlements.js"),
    import("../prisma.js")
  ]);
  const documentRepository = deps.documentRepository ?? new PrismaDocumentRepository();
  const settingsRepository = deps.settingsRepository ?? new PrismaSettingsRepository();
  const mediaStorage = deps.mediaStorage ?? new SupabaseMediaStorage();
  const settings = await settingsRepository.getOrCreateSettings(userId);
  const entitlement = await (deps.getEntitlement ?? entitlementForRequest)(req, userId);
  const result = await saveRssFeed({
    userId,
    url: boundedPayload.rssFeedUrl!,
    title: boundedPayload.sourceName,
    topics: boundedPayload.topics,
    provider: "google",
    voice: settings.voice,
    speed: settings.speed,
    articlesPerFeed: boundedPayload.articlesPerRefresh,
    documentRepository,
    sourceRepository,
    mediaStorage,
    fetcher: deps.fetcher ?? fetch,
    lookup: deps.lookup,
    entitlement,
    requireHttps: true,
    subscriptionFeedUrl: boundedPayload.rssFeedUrl,
    createDocumentTracked: (documentUserId, documentInput) =>
      createTrackedRssDocument(prisma, documentRepository, documentUserId, documentInput),
    deleteCreatedDocument: async (documentUserId, documentId) => {
      // Missing means it was already removed by an earlier compensation attempt.
      await prisma.readingDocument.deleteMany({ where: { id: documentId, userId: documentUserId } });
    },
    assertAccountActive: accountDeletionGuard
  });
  return {
    source: result.source,
    readyDocumentCount: result.documents.length,
    rollback: result.rollback
  };
}

class RssInitialSyncRequestError extends Error {
  readonly name = "RssInitialSyncRequestError";

  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
  }
}

function isRssContentRequestError(error: unknown): error is Error & { statusCode: number } {
  if (!(error instanceof Error)) return false;
  if (error instanceof RssInitialSyncRequestError) return true;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return error.name === "ContentRequestError" && typeof statusCode === "number" && statusCode >= 400 && statusCode < 500;
}

function withInitialSync(
  source: SourceSubscriptionResponse,
  readyDocumentCount?: number
): SourceSubscriptionResponse & { initialSync: InitialRssSyncResponse } {
  if (!source.lastSyncedAt) {
    throw new WebMcpActionIdempotencyError(
      "IDEMPOTENCY_RESOURCE_UNAVAILABLE",
      409,
      "The RSS subscription exists, but its completed initial sync could not be verified. Confirm the action again to retry."
    );
  }
  return {
    ...source,
    initialSync: {
      status: "completed",
      ...(readyDocumentCount === undefined
        ? {}
        : { readyDocumentCount: Math.max(0, Math.trunc(readyDocumentCount)) }),
      completedAt: source.lastSyncedAt
    }
  };
}

function matchesConfirmedRssIdentity(
  source: SourceSubscriptionResponse,
  input: SubscribeSourceInput
): boolean {
  if (source.sourceType !== "rss" || input.sourceType !== "rss" || !source.rssFeedUrl || !input.rssFeedUrl) {
    return false;
  }
  try {
    return canonicalizeWebMcpUrl(source.rssFeedUrl) === canonicalizeWebMcpUrl(input.rssFeedUrl);
  } catch {
    return false;
  }
}

function replaySourceUnavailableError(): WebMcpActionIdempotencyError {
  return new WebMcpActionIdempotencyError(
    "IDEMPOTENCY_RESOURCE_UNAVAILABLE",
    409,
    "The saved source for this completed request is no longer available."
  );
}

export class TrackedRssDocumentHydrationError extends Error {
  readonly name = "TrackedRssDocumentHydrationError";

  constructor(
    public readonly createdDocumentId: string,
    public readonly hydrationError: unknown,
    public readonly cleanupError: unknown
  ) {
    super("A newly imported RSS document could not be loaded or removed.", {
      cause: { hydrationError, cleanupError }
    });
  }
}

export async function createTrackedRssDocument(
  prisma: typeof PrismaSingleton,
  documentRepository: DocumentRepository,
  userId: string,
  input: CreateDocumentInput
): Promise<{ document: ReadingDocumentResponse; created: boolean }> {
  const duplicateFilters = [
    ...(input.dedupeKey ? [{ dedupeKey: input.dedupeKey }] : []),
    ...(input.canonicalUrl ? [{ canonicalUrl: input.canonicalUrl }] : []),
    ...(input.sourceUrl ? [{ sourceUrl: input.sourceUrl }] : [])
  ];
  let result: { id: string; created: boolean };
  try {
    result = await prisma.$transaction(async (tx) => {
      const existing = duplicateFilters.length
        ? await tx.readingDocument.findFirst({
            where: { userId, deletedAt: null, OR: duplicateFilters },
            select: { id: true }
          })
        : null;
      if (existing) return { id: existing.id, created: false };

      if (input.dedupeKey) {
        await tx.readingDocument.deleteMany({
          where: { userId, dedupeKey: input.dedupeKey, deletedAt: { not: null } }
        });
      }
      const created = await tx.readingDocument.create({
        data: {
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
          topicTags: JSON.stringify(input.topicTags ?? []),
          estimatedListeningSeconds: input.estimatedListeningSeconds,
          pageCount: input.pageCount,
          status: input.status ?? statusForRssProgress(input.progress.percent),
          summary: input.summary,
          keyPoints: JSON.stringify(input.keyPoints ?? []),
          quizQuestions: JSON.stringify(input.quizQuestions ?? []),
          flashcards: JSON.stringify(input.flashcards ?? []),
          chunkIndex: input.progress.blockIndex,
          characterOffset: input.progress.characterOffset,
          sentenceIndex: input.progress.sentenceIndex,
          percent: input.progress.percent,
          lastReadAt: input.progress.percent > 0 ? new Date() : null,
          provider: input.provider,
          voice: input.voice,
          speed: input.speed,
          blocks: {
            create: input.blocks.map((block, index) => ({
              orderIndex: block.orderIndex ?? index,
              blockType: block.blockType,
              text: block.text,
              sourceSelector: block.sourceSelector,
              sourcePageNumber: block.sourcePageNumber
            }))
          }
        },
        select: { id: true }
      });
      return { id: created.id, created: true };
    });
  } catch (error) {
    if ((error as { code?: unknown })?.code !== "P2002") throw error;
    const concurrent = duplicateFilters.length
      ? await prisma.readingDocument.findFirst({
          where: { userId, deletedAt: null, OR: duplicateFilters },
          select: { id: true }
        })
      : null;
    if (!concurrent) throw error;
    const document = await documentRepository.getDocument(userId, concurrent.id);
    if (!document) throw error;
    return { document, created: false };
  }

  try {
    const document = await documentRepository.getDocument(userId, result.id);
    if (!document) throw new Error("The imported RSS document could not be loaded.");
    return { document, created: result.created };
  } catch (hydrationError) {
    if (!result.created) throw hydrationError;
    try {
      await prisma.readingDocument.deleteMany({ where: { id: result.id, userId } });
    } catch (cleanupError) {
      throw new TrackedRssDocumentHydrationError(result.id, hydrationError, cleanupError);
    }
    throw hydrationError;
  }
}

function statusForRssProgress(percent: number): "unread" | "in_progress" | "completed" {
  if (percent >= 100) return "completed";
  if (percent > 0) return "in_progress";
  return "unread";
}

export class PrismaSourceRepository implements SourceRepository {
  async listSources(userId: string): Promise<SourceSubscriptionResponse[]> {
    const prisma = await getPrisma();
    const sources = await prisma.sourceSubscription.findMany({
      where: { userId, isSubscribed: true },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 100
    });
    return sources.map(serializeSource);
  }

  async subscribeSource(userId: string, input: SubscribeSourceInput): Promise<SourceSubscriptionResponse> {
    const prisma = await getPrisma();
    const existing = await prisma.sourceSubscription.findFirst({
      where: {
        userId,
        OR: [
          ...(input.websiteUrl ? [{ websiteUrl: input.websiteUrl }] : []),
          ...(input.rssFeedUrl ? [{ rssFeedUrl: input.rssFeedUrl }] : [])
        ]
      }
    });

    if (existing) {
      const source = await prisma.sourceSubscription.update({
        where: { id: existing.id },
        data: {
          sourceName: input.sourceName,
          websiteUrl: input.websiteUrl,
          rssFeedUrl: input.rssFeedUrl,
          sourceType: input.sourceType,
          topics: JSON.stringify(input.topics),
          isSubscribed: true
        }
      });
      return serializeSource(source);
    }

    const source = await prisma.sourceSubscription.create({
      data: {
        userId,
        sourceName: input.sourceName,
        websiteUrl: input.websiteUrl,
        rssFeedUrl: input.rssFeedUrl,
        sourceType: input.sourceType,
        topics: JSON.stringify(input.topics),
        isSubscribed: true
      }
    });
    return serializeSource(source);
  }

  async markSourceSynced(userId: string, sourceId: string, syncedAt: Date): Promise<SourceSubscriptionResponse | null> {
    const prisma = await getPrisma();
    const updated = await prisma.sourceSubscription.updateMany({
      where: { id: sourceId, userId, isSubscribed: true },
      data: { lastSyncedAt: syncedAt }
    });
    if (!updated.count) return null;
    const source = await prisma.sourceSubscription.findFirst({ where: { id: sourceId, userId } });
    return source ? serializeSource(source) : null;
  }

  async finalizeSourceSync(
    userId: string,
    input: SubscribeSourceInput,
    syncedAt: Date
  ): Promise<FinalizedSourceSync> {
    const prisma = await getPrisma();
    return prisma.$transaction(async (tx) => {
      const existing = await tx.sourceSubscription.findFirst({
        where: {
          userId,
          OR: [
            ...(input.websiteUrl ? [{ websiteUrl: input.websiteUrl }] : []),
            ...(input.rssFeedUrl ? [{ rssFeedUrl: input.rssFeedUrl }] : [])
          ]
        }
      });
      const previousSource = existing ? serializeSource(existing) : undefined;
      const source = existing
        ? await tx.sourceSubscription.update({
            where: { id: existing.id },
            data: {
              sourceName: input.sourceName,
              websiteUrl: input.websiteUrl,
              rssFeedUrl: input.rssFeedUrl,
              sourceType: input.sourceType,
              topics: JSON.stringify(input.topics),
              isSubscribed: true,
              lastSyncedAt: syncedAt
            }
          })
        : await tx.sourceSubscription.create({
            data: {
              userId,
              sourceName: input.sourceName,
              websiteUrl: input.websiteUrl,
              rssFeedUrl: input.rssFeedUrl,
              sourceType: input.sourceType,
              topics: JSON.stringify(input.topics),
              isSubscribed: true,
              lastSyncedAt: syncedAt
            }
          });
      return { source: serializeSource(source), previousSource };
    });
  }

  async rollbackFinalizedSourceSync(userId: string, mutation: FinalizedSourceSync): Promise<void> {
    const prisma = await getPrisma();
    await prisma.$transaction(async (tx) => {
      if (!mutation.previousSource) {
        const deleted = await tx.sourceSubscription.deleteMany({
          where: {
            id: mutation.source.id,
            userId,
            updatedAt: new Date(mutation.source.updatedAt)
          }
        });
        if (deleted.count !== 1) {
          throw new Error("The new RSS subscription changed before it could be rolled back.");
        }
        return;
      }
      const previous = mutation.previousSource;
      const restored = await tx.sourceSubscription.updateMany({
        where: {
          id: mutation.source.id,
          userId,
          updatedAt: new Date(mutation.source.updatedAt)
        },
        data: {
          sourceName: previous.sourceName,
          websiteUrl: previous.websiteUrl ?? null,
          rssFeedUrl: previous.rssFeedUrl ?? null,
          sourceType: previous.sourceType,
          topics: JSON.stringify(previous.topics),
          isSubscribed: previous.isSubscribed,
          lastSyncedAt: previous.lastSyncedAt ? new Date(previous.lastSyncedAt) : null
        }
      });
      if (restored.count !== 1) throw new Error("The previous RSS subscription state could not be restored.");
    });
  }

  async updateSource(userId: string, sourceId: string, input: UpdateSourceInput): Promise<SourceSubscriptionResponse | null> {
    const prisma = await getPrisma();
    const existing = await prisma.sourceSubscription.findFirst({ where: { id: sourceId, userId }, select: { id: true } });
    if (!existing) return null;
    const source = await prisma.sourceSubscription.update({
      where: { id: sourceId },
      data: {
        sourceName: input.sourceName,
        websiteUrl: input.websiteUrl,
        rssFeedUrl: input.rssFeedUrl,
        sourceType: input.sourceType,
        topics: input.topics ? JSON.stringify(input.topics) : undefined,
        isSubscribed: input.isSubscribed
      }
    });
    return serializeSource(source);
  }

  async removeSource(userId: string, sourceId: string): Promise<boolean> {
    const prisma = await getPrisma();
    const result = await prisma.sourceSubscription.updateMany({
      where: { id: sourceId, userId, isSubscribed: true },
      data: { isSubscribed: false }
    });
    return result.count > 0;
  }
}

async function getPrisma(): Promise<typeof PrismaSingleton> {
  const module = await import("../prisma.js");
  return module.prisma;
}

function serializeSource(source: any): SourceSubscriptionResponse {
  return {
    id: source.id,
    userId: source.userId,
    sourceName: source.sourceName,
    websiteUrl: source.websiteUrl ?? undefined,
    rssFeedUrl: source.rssFeedUrl ?? undefined,
    sourceType: source.sourceType,
    topics: parseTopics(source.topics),
    isSubscribed: source.isSubscribed,
    lastSyncedAt: source.lastSyncedAt ? toIso(source.lastSyncedAt) : undefined,
    createdAt: toIso(source.createdAt),
    updatedAt: toIso(source.updatedAt)
  };
}

function parseTopics(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
