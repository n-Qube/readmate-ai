import type { NextFunction, Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getUserId, type AuthedRequest } from "../auth.js";
import { extractDocumentTextBlocks, supportedDocumentInfo, type DocumentExtractionLimits, type ExtractedDocumentBlock } from "../documents/extractDocumentText.js";
import {
  CachedMediaCleanupError,
  cacheRemoteCoverImages,
  createPdfFirstPageCoverImages,
  SupabaseMediaStorage,
  type MediaStorage
} from "../media.js";
import { normalizeGoogleTtsVoice } from "../ttsSchema.js";
import { isPdfBytes } from "../pdf/extractPdfText.js";
import {
  PrismaDocumentRepository,
  type CreateDocumentInput,
  type DocumentRepository,
  type ReadingDocumentResponse
} from "./documents.js";
import {
  PrismaUploadRepository,
  SupabaseUploadStorage,
  UploadQuotaError,
  type UploadRecordResponse,
  type UploadRepository,
  type UploadStorage
} from "./uploads.js";
import {
  PrismaSourceRepository,
  TrackedRssDocumentHydrationError,
  type FinalizedSourceSync,
  type SourceRepository,
  type SourceSubscriptionResponse
} from "./sources.js";
import { PrismaSettingsRepository, type SettingsRepository } from "./settings.js";
import { safeRemoteFetch, type HostLookup } from "../safeRemoteFetch.js";
import { documentProcessingLimiter, type WorkLimiter, type WorkPermit } from "../workLimiter.js";
import { entitlementForRequest, requireDocumentWithinPlan, type MaybePromise, type ReadMateEntitlement } from "../entitlements.js";
import { canonicalizeWebMcpUrl } from "../webmcp/audit.js";
import {
  beginWebMcpAction,
  completeWebMcpAction,
  failWebMcpAction,
  markWebMcpReplay,
  requireWebMcpReplayResourceId,
  WebMcpActionIdempotencyError,
  type WebMcpActionExecution,
  type WebMcpActionIdempotencyDeps
} from "../webmcp/actionIdempotency.js";
import { assertAccountDeletionNotFenced } from "../webmcp/accountDeletionFence.js";

const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const providers = ["google"] as const;
const providerSchema = z.preprocess(() => "google", z.literal("google"));
const voiceSchema = z.preprocess(normalizeGoogleTtsVoice, z.string().trim().min(1).max(100));
const feedFetchHeaders = {
  "User-Agent": "Mozilla/5.0 (compatible; ReadMateAI/1.0; +https://readmate.ai)",
  Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html, */*"
};
const pageFetchHeaders = {
  "User-Agent": "Mozilla/5.0 (compatible; ReadMateAI/1.0; +https://readmate.ai)",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};

class ContentRequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "ContentRequestError";
  }
}

const saveUrlSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  sourceType: z.enum(["url", "rss", "webpage", "news", "website"]).default("url"),
  title: z.string().trim().min(1).max(500).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  preferredLanguage: z.enum(["en", "tw", "ee", "gaa"]).optional(),
  provider: providerSchema.default("google"),
  voice: voiceSchema,
  speed: z.number().min(0.5).max(4)
});

const saveSelectionSchema = z.object({
  title: z.string().trim().min(1).max(500).default("Selected text"),
  text: z.string().trim().min(1).max(1_000_000),
  sourceUrl: z.string().url().optional(),
  sourceType: z.enum(["selection", "webpage", "url", "news", "document"]).default("selection"),
  thumbnailUrl: z.string().url().optional(),
  author: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(1000).optional(),
  provider: providerSchema.default("google"),
  voice: voiceSchema,
  speed: z.number().min(0.5).max(4)
});

type ContentRouterDeps = {
  documentRepository?: DocumentRepository;
  sourceRepository?: SourceRepository;
  uploadRepository?: UploadRepository;
  storage?: UploadStorage;
  mediaStorage?: MediaStorage;
  settingsRepository?: SettingsRepository;
  fetcher?: typeof fetch;
  lookup?: HostLookup;
  documentTextExtractor?: (bytes: Uint8Array, info: ReturnType<typeof supportedDocumentInfo>, limits?: DocumentExtractionLimits) => Promise<ExtractedDocumentBlock[]>;
  documentWorkLimiter?: WorkLimiter;
  getEntitlement?: (req: AuthedRequest, userId: string) => MaybePromise<ReadMateEntitlement>;
  webMcpActionRepository?: WebMcpActionIdempotencyDeps["repository"];
  webMcpDigestKey?: string;
  accountDeletionGuard?: (userId: string) => Promise<void>;
};

type ArticleExtraction = {
  title: string;
  sourceName?: string;
  canonicalUrl: string;
  sourceUrl: string;
  author?: string;
  publishedAt?: string;
  description?: string;
  thumbnailUrl?: string;
  contentHtml?: string;
  blocks: Array<{ blockType: "heading" | "paragraph" | "list"; text: string }>;
  category: string;
  topicTags: string[];
};

export function contentRouter(deps: ContentRouterDeps = {}): Router {
  const router = createRouter();
  const documentRepository = deps.documentRepository ?? new PrismaDocumentRepository();
  const sourceRepository = deps.sourceRepository ?? new PrismaSourceRepository();
  const uploadRepository = deps.uploadRepository ?? new PrismaUploadRepository();
  const storage = deps.storage ?? new SupabaseUploadStorage();
  const mediaStorage = deps.mediaStorage ?? new SupabaseMediaStorage();
  const settingsRepository = deps.settingsRepository ?? new PrismaSettingsRepository();
  const fetcher = deps.fetcher ?? fetch;
  const lookup = deps.lookup;
  const documentTextExtractor = deps.documentTextExtractor ?? extractDocumentTextBlocks;
  const uploadWorkLimiter = deps.documentWorkLimiter ?? documentProcessingLimiter;
  const getEntitlement = deps.getEntitlement ?? entitlementForRequest;
  const accountDeletionGuard = deps.accountDeletionGuard ?? assertAccountDeletionNotFenced;

  router.post("/save-url", async (req: AuthedRequest, res: Response, next: NextFunction) => {
    let webMcpAction: WebMcpActionExecution | { kind: "disabled" } | undefined;
    try {
      const payload = saveUrlSchema.parse(req.body);
      const userId = getUserId(req);
      const normalized = normalizeInputUrl(payload.url, payload.sourceType);
      const isRss = payload.sourceType === "rss" || (payload.sourceType === "url" && looksLikeFeedUrl(normalized));
      if (req.header("x-readmate-request-id") !== undefined && isRss) {
        throw new WebMcpActionIdempotencyError(
          "WEBMCP_RSS_ENDPOINT_REQUIRED",
          409,
          "Confirmed RSS subscriptions must use the dedicated RSS subscription flow."
        );
      }
      const action = await beginWebMcpAction(
        req,
        {
          userId,
          toolName: payload.sourceType === "rss" ? "readmate_subscribe_rss" : "readmate_add_web_page",
          actionClass: "write",
          canonicalInput: {
            url: canonicalizeWebMcpUrl(normalized),
            sourceType: payload.sourceType,
            title: payload.title ?? null,
            category: payload.category ?? null,
            preferredLanguage: payload.preferredLanguage ?? null,
            provider: payload.provider,
            voice: payload.voice,
            speed: payload.speed
          }
        },
        { repository: deps.webMcpActionRepository, digestKey: deps.webMcpDigestKey }
      );
      if (action.kind === "replay") {
        const documentId = requireWebMcpReplayResourceId(action.event, "document");
        const document = await documentRepository.getDocument(userId, documentId);
        if (!document) requireWebMcpReplayResourceId({ ...action.event, resourceId: undefined }, "document");
        const source = (await sourceRepository.listSources(userId)).find(
          (candidate) => candidate.websiteUrl === originFromUrl(normalized)
        );
        markWebMcpReplay(res);
        res.json({ document, source, replayed: true });
        return;
      }
      webMcpAction = action;
      const entitlement = await getEntitlement(req, userId);
      if (isRss) {
        const settings = await settingsRepository.getOrCreateSettings(userId);
        const result = await saveRssFeed({
          userId,
          url: normalized,
          title: payload.title,
          provider: payload.provider,
          voice: payload.voice,
          speed: payload.speed,
          articlesPerFeed: settings.articlesPerFeed,
          documentRepository,
          sourceRepository,
          mediaStorage,
          fetcher,
          lookup,
          entitlement,
          assertAccountActive: action.kind === "execute" ? accountDeletionGuard : undefined
        });
        await completeWebMcpAction(webMcpAction, { resourceType: "source", resourceId: result.source.id });
        res.status(201).json(result);
        return;
      }

      let article: ArticleExtraction;
      try {
        article = await extractArticleFromUrl(normalized, fetcher, lookup);
      } catch (error) {
        if (error instanceof ContentRequestError) throw error;
        console.warn("ReadMate could not extract a requested webpage.", {
          message: error instanceof Error ? error.message : "Unknown webpage extraction error."
        });
        throw new ContentRequestError(
          "ReadMate could not read this webpage. Check that the link is public and opens normally, then try again.",
          422
        );
      }
      if (!hasReadableBody(article.blocks)) {
        throw new ContentRequestError(
          "We found this website, but could not detect a readable article or RSS feed. Please check the URL or try another source.",
          422
        );
      }
      requireDocumentWithinPlan(entitlement, { textCharacters: textCharacterCount(article.blocks) });
      if (action.kind === "execute") await accountDeletionGuard(userId);
      const source = await sourceRepository.subscribeSource(userId, {
        sourceName: article.sourceName ?? sourceNameFromUrl(normalized),
        websiteUrl: originFromUrl(normalized),
        sourceType: "website",
        topics: article.topicTags
      });
      if (action.kind === "execute") await accountDeletionGuard(userId);
      const coverImages = await cacheRemoteCoverImages({
        imageUrl: article.thumbnailUrl,
        userId,
        title: payload.title ?? article.title,
        sourceName: article.sourceName ?? source.sourceName,
        category: article.category,
        fetcher,
        lookup,
        mediaStorage
      });
      const learning = learningDataForContent(payload.title ?? article.title, article.description, article.blocks);
      let document: ReadingDocumentResponse;
      try {
        if (action.kind === "execute") await accountDeletionGuard(userId);
        document = await documentRepository.createDocument(userId, {
        title: payload.title ?? article.title,
        sourceType: payload.sourceType === "news" ? "news" : "webpage",
        sourceUrl: article.sourceUrl,
        canonicalUrl: article.canonicalUrl,
        category: article.category,
        sourceLabel: article.sourceName ?? source.sourceName,
        thumbnailUrl: coverImages.thumbnailUrl,
        coverImageUrl: coverImages.coverImageUrl,
        author: article.author,
        description: article.description,
        contentHtml: article.contentHtml,
        topicTags: article.topicTags,
        estimatedListeningSeconds: estimateListeningSeconds(article.blocks, payload.speed),
        summary: learning.summary,
        keyPoints: learning.keyPoints,
        quizQuestions: learning.quizQuestions,
        flashcards: learning.flashcards,
        provider: payload.provider,
        voice: payload.voice,
        speed: payload.speed,
        progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 },
          blocks: article.blocks
        });
      } catch (error) {
        if (coverImages.storageKeys?.length && mediaStorage.deletePublicObjects) {
          await mediaStorage.deletePublicObjects(coverImages.storageKeys).catch(() => undefined);
        }
        throw error;
      }
      await completeWebMcpAction(webMcpAction, { resourceType: "document", resourceId: document.id });
      res.status(201).json({ document, source });
    } catch (error) {
      await failWebMcpAction(webMcpAction, error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.issues[0]?.message ?? "Invalid content request." });
        return;
      }
      if (error instanceof ContentRequestError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  router.post("/save-selection", async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const payload = saveSelectionSchema.parse(req.body);
      const entitlement = await getEntitlement(req, getUserId(req));
      requireDocumentWithinPlan(entitlement, { textCharacters: payload.text.length });
      const blocks = textToBlocks(payload.text, payload.title);
      const category = categoryForText([payload.title, payload.description, payload.text].join(" "));
      const document = await documentRepository.createDocument(getUserId(req), {
        title: payload.title,
        sourceType: payload.sourceType === "url" ? "webpage" : payload.sourceType,
        sourceUrl: payload.sourceUrl,
        canonicalUrl: payload.sourceUrl,
        category,
        sourceLabel: payload.sourceUrl ? sourceNameFromUrl(payload.sourceUrl) : "Selection",
        thumbnailUrl: payload.thumbnailUrl,
        author: payload.author,
        description: payload.description,
        topicTags: topicTagsForText([payload.title, payload.description, payload.text].join(" "), category),
        estimatedListeningSeconds: estimateListeningSeconds(blocks, payload.speed),
        ...learningDataForContent(payload.title, payload.description, blocks),
        provider: payload.provider,
        voice: payload.voice,
        speed: payload.speed,
        progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 },
        blocks
      });
      res.status(201).json({ document });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.issues[0]?.message ?? "Invalid selection request." });
        return;
      }
      next(error);
    }
  });

  router.post("/upload-pdf", async (req: AuthedRequest, res: Response, next: NextFunction) => {
    let storageKey: string | undefined;
    let record: UploadRecordResponse | undefined;
    let releasePermit: WorkPermit | undefined;
    try {
      releasePermit = uploadWorkLimiter.tryAcquire() ?? undefined;
      if (!releasePermit) {
        req.resume();
        res.setHeader("Retry-After", "5");
        res.status(503).json({ error: "Document processing is busy. Please retry shortly." });
        return;
      }
      const upload = await parseDocumentMultipart(req);
      const userId = getUserId(req);
      const entitlement = await getEntitlement(req, userId);
      requireDocumentWithinPlan(entitlement, { byteSize: upload.bytes.byteLength });
      storageKey = `${userId}/${randomUUID()}-${sanitizeFilename(upload.filename)}`;
      try {
        await storage.uploadFile(storageKey, upload.bytes, upload.mimeType);
      } catch {
        throw new ContentRequestError("ReadMate could not save this upload. Storage is not accepting this document type yet.", 503);
      }
      const createdUpload = await uploadRepository.createUpload(
        userId,
        { filename: upload.filename, mimeType: upload.mimeType, byteSize: upload.bytes.byteLength },
        storageKey
      );
      record = createdUpload;
      let blocks: ExtractedDocumentBlock[];
      try {
        blocks = await documentTextExtractor(upload.bytes, upload.info, {
          maxPages: entitlement.limits.maxPdfPages,
          maxTextChars: entitlement.limits.maxDocumentCharacters
        });
      } catch (error) {
        if (!entitlement.isPremium && /(?:page|text).*(?:limit|exceed)|(?:limit|exceed).*(?:page|text)/i.test(error instanceof Error ? error.message : "")) {
          requireDocumentWithinPlan(entitlement, { textCharacters: entitlement.limits.maxDocumentCharacters + 1 });
        }
        throw new ContentRequestError(error instanceof Error ? error.message : `ReadMate could not extract readable text from this ${upload.info.label}.`, 422);
      }
      if (!blocks.length) {
        throw new ContentRequestError(`ReadMate could not extract readable text from this ${upload.info.label}.`, 422);
      }

      const title = normalizeUploadText(upload.fields.title ?? "") || upload.filename.replace(/\.(pdf|epub|docx|doc|txt|md|markdown|rtf)$/i, "");
      const provider = "google";
      const voice = upload.fields.voice?.trim() || "en-US-Neural2-F";
      const speed = normalizeSpeed(upload.fields.speed);
      const pageCount = pageCountForPdfBlocks(blocks);
      const coverImages = upload.info.kind === "pdf"
        ? await createPdfFirstPageCoverImages({
            mediaStorage,
            userId,
            title,
            pageCount,
            firstPageText: undefined
          })
        : {};
      const description = `${upload.info.label} uploaded as ${upload.filename}.`;
      const learning = learningDataForContent(title, description, blocks);
      const document = await documentRepository.createDocument(userId, {
        title,
        sourceType: upload.info.kind === "pdf" ? "pdf" : "document",
        category: "Documents",
        sourceLabel: `${upload.info.label} upload`,
        thumbnailUrl: coverImages.thumbnailUrl,
        coverImageUrl: coverImages.coverImageUrl,
        description,
        topicTags: ["Documents"],
        estimatedListeningSeconds: estimateListeningSeconds(blocks, speed),
        pageCount,
        summary: learning.summary,
        keyPoints: learning.keyPoints,
        quizQuestions: learning.quizQuestions,
        flashcards: learning.flashcards,
        provider,
        voice,
        speed,
        progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 },
        blocks
      });
      await uploadRepository.attachDocument(userId, record.id, document.id);
      res.status(201).json({ document, upload: { ...createdUpload, documentId: document.id } satisfies UploadRecordResponse });
    } catch (error) {
      if (record) await uploadRepository.deleteUpload(getUserId(req), record.id).catch(() => undefined);
      if (storageKey) await storage.deleteFile(storageKey).catch(() => undefined);
      if (error instanceof ContentRequestError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      if (error instanceof UploadQuotaError) {
        res.status(error.statusCode).json({ error: "Upload quota reached.", code: error.code });
        return;
      }
      next(error);
    } finally {
      releasePermit?.();
    }
  });

  return router;
}

export async function saveRssFeed(input: {
  userId: string;
  url: string;
  title?: string;
  topics?: string[];
  provider: "google";
  voice: string;
  speed: number;
  documentRepository: DocumentRepository;
  sourceRepository: SourceRepository;
  mediaStorage: MediaStorage;
  fetcher: typeof fetch;
  lookup?: HostLookup;
  articlesPerFeed?: number;
  entitlement: ReadMateEntitlement;
  requireHttps?: boolean;
  subscriptionFeedUrl?: string;
  createDocumentTracked?: (
    userId: string,
    document: CreateDocumentInput
  ) => Promise<{ document: ReadingDocumentResponse; created: boolean }>;
  deleteCreatedDocument?: (userId: string, documentId: string) => Promise<void>;
  assertAccountActive?: (userId: string) => Promise<void>;
}): Promise<{
  source: SourceSubscriptionResponse;
  documents: ReadingDocumentResponse[];
  rollback?: () => Promise<void>;
}> {
  const compensationEnabled = Boolean(input.createDocumentTracked);
  if (compensationEnabled && (
    !input.deleteCreatedDocument ||
    !input.mediaStorage.deletePublicObjects ||
    !input.sourceRepository.finalizeSourceSync ||
    !input.sourceRepository.rollbackFinalizedSourceSync
  )) {
    throw new Error("Compensated RSS sync dependencies are incomplete.");
  }

  const resolved = await resolveRssFeed(input.url, input.fetcher, input.lookup, input.requireHttps ?? false);
  if (!resolved.items.length) {
    throw new ContentRequestError("ReadMate could reach this feed, but it did not contain any readable RSS items.", 422);
  }
  const xml = resolved.xml;
  const feedTitle = input.title ?? decodeHtml(matchFirst(xml, /<title[^>]*>([\s\S]*?)<\/title>/i) ?? sourceNameFromUrl(input.url));
  const limit = normalizeArticlesPerFeed(input.articlesPerFeed);
  const items = resolved.items.slice(0, limit);
  const preparedDocuments: Array<{
    item: ReturnType<typeof parseRssItems>[number];
    article: ArticleExtraction | null;
    itemText: ArticleExtraction["blocks"];
    title: string;
    category: string;
    canonicalUrl?: string;
    sourceUrl?: string;
    dedupeKey: string;
  }> = [];
  const seenDedupeKeys = new Set<string>();
  for (const item of items) {
    const normalizedItemLink = normalizeArticleUrl(item.link);
    const article = normalizedItemLink && (!input.requireHttps || isHttpsUrl(normalizedItemLink))
      ? await tryExtractArticle(normalizedItemLink, input.fetcher, input.lookup, input.requireHttps ?? false)
      : null;
    const articleBlocks = article && hasReadableBody(article.blocks) ? article.blocks : [];
    const fallbackBlocks = rssItemToBlocks(item);
    const itemText = articleBlocks.length ? articleBlocks : fallbackBlocks;
    if (!hasReadableBody(itemText)) continue;
    requireDocumentWithinPlan(input.entitlement, { textCharacters: textCharacterCount(itemText) });
    const category = article?.category ?? categoryForText([item.title, item.description].join(" "));
    // The feed's own headline is clean; page titles often carry " - Site Name".
    const title = item.title && item.title !== "Untitled feed item" ? item.title : article?.title ?? item.title;
    const canonicalUrl = normalizeArticleUrl(article?.canonicalUrl ?? normalizedItemLink);
    const sourceUrl = normalizedItemLink ?? canonicalUrl;
    const dedupeKey = rssDedupeKey({ feedUrl: resolved.feedUrl, guid: item.guid, link: sourceUrl, canonicalUrl, title, publishedAt: item.publishedAt });
    if (seenDedupeKeys.has(dedupeKey)) continue;
    seenDedupeKeys.add(dedupeKey);
    preparedDocuments.push({ item, article, itemText, title, category, canonicalUrl, sourceUrl, dedupeKey });
  }
  if (!preparedDocuments.length) {
    throw new ContentRequestError("ReadMate found this RSS feed, but its latest items did not include readable article content.", 422);
  }

  const documents: ReadingDocumentResponse[] = [];
  const pendingDocumentRollbackIds = new Set<string>();
  const pendingMediaRollbackKeys = new Set<string>();
  const compensationMediaNamespace = compensationEnabled ? randomUUID() : undefined;
  let sourceMutation: FinalizedSourceSync | undefined;
  let rolledBack = false;
  const rollback = async () => {
    if (rolledBack) return;
    const failures: unknown[] = [];
    for (const documentId of [...pendingDocumentRollbackIds].reverse()) {
      try {
        await input.deleteCreatedDocument!(input.userId, documentId);
        pendingDocumentRollbackIds.delete(documentId);
      } catch (error) {
        failures.push(error);
      }
    }
    if (pendingMediaRollbackKeys.size) {
      try {
        const keys = [...pendingMediaRollbackKeys];
        await input.mediaStorage.deletePublicObjects!(keys);
        keys.forEach((key) => pendingMediaRollbackKeys.delete(key));
      } catch (error) {
        failures.push(error);
      }
    }
    if (sourceMutation) {
      try {
        await input.sourceRepository.rollbackFinalizedSourceSync!(input.userId, sourceMutation);
        sourceMutation = undefined;
      } catch (error) {
        failures.push(error);
      }
    }
    rolledBack = pendingDocumentRollbackIds.size === 0 && pendingMediaRollbackKeys.size === 0 && !sourceMutation;
    if (failures.length) {
      throw new Error(`RSS initial-sync compensation failed for ${failures.length} database operation(s).`);
    }
  };

  try {
    for (const [preparedIndex, prepared] of preparedDocuments.entries()) {
      await input.assertAccountActive?.(input.userId);
      const { item, article, itemText, title, category, canonicalUrl, sourceUrl, dedupeKey } = prepared;
      let coverImages;
      try {
        coverImages = await cacheRemoteCoverImages({
          // HTTPS-only syncs (app and WebMCP sources, background refresh) still
          // use the article's artwork, fetched without any plain-HTTP hop.
          imageUrl: item.imageUrl ?? article?.thumbnailUrl,
          requireHttps: input.requireHttps,
          userId: input.userId,
          title,
          sourceName: feedTitle,
          category,
          fetcher: input.fetcher,
          lookup: input.lookup,
          mediaStorage: input.mediaStorage,
          storageKeySuffix: compensationMediaNamespace
            ? `${compensationMediaNamespace}-${preparedIndex}`
            : undefined,
          requireCleanup: compensationEnabled
        });
      } catch (error) {
        if (error instanceof CachedMediaCleanupError) {
          error.storageKeys.forEach((key) => pendingMediaRollbackKeys.add(key));
        }
        throw error;
      }
      const mediaKeys = coverImages.storageKeys ?? [];
      if (compensationEnabled) mediaKeys.forEach((key) => pendingMediaRollbackKeys.add(key));
      const learning = learningDataForContent(title, article?.description ?? stripHtml(item.description ?? ""), itemText);
      const documentInput: CreateDocumentInput = {
        title,
        sourceType: "rss",
        sourceUrl,
        canonicalUrl,
        rssFeedUrl: resolved.feedUrl,
        dedupeKey,
        category,
        sourceLabel: feedTitle,
        thumbnailUrl: coverImages.thumbnailUrl,
        coverImageUrl: coverImages.coverImageUrl,
        author: article?.author,
        description: article?.description ?? stripHtml(item.description ?? "").slice(0, 500),
        contentHtml: article?.contentHtml ?? item.contentHtml,
        topicTags: topicTagsForText([item.title, item.description].join(" "), category),
        estimatedListeningSeconds: estimateListeningSeconds(itemText, input.speed),
        summary: learning.summary,
        keyPoints: learning.keyPoints,
        quizQuestions: learning.quizQuestions,
        flashcards: learning.flashcards,
        provider: input.provider,
        voice: input.voice,
        speed: input.speed,
        progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 },
        blocks: itemText
      };
      await input.assertAccountActive?.(input.userId);
      if (input.createDocumentTracked) {
        let created;
        try {
          created = await input.createDocumentTracked(input.userId, documentInput);
        } catch (error) {
          if (error instanceof TrackedRssDocumentHydrationError) {
            pendingDocumentRollbackIds.add(error.createdDocumentId);
          }
          throw error;
        }
        documents.push(created.document);
        if (created.created) {
          pendingDocumentRollbackIds.add(created.document.id);
        } else if (mediaKeys.length) {
          await input.mediaStorage.deletePublicObjects!(mediaKeys);
          mediaKeys.forEach((key) => pendingMediaRollbackKeys.delete(key));
        }
      } else {
        documents.push(await input.documentRepository.createDocument(input.userId, documentInput));
      }
    }

    const discoveredWebsiteUrl = feedWebsiteUrl(xml, resolved.feedUrl);
    const sourceInput = {
      sourceName: feedTitle,
      rssFeedUrl: input.subscriptionFeedUrl ?? resolved.feedUrl,
      websiteUrl: !input.requireHttps || isHttpsUrl(discoveredWebsiteUrl)
        ? discoveredWebsiteUrl ?? originFromUrl(resolved.feedUrl)
        : originFromUrl(resolved.feedUrl),
      sourceType: "rss" as const,
      topics: input.topics?.length ? input.topics : ["News"]
    };
    await input.assertAccountActive?.(input.userId);
    let source: SourceSubscriptionResponse;
    if (compensationEnabled) {
      sourceMutation = await input.sourceRepository.finalizeSourceSync!(input.userId, sourceInput, new Date());
      source = sourceMutation.source;
    } else {
      source = await input.sourceRepository.subscribeSource(input.userId, sourceInput);
      if (input.sourceRepository.markSourceSynced) {
        const syncedSource = await input.sourceRepository.markSourceSynced(input.userId, source.id, new Date());
        if (!syncedSource) throw new Error("The RSS source disappeared before its completed sync could be recorded.");
        source = syncedSource;
      }
    }
    return { source, documents, ...(compensationEnabled ? { rollback } : {}) };
  } catch (error) {
    if (compensationEnabled) {
      try {
        await rollback();
      } catch (rollbackError) {
        console.error(JSON.stringify({
          event: "rss_initial_sync_compensation_failed",
          message: rollbackError instanceof Error ? rollbackError.message : "Unknown rollback error."
        }));
      }
    }
    throw error;
  }
}

async function extractArticleFromUrl(
  url: string,
  fetcher: typeof fetch,
  lookup?: HostLookup,
  requireHttps = false
): Promise<ArticleExtraction> {
  const { response, body, url: finalUrl } = await safeRemoteFetch(url, {
    fetcher,
    lookup,
    headers: pageFetchHeaders,
    maxBytes: 2 * 1024 * 1024,
    allowedProtocols: requireHttps ? ["https:"] : undefined
  });
  if (!response.ok) throw new Error(`Could not fetch page: ${response.status}`);
  const html = Buffer.from(body).toString("utf8");
  const metadata = extractMetadata(html, finalUrl);
  const blocks = extractReadableBlocks(html, metadata.title);
  const text = [metadata.title, metadata.description, ...blocks.slice(0, 5).map((block) => block.text)].join(" ");
  const category = categoryForText(text);
  return {
    title: metadata.title || sourceNameFromUrl(finalUrl),
    sourceName: metadata.sourceName ?? sourceNameFromUrl(finalUrl),
    canonicalUrl: metadata.canonicalUrl ?? finalUrl,
    sourceUrl: finalUrl,
    author: metadata.author,
    publishedAt: metadata.publishedAt,
    description: metadata.description,
    thumbnailUrl: metadata.thumbnailUrl,
    contentHtml: metadata.articleHtml,
    blocks,
    category,
    topicTags: topicTagsForText(text, category)
  };
}

async function resolveRssFeed(
  url: string,
  fetcher: typeof fetch,
  lookup?: HostLookup,
  requireHttps = false
): Promise<{ feedUrl: string; xml: string; items: ReturnType<typeof parseRssItems> }> {
  const attempted = new Set<string>();
  const direct = await tryReadFeed(url, fetcher, attempted, lookup, requireHttps);
  if (direct?.items.length) return direct;

  const html = direct?.text && isHtmlResponse(direct.text, direct.contentType)
    ? direct.text
    : await tryFetchHtml(url, fetcher, lookup, requireHttps);
  const discovered = (html ? discoverFeedUrls(html, direct?.finalUrl ?? url) : [])
    .filter((candidate) => !requireHttps || isHttpsUrl(candidate));
  const fallbackCandidates = commonFeedCandidates(direct?.finalUrl ?? url);
  const candidates = [
    ...discovered,
    ...fallbackCandidates,
    ...(requireHttps ? [] : protocolFallbacks(url))
  ].filter((candidate) => !requireHttps || isHttpsUrl(candidate));

  for (const candidate of candidates) {
    const feed = await tryReadFeed(candidate, fetcher, attempted, lookup, requireHttps);
    if (feed?.items.length) return feed;
  }

  const lastStatus = direct?.status ? ` (${direct.status})` : "";
  throw new ContentRequestError(`ReadMate could not find a working RSS feed for this source${lastStatus}. Try adding the website instead.`, 422);
}

async function tryReadFeed(
  url: string,
  fetcher: typeof fetch,
  attempted: Set<string>,
  lookup?: HostLookup,
  requireHttps = false
): Promise<{ feedUrl: string; finalUrl: string; text: string; xml: string; contentType?: string; status: number; items: ReturnType<typeof parseRssItems> } | null> {
  if (attempted.has(url)) return null;
  attempted.add(url);
  try {
    const result = await safeRemoteFetch(url, {
      fetcher,
      lookup,
      headers: feedFetchHeaders,
      maxBytes: 2 * 1024 * 1024,
      allowedProtocols: requireHttps ? ["https:"] : undefined
    });
    const text = Buffer.from(result.body).toString("utf8");
    const contentType = result.response.headers.get("content-type") ?? undefined;
    if (!result.response.ok) {
      return { feedUrl: url, finalUrl: result.url, text, xml: text, contentType, status: result.response.status, items: [] };
    }
    const finalUrl = result.url;
    const items = parseRssItems(text, finalUrl);
    return { feedUrl: finalUrl, finalUrl, text, xml: text, contentType, status: result.response.status, items };
  } catch {
    return null;
  }
}

async function tryFetchHtml(
  url: string,
  fetcher: typeof fetch,
  lookup?: HostLookup,
  requireHttps = false
): Promise<string | null> {
  try {
    const result = await safeRemoteFetch(url, {
      fetcher,
      lookup,
      headers: pageFetchHeaders,
      maxBytes: 2 * 1024 * 1024,
      allowedProtocols: requireHttps ? ["https:"] : undefined
    });
    if (!result.response.ok) return null;
    const text = Buffer.from(result.body).toString("utf8");
    return isHtmlResponse(text, result.response.headers.get("content-type") ?? undefined) ? text : null;
  } catch {
    return null;
  }
}

function discoverFeedUrls(html: string, baseUrl: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = attrValue(tag, "rel")?.toLowerCase() ?? "";
    const type = attrValue(tag, "type")?.toLowerCase() ?? "";
    if (!rel.includes("alternate")) continue;
    if (!/(rss|atom|json|xml)/i.test(type)) continue;
    const href = attrValue(tag, "href");
    const absolute = absolutizeUrl(href, baseUrl);
    if (absolute) urls.add(absolute);
  }
  return [...urls];
}

function commonFeedCandidates(url: string): string[] {
  try {
    const parsed = new URL(url);
    return ["/feed/", "/rss.xml", "/atom.xml", "/feed.xml"].map((path) => new URL(path, parsed.origin).href);
  } catch {
    return [];
  }
}

function protocolFallbacks(url: string): string[] {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return [];
    parsed.protocol = "http:";
    return [parsed.href];
  } catch {
    return [];
  }
}

function isHtmlResponse(text: string, contentType?: string): boolean {
  return /text\/html/i.test(contentType ?? "") || /^\s*<!doctype html/i.test(text) || /^\s*<html[\s>]/i.test(text);
}

async function tryExtractArticle(
  url: string,
  fetcher: typeof fetch,
  lookup?: HostLookup,
  requireHttps = false
): Promise<ArticleExtraction | null> {
  try {
    return await extractArticleFromUrl(url, fetcher, lookup, requireHttps);
  } catch {
    return null;
  }
}

function isHttpsUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function extractMetadata(html: string, url: string) {
  const title =
    meta(html, "property", "og:title") ??
    meta(html, "name", "twitter:title") ??
    decodeHtml(matchFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ?? "");
  const description = meta(html, "property", "og:description") ?? meta(html, "name", "description") ?? meta(html, "name", "twitter:description");
  const canonicalUrl = attrValue(matchWhole(html, /<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]*>/i) ?? "", "href");
  const ogImage = meta(html, "property", "og:image");
  const twitterImage = meta(html, "name", "twitter:image");
  const structuredImage = extractJsonLdImage(html);
  const bodyImage = extractBodyImage(html);
  const sourceName = meta(html, "property", "og:site_name") ?? sourceNameFromUrl(url);
  const articleHtml = matchFirst(html, /<article\b[^>]*>([\s\S]*?)<\/article>/i) ?? matchFirst(html, /<main\b[^>]*>([\s\S]*?)<\/main>/i);
  return {
    title: stripHtml(title),
    description: description ? stripHtml(description) : undefined,
    canonicalUrl: canonicalUrl ? absolutizeUrl(canonicalUrl, url) : undefined,
    thumbnailUrl: absolutizeUrl(ogImage ?? twitterImage ?? structuredImage ?? bodyImage, url),
    sourceName,
    author: meta(html, "name", "author") ?? meta(html, "property", "article:author"),
    publishedAt: meta(html, "property", "article:published_time") ?? meta(html, "name", "pubdate"),
    articleHtml
  };
}

function extractReadableBlocks(html: string, fallbackTitle: string) {
  const scope =
    matchFirst(html, /<article\b[^>]*>([\s\S]*?)<\/article>/i) ??
    matchFirst(html, /<main\b[^>]*>([\s\S]*?)<\/main>/i) ??
    matchFirst(html, /<body\b[^>]*>([\s\S]*?)<\/body>/i) ??
    html;
  const clean = scope
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, "")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, "");
  const blocks: Array<{ blockType: "heading" | "paragraph" | "list"; text: string }> = [];
  const pattern = /<(h1|h2|h3|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of clean.matchAll(pattern)) {
    const tag = match[1].toLowerCase();
    const text = stripHtml(match[2]);
    if (text.length < 35 && !/^h[1-3]$/.test(tag)) continue;
    if (blocks.some((block) => block.text === text)) continue;
    blocks.push({ blockType: /^h[1-3]$/.test(tag) ? "heading" : tag === "li" ? "list" : "paragraph", text });
    if (blocks.length >= 300) break;
  }
  if (!blocks.length) return textToBlocks(stripHtml(clean), fallbackTitle);
  return blocks;
}

function textToBlocks(text: string, title?: string) {
  const blocks: Array<{ blockType: "heading" | "paragraph"; text: string }> = [];
  if (title) blocks.push({ blockType: "heading", text: title });
  const paragraphs = text
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 35);
  for (const paragraph of paragraphs) {
    blocks.push({ blockType: "paragraph", text: paragraph.slice(0, 20_000) });
    if (blocks.length >= 300) break;
  }
  if (!blocks.length && text.trim()) blocks.push({ blockType: "paragraph", text: text.trim().slice(0, 20_000) });
  return blocks;
}

function rssItemToBlocks(item: ReturnType<typeof parseRssItems>[number]) {
  const text = stripHtml(item.contentHtml ?? item.description ?? "");
  return textToBlocks(text, item.title);
}

function hasReadableBody(blocks: Array<{ blockType: string; text: string }>): boolean {
  return blocks.some((block) => block.blockType !== "heading" && block.text.trim().split(/\s+/).length >= 8);
}

function textCharacterCount(blocks: Array<{ text: string }>): number {
  return blocks.reduce((total, block) => total + block.text.length, 0);
}

function parseRssItems(xml: string, feedUrl: string) {
  const chunks = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  const atomChunks = chunks.length ? [] : [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((match) => match[1]);
  return (chunks.length ? chunks : atomChunks).map((chunk) => {
    const title = stripHtml(decodeHtml(matchFirst(chunk, /<title[^>]*>([\s\S]*?)<\/title>/i) ?? "Untitled feed item"));
    const link = rssItemLink(chunk);
    const guid =
      decodeHtml(matchFirst(chunk, /<guid\b[^>]*>([\s\S]*?)<\/guid>/i) ?? "").trim() ||
      decodeHtml(matchFirst(chunk, /<id\b[^>]*>([\s\S]*?)<\/id>/i) ?? "").trim();
    const contentHtml =
      matchFirst(chunk, /<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i) ??
      matchFirst(chunk, /<content\b[^>]*>([\s\S]*?)<\/content>/i);
    const description =
      matchFirst(chunk, /<description[^>]*>([\s\S]*?)<\/description>/i) ??
      matchFirst(chunk, /<summary[^>]*>([\s\S]*?)<\/summary>/i) ??
      contentHtml;
    const imageUrl =
      attrValue(matchWhole(chunk, /<media:content\b[^>]*url=["'][^"']+["'][^>]*>/i) ?? "", "url") ??
      attrValue(matchWhole(chunk, /<media:thumbnail\b[^>]*url=["'][^"']+["'][^>]*>/i) ?? "", "url") ??
      attrValue(matchWhole(chunk, /<enclosure\b[^>]*type=["']image\/[^"']+["'][^>]*>/i) ?? "", "url");
    return {
      title,
      guid: guid || undefined,
      link: link ? absolutizeUrl(link, feedUrl) : undefined,
      description: description ? decodeHtml(description) : undefined,
      contentHtml: contentHtml ? decodeHtml(contentHtml) : undefined,
      imageUrl: absolutizeUrl(imageUrl, feedUrl),
      publishedAt:
        decodeHtml(matchFirst(chunk, /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) ?? "") ||
        decodeHtml(matchFirst(chunk, /<updated[^>]*>([\s\S]*?)<\/updated>/i) ?? "")
    };
  });
}

function rssItemLink(chunk: string): string | undefined {
  const plain = decodeHtml(matchFirst(chunk, /<link[^>]*>([\s\S]*?)<\/link>/i) ?? "").trim();
  if (plain) return plain;
  const alternate =
    matchWhole(chunk, /<link\b(?=[^>]*\bhref=["'][^"']+["'])(?=[^>]*\brel=["']alternate["'])[^>]*>/i) ??
    matchWhole(chunk, /<link\b(?=[^>]*\bhref=["'][^"']+["'])(?![^>]*\brel=["']self["'])[^>]*>/i) ??
    matchWhole(chunk, /<link\b[^>]*href=["'][^"']+["'][^>]*>/i);
  return attrValue(alternate ?? "", "href");
}

function rssDedupeKey(input: {
  feedUrl: string;
  guid?: string;
  link?: string;
  canonicalUrl?: string;
  title: string;
  publishedAt?: string;
}): string {
  const canonicalUrl = normalizeArticleUrl(input.canonicalUrl);
  const link = normalizeArticleUrl(input.link);
  const guid = input.guid?.trim();
  const guidUrl = normalizeArticleUrl(guid);
  const articleUrl = canonicalUrl || link || guidUrl;
  if (articleUrl) return `rss:url:${articleUrl}`;
  if (guid) return `rss:guid:${feedOriginKey(input.feedUrl)}:${guid.toLowerCase()}`;
  const title = input.title.toLowerCase().replace(/\s+/g, " ").trim();
  const published = input.publishedAt ? normalizePublishedDate(input.publishedAt) : "";
  return `rss:title:${published}:${title}`;
}

function normalizeArticleUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      parsed.protocol = "https:";
    }
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(fbclid|gclid|mc_cid|mc_eid|igshid|ref|ref_src|ocid|ito|outputType)$/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.searchParams.sort();
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) {
      parsed.port = "";
    }
    return parsed.href;
  } catch {
    return undefined;
  }
}

function feedOriginKey(value: string): string {
  try {
    const parsed = new URL(value);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return value.toLowerCase().trim();
  }
}

function normalizePublishedDate(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : value.trim().toLowerCase();
}

async function parseDocumentMultipart(req: Request): Promise<{
  filename: string;
  mimeType: string;
  info: ReturnType<typeof supportedDocumentInfo>;
  bytes: Uint8Array;
  fields: Record<string, string>;
}> {
  const contentType = String(req.headers["content-type"] ?? "");
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[1] ?? contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[2];
  if (!boundary) throw new Error("Missing multipart boundary.");
  const body = await readRequestBody(req, MAX_DOCUMENT_BYTES + 1024 * 1024);
  const boundaryText = `--${boundary}`;
  const parts = body.toString("binary").split(boundaryText).slice(1, -1);
  const fields: Record<string, string> = {};
  let file: { filename: string; mimeType: string; info: ReturnType<typeof supportedDocumentInfo>; bytes: Uint8Array } | null = null;

  for (const rawPart of parts) {
    const trimmed = rawPart.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const headerEnd = trimmed.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const header = trimmed.slice(0, headerEnd);
    const content = trimmed.slice(headerEnd + 4);
    const name = header.match(/name="([^"]+)"/i)?.[1];
    const rawFilename = header.match(/filename="([^"]+)"/i)?.[1];
    if (!name) continue;
    if (rawFilename) {
      const filename = normalizeUploadFilename(rawFilename);
      const mimeType = header.match(/content-type:\s*([^\r\n]+)/i)?.[1].trim().toLowerCase();
      let info: ReturnType<typeof supportedDocumentInfo>;
      try {
        info = supportedDocumentInfo(filename, mimeType);
      } catch (error) {
        throw new ContentRequestError(error instanceof Error ? error.message : "Upload a PDF, EPUB, DOCX, DOC, TXT, Markdown, or RTF document.", 400);
      }
      const bytes = Uint8Array.from(Buffer.from(content, "binary"));
      if (!bytes.byteLength || bytes.byteLength > MAX_DOCUMENT_BYTES) throw new ContentRequestError("Document upload size is invalid.", 400);
      if (info.kind === "pdf" && !isPdfBytes(bytes)) throw new ContentRequestError("The uploaded file is not a valid PDF.", 400);
      file = { filename, mimeType: info.mimeType, info, bytes };
    } else {
      fields[name] = decodeHtml(content.trim());
    }
  }

  if (!file) throw new ContentRequestError("No document file was uploaded.", 400);
  return { ...file, fields };
}

async function readRequestBody(req: Request, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function normalizeInputUrl(input: string, sourceType: string): string {
  const known = knownSource(input);
  const raw = known ? (sourceType === "rss" ? known.rssUrl ?? known.url : known.url) : input.trim();
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).href;
  } catch {
    throw new Error("Enter a valid website or RSS URL.");
  }
}

const knownSources = [
  { name: "CNN", url: "https://www.cnn.com", rssUrl: "http://rss.cnn.com/rss/edition.rss" },
  { name: "Engadget", url: "https://www.engadget.com", rssUrl: "https://www.engadget.com/rss.xml" },
  { name: "Reuters", url: "https://www.reuters.com" },
  { name: "BBC", url: "https://www.bbc.com/news", rssUrl: "https://feeds.bbci.co.uk/news/rss.xml" },
  { name: "TechCrunch", url: "https://techcrunch.com", rssUrl: "https://techcrunch.com/feed/" },
  { name: "The Verge", url: "https://www.theverge.com", rssUrl: "https://www.theverge.com/rss/index.xml" },
  { name: "MyJoyOnline", url: "https://www.myjoyonline.com", rssUrl: "https://www.myjoyonline.com/feed/" }
];

function knownSource(input: string) {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, "");
  return knownSources.find((source) => source.name.toLowerCase().replace(/\s+/g, "") === normalized);
}

function meta(html: string, attrName: "name" | "property", attrValueText: string): string | undefined {
  const pattern = new RegExp(`<meta\\b(?=[^>]*\\b${attrName}=["']${escapeRegExp(attrValueText)}["'])(?=[^>]*\\bcontent=(?:"[^"]+"|'[^']+'))[^>]*>`, "i");
  const tag = matchWhole(html, pattern);
  return tag ? decodeHtml(attrValue(tag, "content") ?? "") : undefined;
}

function extractJsonLdImage(html: string): string | undefined {
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]));
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates) {
        const image = candidate?.image ?? candidate?.thumbnailUrl ?? candidate?.primaryImageOfPage;
        if (typeof image === "string") return image;
        if (Array.isArray(image) && typeof image[0] === "string") return image[0];
        if (image?.url && typeof image.url === "string") return image.url;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function extractBodyImage(html: string): string | undefined {
  const imageTag = matchWhole(html, /<img\b(?=[^>]*\bsrc=["'][^"']+["'])[^>]*>/i);
  return imageTag ? attrValue(imageTag, "src") : undefined;
}

function matchFirst(value: string, pattern: RegExp): string | undefined {
  return value.match(pattern)?.[1];
}

function matchWhole(value: string, pattern: RegExp): string | undefined {
  return value.match(pattern)?.[0];
}

function attrValue(tag: string, name: string): string | undefined {
  // Read up to the matching quote so values like content="Pixel 11's ..." stay whole.
  const match = tag.match(new RegExp(`\\b${escapeRegExp(name)}=(?:"([^"]+)"|'([^']+)')`, "i"));
  const value = match?.[1] ?? match?.[2];
  return value ? decodeHtml(value) : undefined;
}

function stripHtml(value: string): string {
  return decodeHtml(
    value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function absolutizeUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return undefined;
  }
}

function sourceNameFromUrl(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "ReadMate";
  }
}

function originFromUrl(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function looksLikeFeedUrl(value: string): boolean {
  return /(?:\/feed\/?|rss|atom|\.xml)(?:[?#].*)?$/i.test(value);
}

function matchAtomLink(xml: string): string | undefined {
  return attrValue(matchWhole(xml, /<link\b[^>]*rel=["']alternate["'][^>]*>/i) ?? "", "href");
}

function feedWebsiteUrl(xml: string, feedUrl: string): string | undefined {
  const atomAlternate = matchAtomLink(xml);
  if (atomAlternate) return absolutizeUrl(atomAlternate, feedUrl);
  const channel = matchFirst(xml, /<channel\b[^>]*>([\s\S]*?)<\/channel>/i);
  const channelLink = channel ? matchFirst(channel, /<link[^>]*>([\s\S]*?)<\/link>/i) : undefined;
  return channelLink ? absolutizeUrl(decodeHtml(stripHtml(channelLink)), feedUrl) : undefined;
}

function categoryForText(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(ai|artificial intelligence|software|startup|apple|google|microsoft|tesla|chip|cyber|gadget|technology|tech)\b/.test(lower)) return "Technology";
  if (/\b(election|president|parliament|minister|government|policy|campaign|senate|court|law|politics)\b/.test(lower)) return "Politics";
  if (/\b(market|stock|bank|finance|economy|business|revenue|profit|investor|trade|inflation)\b/.test(lower)) return "Business";
  if (/\b(health|medical|doctor|hospital|fitness|disease|wellness|vaccine|nutrition)\b/.test(lower)) return "Health";
  if (/\b(sport|football|soccer|nba|nfl|tennis|golf|boxing|rugby|athlete|match)\b/.test(lower)) return "Sports";
  if (/\b(movie|music|celebrity|entertainment|film|tv|streaming|culture)\b/.test(lower)) return "Entertainment";
  return "News";
}

function topicTagsForText(text: string, category: string): string[] {
  const tags = new Set<string>(category ? [category] : []);
  const lower = text.toLowerCase();
  if (/\b(pdf|document|report|paper)\b/.test(lower)) tags.add("Documents");
  if (/\b(rss|feed|newsletter)\b/.test(lower)) tags.add("Feeds");
  return [...tags].slice(0, 8);
}

function estimateListeningSeconds(blocks: Array<{ text: string }>, speed: number): number {
  const words = blocks.reduce((sum, block) => sum + block.text.trim().split(/\s+/).filter(Boolean).length, 0);
  return Math.max(1, Math.ceil((words / (155 * speed)) * 60));
}

function pageCountForPdfBlocks(blocks: Array<{ sourcePageNumber?: number }>): number {
  return Math.max(1, ...blocks.map((block) => block.sourcePageNumber ?? 0));
}

function learningDataForContent(
  title: string,
  description: string | undefined,
  blocks: Array<{ text: string }>
): {
  summary: string;
  keyPoints: string[];
  quizQuestions: Array<{ question: string; answer: string }>;
  flashcards: Array<{ front: string; back: string }>;
} {
  const text = [title, description, ...blocks.map((block) => block.text)]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 25);
  const summary = sentences.slice(0, 2).join(" ").slice(0, 900) || description || title;
  const keyPoints = uniqueStrings(sentences.filter((sentence) => sentence !== title).slice(0, 4));
  const points = keyPoints.length ? keyPoints : [summary];
  return {
    summary,
    keyPoints: points.slice(0, 4),
    quizQuestions: points.slice(0, 3).map((point, index) => ({
      question: questionForPoint(point, title, index),
      answer: point
    })),
    flashcards: points.slice(0, 4).map((point, index) => ({
      front: flashcardPromptForPoint(point, title, index),
      back: point
    }))
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function questionForPoint(point: string, title: string, index: number): string {
  const topic = topicFromPoint(point, title);
  if (/\b(because|therefore|so that|as a result|due to|led to|caused)\b/i.test(point)) {
    return `Why does ${topic} matter in this document?`;
  }
  if (/\b(challenge|risk|problem|barrier|obstacle|concern)\b/i.test(point)) {
    return `What challenge does the document describe about ${topic}?`;
  }
  if (/\b(recommend|should|need to|must|propose)\b/i.test(point)) {
    return `What recommendation is made about ${topic}?`;
  }
  return index === 0 ? `What central point does the document make about ${topic}?` : `What important detail is given about ${topic}?`;
}

function flashcardPromptForPoint(point: string, title: string, index: number): string {
  const topic = topicFromPoint(point, title);
  if (/\b(percent|%|majority|minority|respondents|participants|sample|rate|score)\b/i.test(point)) {
    return `What figure or evidence is reported about ${topic}?`;
  }
  if (/\b(impact|effect|influence|relationship|correlation)\b/i.test(point)) {
    return `What effect is connected to ${topic}?`;
  }
  if (/\b(recommend|should|need to|must|propose)\b/i.test(point)) {
    return `What action is recommended for ${topic}?`;
  }
  return index === 0 ? `What should you remember about ${topic}?` : `How does the document explain ${topic}?`;
}

function topicFromPoint(point: string, title: string): string {
  const cleanedTitle = title.replace(/\s+/g, " ").trim();
  const cleanedPoint = point
    .replace(/["“”]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleanedPoint
    .split(/\s+/)
    .filter((word) => !/^(the|a|an|and|or|but|this|that|these|those|with|from|into|their|there|when|where|which|were|was|are|is|has|have|had|can|could|would|should|will|may|might|also|study|document|paper)$/i.test(word))
    .slice(0, 8)
    .join(" ");
  return words || cleanedTitle || "this topic";
}

function sanitizeFilename(filename: string): string {
  const clean = filename
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
  return clean || "upload";
}

function normalizeUploadText(value: string): string {
  const trimmed = value.trim();
  if (!/%[0-9a-f]{2}/i.test(trimmed)) return trimmed;
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function normalizeUploadFilename(value: string): string {
  return normalizeUploadText(value)
    .replace(/[\u0000-\u001f\u007f/\\]/g, "-")
    .replace(/\s+/g, " ")
    .trim() || "upload";
}

function normalizeSpeed(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0.5 && parsed <= 4 ? parsed : 1;
}

function normalizeArticlesPerFeed(value: number | undefined): number {
  if (value === undefined) return 10;
  return Number.isInteger(value) && value >= 1 && value <= 50 ? value : 10;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const __contentInternals = { extractMetadata, attrValue };
