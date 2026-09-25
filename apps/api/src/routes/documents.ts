import type { Prisma } from "@prisma/client";
import type { Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { getUserId, type AuthedRequest } from "../auth.js";
import { clearLearningDataForDocument, clearLearningDataForDocuments } from "../learning/cleanup.js";
import type { prisma as PrismaSingleton } from "../prisma.js";
import { normalizeGoogleTtsVoice } from "../ttsSchema.js";
import { entitlementForRequest, requireDocumentWithinPlan, type MaybePromise, type ReadMateEntitlement } from "../entitlements.js";

const sourceTypes = ["webpage", "selection", "pdf", "ocr", "url", "rss", "news", "document"] as const;
const documentSearchSourceTypes = ["webpage", "pdf", "rss", "document"] as const;
const providers = ["google"] as const;
const blockTypes = ["heading", "paragraph", "list", "quote", "table", "caption", "page"] as const;
const documentStatuses = ["unread", "in_progress", "completed"] as const;
const providerSchema = z.preprocess(() => "google", z.literal("google"));
const voiceSchema = z.preprocess(normalizeGoogleTtsVoice, z.string().min(1).max(100));
const optionalVoiceSchema = z.preprocess((value) => (value === undefined ? undefined : normalizeGoogleTtsVoice(value)), z.string().min(1).max(100).optional());

const listDocumentsQuerySchema = z.object({
  query: z.string().trim().min(1).max(120).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  sourceType: z.enum(sourceTypes).optional(),
  status: z.enum(documentStatuses).optional(),
  limit: z.coerce.number().int().min(1).max(10).optional(),
  view: z.enum(["full", "summary"]).optional()
}).strict().superRefine((value, context) => {
  if (value.query && value.q) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Use either query or q, not both.",
      path: ["query"]
    });
  }
});

const searchDocumentsQuerySchema = z.object({
  query: z.string().trim().min(1).max(120).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  sourceType: z.enum(documentSearchSourceTypes).optional(),
  status: z.enum(documentStatuses).optional(),
  limit: z.coerce.number().int().min(1).max(10).default(10)
}).strict().superRefine((value, context) => {
  if (value.query && value.q) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Use either query or q, not both.",
      path: ["query"]
    });
  }
});

const libraryPageQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
}).strict();

const libraryCursorSchema = z.object({
  updatedAt: z.string().datetime(),
  id: z.string().trim().min(1).max(80)
}).strict();

const documentContextParamsSchema = z.object({
  id: z.string().trim().min(1).max(80)
}).strict();

const readingBlockSchema = z.object({
  orderIndex: z.number().int().min(0).optional(),
  blockType: z.enum(blockTypes).default("paragraph"),
  text: z.string().min(1).max(20_000),
  sourceSelector: z.string().min(1).optional(),
  sourcePageNumber: z.number().int().min(1).optional()
});

const progressSchema = z.object({
  blockIndex: z.number().int().min(0),
  characterOffset: z.number().int().min(0).default(0),
  sentenceIndex: z.number().int().min(0).default(0),
  percent: z.number().int().min(0).max(100)
});

const createDocumentSchema = z.object({
  title: z.string().min(1).max(500),
  sourceType: z.enum(sourceTypes),
  sourceUrl: z.string().url().optional(),
  canonicalUrl: z.string().url().optional(),
  rssFeedUrl: z.string().url().optional(),
  dedupeKey: z.string().trim().min(1).max(500).optional(),
  category: z.string().trim().min(1).max(80).default("Uncategorized"),
  sourceLabel: z.string().trim().min(1).max(120).optional(),
  thumbnailUrl: z.string().url().optional(),
  coverImageUrl: z.string().url().optional(),
  author: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(1000).optional(),
  contentHtml: z.string().max(1_000_000).optional(),
  topicTags: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  estimatedListeningSeconds: z.number().int().min(0).max(24 * 60 * 60).optional(),
  pageCount: z.number().int().min(1).max(20_000).optional(),
  status: z.enum(documentStatuses).optional(),
  summary: z.string().trim().min(1).max(4000).optional(),
  keyPoints: z.array(z.string().trim().min(1).max(500)).max(12).optional(),
  quizQuestions: z.array(z.object({ question: z.string().trim().min(1).max(500), answer: z.string().trim().min(1).max(1000) })).max(12).optional(),
  flashcards: z.array(z.object({ front: z.string().trim().min(1).max(500), back: z.string().trim().min(1).max(1000) })).max(24).optional(),
  provider: providerSchema.default("google"),
  voice: voiceSchema,
  speed: z.number().min(0.5).max(4),
  progress: progressSchema.default({ blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 }),
  blocks: z.array(readingBlockSchema).min(1).max(2_000)
});

const updateProgressSchema = z.object({
  progress: progressSchema,
  provider: providerSchema.optional(),
  voice: optionalVoiceSchema,
  speed: z.number().min(0.5).max(4).optional()
});

const updateDocumentSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  sourceUrl: z.string().url().nullable().optional(),
  canonicalUrl: z.string().url().nullable().optional(),
  rssFeedUrl: z.string().url().nullable().optional(),
  category: z.string().trim().min(1).max(80).optional(),
  sourceLabel: z.string().trim().min(1).max(120).optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
  coverImageUrl: z.string().url().nullable().optional(),
  author: z.string().trim().min(1).max(200).nullable().optional(),
  description: z.string().trim().min(1).max(1000).nullable().optional(),
  contentHtml: z.string().max(1_000_000).nullable().optional(),
  topicTags: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  pageCount: z.number().int().min(1).max(20_000).nullable().optional(),
  status: z.enum(documentStatuses).optional(),
  summary: z.string().trim().min(1).max(4000).nullable().optional(),
  keyPoints: z.array(z.string().trim().min(1).max(500)).max(12).optional(),
  quizQuestions: z.array(z.object({ question: z.string().trim().min(1).max(500), answer: z.string().trim().min(1).max(1000) })).max(12).optional(),
  flashcards: z.array(z.object({ front: z.string().trim().min(1).max(500), back: z.string().trim().min(1).max(1000) })).max(24).optional()
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateProgressInput = z.infer<typeof updateProgressSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

export type DocumentListFilters = {
  query?: string;
  sourceType?: (typeof sourceTypes)[number];
  status?: (typeof documentStatuses)[number];
  limit?: number;
  /**
   * `summary` omits reading blocks and stored HTML, which dominate payload
   * size, and reports `blockCount` instead. Clients fetch one document in
   * full before reading or playing it.
   */
  view?: "full" | "summary";
};

export type DocumentSearchFilters = {
  query?: string;
  sourceType?: (typeof documentSearchSourceTypes)[number];
  status?: (typeof documentStatuses)[number];
  limit: number;
};

export type DocumentSearchItemResponse = {
  documentId: string;
  title: string;
  sourceType: (typeof documentSearchSourceTypes)[number];
  status: (typeof documentStatuses)[number];
  progressPercent: number;
  updatedAt: string;
  deepLink: string;
};

export type DocumentSearchResponse = {
  results: DocumentSearchItemResponse[];
  total: number;
};

export type DocumentLibraryCursor = {
  updatedAt: string;
  id: string;
};

export type DocumentLibraryPageFilters = {
  limit: number;
  cursor?: DocumentLibraryCursor;
};

export type DocumentLibraryItemResponse = {
  documentId: string;
  title: string;
  sourceType: (typeof sourceTypes)[number];
  category: string;
  sourceLabel?: string;
  author?: string;
  status: (typeof documentStatuses)[number];
  progressPercent: number;
  estimatedListeningSeconds?: number;
  createdAt: string;
  updatedAt: string;
  lastReadAt?: string;
};

export type DocumentLibraryPageResult = {
  items: DocumentLibraryItemResponse[];
  nextCursor?: DocumentLibraryCursor;
};

export type DocumentLibraryPageResponse = {
  items: DocumentLibraryItemResponse[];
  nextCursor?: string;
};

export type ReadingDocumentResponse = {
  id: string;
  userId: string;
  title: string;
  sourceType: (typeof sourceTypes)[number];
  sourceUrl?: string;
  canonicalUrl?: string;
  rssFeedUrl?: string;
  dedupeKey?: string;
  category: string;
  sourceLabel?: string;
  thumbnailUrl?: string;
  coverImageUrl?: string;
  author?: string;
  description?: string;
  contentHtml?: string;
  topicTags?: string[];
  estimatedListeningSeconds?: number;
  pageCount?: number;
  /** Number of reading blocks; equals `blocks.length` unless blocks were omitted. */
  blockCount?: number;
  status: (typeof documentStatuses)[number];
  summary?: string;
  keyPoints?: string[];
  quizQuestions?: Array<{ question: string; answer: string }>;
  flashcards?: Array<{ front: string; back: string }>;
  createdAt: string;
  updatedAt: string;
  lastReadAt?: string;
  progress: {
    blockIndex: number;
    characterOffset: number;
    sentenceIndex: number;
    percent: number;
  };
  provider: (typeof providers)[number];
  voice: string;
  speed: number;
  blocks: Array<{
    id: string;
    orderIndex: number;
    blockType: (typeof blockTypes)[number];
    text: string;
    sourceSelector?: string;
    sourcePageNumber?: number;
  }>;
};

export type DocumentContextResponse = {
  documentId: string;
  title: string;
  sourceType: (typeof sourceTypes)[number];
  sourceLabel?: string;
  status: (typeof documentStatuses)[number];
  progressPercent: number;
  summaryAvailable: boolean;
  flashcardCount: number;
  quizCount: number;
  estimatedListeningSeconds?: number;
  supportedActions: Array<"readmate_prepare_listening" | "readmate_generate_study_pack">;
  deepLink: string;
};

export type DocumentRepository = {
  createDocument(userId: string, input: CreateDocumentInput): Promise<ReadingDocumentResponse>;
  listDocuments(userId: string, filters?: DocumentListFilters): Promise<ReadingDocumentResponse[]>;
  listLibraryDocuments?(userId: string, filters: DocumentLibraryPageFilters): Promise<DocumentLibraryPageResult>;
  searchDocuments?(userId: string, filters: DocumentSearchFilters): Promise<DocumentSearchItemResponse[]>;
  getDocument(userId: string, documentId: string): Promise<ReadingDocumentResponse | null>;
  getDocumentContext?(userId: string, documentId: string): Promise<DocumentContextResponse | null>;
  updateProgress(
    userId: string,
    documentId: string,
    progress: UpdateProgressInput
  ): Promise<ReadingDocumentResponse | null>;
  updateDocument(userId: string, documentId: string, input: UpdateDocumentInput): Promise<ReadingDocumentResponse | null>;
  clearDocumentHistory(userId: string, documentId: string): Promise<ReadingDocumentResponse | null>;
  clearHistory(userId: string): Promise<number>;
  deleteDocument(userId: string, documentId: string): Promise<boolean>;
  deleteCompletedDocuments(userId: string): Promise<number>;
};

type DocumentsRouterDeps = {
  repository?: DocumentRepository;
  getEntitlement?: (req: AuthedRequest, userId: string) => MaybePromise<ReadMateEntitlement>;
};

export function documentsRouter(deps: DocumentsRouterDeps = {}): Router {
  const router = createRouter();
  const repository = deps.repository ?? new PrismaDocumentRepository();
  const getEntitlement = deps.getEntitlement ?? entitlementForRequest;

  router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const parsedQuery = listDocumentsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      res.status(400).json({ error: "Invalid document query.", code: "INVALID_DOCUMENT_QUERY" });
      return;
    }
    const documents = await repository.listDocuments(getUserId(req), {
      query: parsedQuery.data.query ?? parsedQuery.data.q,
      sourceType: parsedQuery.data.sourceType,
      status: parsedQuery.data.status,
      limit: parsedQuery.data.limit,
      view: parsedQuery.data.view
    });
    res.json(documents);
  }));

  router.get("/search-context", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const parsedQuery = searchDocumentsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      res.status(400).json({ error: "Invalid document search query.", code: "INVALID_DOCUMENT_SEARCH_QUERY" });
      return;
    }
    if (!repository.searchDocuments) {
      res.status(503).json({ error: "Compact library search is unavailable.", code: "DOCUMENT_SEARCH_UNAVAILABLE" });
      return;
    }
    const results = await repository.searchDocuments(getUserId(req), {
      query: parsedQuery.data.query ?? parsedQuery.data.q,
      sourceType: parsedQuery.data.sourceType,
      status: parsedQuery.data.status,
      limit: parsedQuery.data.limit
    });
    const response: DocumentSearchResponse = { results, total: results.length };
    res.setHeader("Cache-Control", "no-store");
    res.json(response);
  }));

  router.get("/library-page", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const parsedQuery = libraryPageQuerySchema.safeParse(req.query);
    const cursor = parsedQuery.success && parsedQuery.data.cursor
      ? decodeDocumentLibraryCursor(parsedQuery.data.cursor)
      : undefined;
    if (!parsedQuery.success || (parsedQuery.data.cursor && !cursor)) {
      res.status(400).json({ error: "Invalid Library page query.", code: "INVALID_DOCUMENT_LIBRARY_QUERY" });
      return;
    }
    if (!repository.listLibraryDocuments) {
      res.status(503).json({ error: "Compact Library paging is unavailable.", code: "DOCUMENT_LIBRARY_UNAVAILABLE" });
      return;
    }
    const page = await repository.listLibraryDocuments(getUserId(req), {
      limit: parsedQuery.data.limit,
      cursor
    });
    const response: DocumentLibraryPageResponse = {
      items: page.items,
      nextCursor: page.nextCursor ? encodeDocumentLibraryCursor(page.nextCursor) : undefined
    };
    res.setHeader("Cache-Control", "no-store");
    res.json(response);
  }));

  router.delete("/completed", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const count = await repository.deleteCompletedDocuments(getUserId(req));
    res.json({ count });
  }));

  router.get("/:id/context", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const parsedParams = documentContextParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      res.status(400).json({ error: "Invalid document ID.", code: "INVALID_DOCUMENT_ID" });
      return;
    }
    const userId = getUserId(req);
    let context: DocumentContextResponse | null;
    if (repository.getDocumentContext) {
      context = await repository.getDocumentContext(userId, parsedParams.data.id);
    } else {
      const document = await repository.getDocument(userId, parsedParams.data.id);
      context = document ? toDocumentContext(document) : null;
    }
    if (!context) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    res.json(context);
  }));

  router.get("/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const document = await repository.getDocument(getUserId(req), String(req.params.id));
    if (!document) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    res.json(document);
  }));

  router.post("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const payload = createDocumentSchema.parse(req.body);
    const userId = getUserId(req);
    requireDocumentWithinPlan(await getEntitlement(req, userId), {
      pageCount: payload.pageCount,
      textCharacters: payload.blocks.reduce((total, block) => total + block.text.length, 0)
    });
    const document = await repository.createDocument(userId, payload);
    res.status(201).json(document);
  }));

  router.patch("/:id/progress", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const payload = updateProgressSchema.parse(req.body);
    const document = await repository.updateProgress(getUserId(req), String(req.params.id), payload);
    if (!document) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    // Progress is saved many times per listen; clients that already hold the
    // text can ask for the small response.
    res.json(req.query.view === "summary" ? summaryDocument(document) : document);
  }));

  router.patch("/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const payload = updateDocumentSchema.parse(req.body);
    const document = await repository.updateDocument(getUserId(req), String(req.params.id), payload);
    if (!document) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    res.json(document);
  }));

  router.delete("/history", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const count = await repository.clearHistory(getUserId(req));
    res.json({ count });
  }));

  router.delete("/:id/history", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const document = await repository.clearDocumentHistory(getUserId(req), String(req.params.id));
    if (!document) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    res.json(document);
  }));

  router.delete("/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const deleted = await repository.deleteDocument(getUserId(req), String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    res.status(204).end();
  }));

  return router;
}

export class PrismaDocumentRepository implements DocumentRepository {
  async createDocument(userId: string, input: CreateDocumentInput): Promise<ReadingDocumentResponse> {
    const prisma = await getPrisma();
    const duplicateFilters = duplicateDocumentFilters(input);
    if (duplicateFilters.length) {
      const existing = await prisma.readingDocument.findFirst({
        where: { userId, deletedAt: null, OR: duplicateFilters },
        include: documentInclude
      });
      if (existing) {
        const hasPlaceholderBlocks = existing.blocks.some((block) => /^Saved source:/i.test(block.text));
        if (!hasPlaceholderBlocks) return serializeDocument(existing);

        const category = categoryForDocument(input);
        const learningData = learningDataForDocument(input);
        const refreshed = await prisma.$transaction(async (tx) => {
          await tx.readingBlock.deleteMany({ where: { documentId: existing.id } });
          return tx.readingDocument.update({
            where: { id: existing.id },
            data: {
              title: input.title,
              sourceType: input.sourceType,
              sourceUrl: input.sourceUrl,
              canonicalUrl: input.canonicalUrl,
              rssFeedUrl: input.rssFeedUrl,
              dedupeKey: input.dedupeKey,
              category,
              sourceLabel: input.sourceLabel,
              thumbnailUrl: input.thumbnailUrl,
              coverImageUrl: input.coverImageUrl,
              author: input.author,
              description: input.description,
              contentHtml: input.contentHtml,
              topicTags: JSON.stringify(input.topicTags ?? inferTopicTags(input, category)),
              estimatedListeningSeconds: input.estimatedListeningSeconds,
              pageCount: input.pageCount,
              status: input.status ?? statusForProgress(input.progress.percent),
              summary: input.summary ?? learningData.summary,
              keyPoints: JSON.stringify(input.keyPoints ?? learningData.keyPoints),
              quizQuestions: JSON.stringify(input.quizQuestions ?? learningData.quizQuestions),
              flashcards: JSON.stringify(input.flashcards ?? learningData.flashcards),
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
            include: documentInclude
          });
        });
        return serializeDocument(refreshed);
      }
    }
    const document = await prisma.readingDocument.create({
      data: readingDocumentCreateData(userId, input),
      include: documentInclude
    });
    return serializeDocument(document);
  }

  async listDocuments(userId: string, filters: DocumentListFilters = {}): Promise<ReadingDocumentResponse[]> {
    const prisma = await getPrisma();
    const documents = await prisma.readingDocument.findMany({
      where: {
        userId,
        deletedAt: null,
        sourceType: filters.sourceType,
        status: filters.status,
        OR: filters.query
          ? [
              { title: { contains: filters.query, mode: "insensitive" } },
              { sourceLabel: { contains: filters.query, mode: "insensitive" } },
              { author: { contains: filters.query, mode: "insensitive" } },
              { description: { contains: filters.query, mode: "insensitive" } },
              { category: { contains: filters.query, mode: "insensitive" } },
              { topicTags: { contains: filters.query, mode: "insensitive" } }
            ]
          : undefined
      },
      orderBy: [{ lastReadAt: "desc" }, { updatedAt: "desc" }],
      take: filters.limit ?? 100,
      ...(filters.view === "summary"
        ? { include: { _count: { select: { blocks: true } } }, omit: { contentHtml: true } }
        : { include: documentInclude })
    });
    return documents.map(serializeDocument);
  }

  async listLibraryDocuments(userId: string, filters: DocumentLibraryPageFilters): Promise<DocumentLibraryPageResult> {
    const prisma = await getPrisma();
    const cursorDate = filters.cursor ? new Date(filters.cursor.updatedAt) : undefined;
    const documents = await prisma.readingDocument.findMany({
      where: {
        userId,
        deletedAt: null,
        OR: filters.cursor && cursorDate
          ? [
              { updatedAt: { lt: cursorDate } },
              { updatedAt: cursorDate, id: { lt: filters.cursor.id } }
            ]
          : undefined
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: filters.limit + 1,
      select: {
        id: true,
        title: true,
        sourceType: true,
        category: true,
        sourceLabel: true,
        author: true,
        status: true,
        percent: true,
        estimatedListeningSeconds: true,
        createdAt: true,
        updatedAt: true,
        lastReadAt: true
      }
    });
    const hasMore = documents.length > filters.limit;
    const visibleDocuments = documents.slice(0, filters.limit);
    const lastDocument = hasMore ? visibleDocuments.at(-1) : undefined;
    return {
      items: visibleDocuments.map((document) => toDocumentLibraryItem({
        ...document,
        sourceType: document.sourceType as ReadingDocumentResponse["sourceType"],
        status: document.status as ReadingDocumentResponse["status"]
      })),
      nextCursor: lastDocument
        ? { updatedAt: toIso(lastDocument.updatedAt), id: lastDocument.id }
        : undefined
    };
  }

  async searchDocuments(userId: string, filters: DocumentSearchFilters): Promise<DocumentSearchItemResponse[]> {
    const prisma = await getPrisma();
    const documents = await prisma.readingDocument.findMany({
      where: {
        userId,
        deletedAt: null,
        sourceType: filters.sourceType
          ? { in: documentSearchAliases(filters.sourceType) }
          : undefined,
        status: filters.status,
        OR: filters.query
          ? [
              { title: { contains: filters.query, mode: "insensitive" } },
              { sourceLabel: { contains: filters.query, mode: "insensitive" } },
              { author: { contains: filters.query, mode: "insensitive" } },
              { description: { contains: filters.query, mode: "insensitive" } },
              { category: { contains: filters.query, mode: "insensitive" } },
              { topicTags: { contains: filters.query, mode: "insensitive" } }
            ]
          : undefined
      },
      orderBy: [{ lastReadAt: "desc" }, { updatedAt: "desc" }],
      take: filters.limit,
      select: {
        id: true,
        title: true,
        sourceType: true,
        status: true,
        percent: true,
        updatedAt: true
      }
    });
    return documents.map((document) => toDocumentSearchItem({
      ...document,
      sourceType: document.sourceType as (typeof sourceTypes)[number],
      status: document.status as (typeof documentStatuses)[number]
    }));
  }

  async getDocument(userId: string, documentId: string): Promise<ReadingDocumentResponse | null> {
    const prisma = await getPrisma();
    const document = await prisma.readingDocument.findFirst({
      where: { id: documentId, userId, deletedAt: null },
      include: documentInclude
    });
    return document ? serializeDocument(document) : null;
  }

  async getDocumentContext(userId: string, documentId: string): Promise<DocumentContextResponse | null> {
    const prisma = await getPrisma();
    const document = await prisma.readingDocument.findFirst({
      where: { id: documentId, userId, deletedAt: null },
      select: {
        id: true,
        title: true,
        sourceType: true,
        sourceLabel: true,
        status: true,
        percent: true,
        summary: true,
        flashcards: true,
        quizQuestions: true,
        estimatedListeningSeconds: true
      }
    });
    if (!document) return null;
    return documentContextFromFields({
      documentId: document.id,
      title: document.title,
      sourceType: document.sourceType as ReadingDocumentResponse["sourceType"],
      sourceLabel: document.sourceLabel ?? undefined,
      status: document.status as ReadingDocumentResponse["status"],
      progressPercent: document.percent,
      summaryAvailable: Boolean(document.summary?.trim()),
      flashcardCount: parseJsonArray(document.flashcards)?.length ?? 0,
      quizCount: parseJsonArray(document.quizQuestions)?.length ?? 0,
      estimatedListeningSeconds: document.estimatedListeningSeconds ?? undefined
    });
  }

  async updateProgress(
    userId: string,
    documentId: string,
    input: UpdateProgressInput
  ): Promise<ReadingDocumentResponse | null> {
    const prisma = await getPrisma();
    const existing = await prisma.readingDocument.findFirst({ where: { id: documentId, userId, deletedAt: null }, select: { id: true } });
    if (!existing) return null;

    const document = await prisma.readingDocument.update({
      where: { id: documentId },
      data: {
        chunkIndex: input.progress.blockIndex,
        characterOffset: input.progress.characterOffset,
        sentenceIndex: input.progress.sentenceIndex,
        percent: input.progress.percent,
        status: statusForProgress(input.progress.percent),
        lastReadAt: new Date(),
        provider: input.provider,
        voice: input.voice,
        speed: input.speed
      },
      include: documentInclude
    });
    return serializeDocument(document);
  }

  async updateDocument(userId: string, documentId: string, input: UpdateDocumentInput): Promise<ReadingDocumentResponse | null> {
    const prisma = await getPrisma();
    const existing = await prisma.readingDocument.findFirst({ where: { id: documentId, userId, deletedAt: null }, select: { id: true } });
    if (!existing) return null;

    const document = await prisma.readingDocument.update({
      where: { id: documentId },
      data: {
        title: input.title,
        sourceUrl: input.sourceUrl,
        canonicalUrl: input.canonicalUrl,
        rssFeedUrl: input.rssFeedUrl,
        category: input.category,
        sourceLabel: input.sourceLabel,
        thumbnailUrl: input.thumbnailUrl,
        coverImageUrl: input.coverImageUrl,
        author: input.author,
        description: input.description,
        contentHtml: input.contentHtml,
        topicTags: input.topicTags ? JSON.stringify(input.topicTags) : undefined,
        pageCount: input.pageCount,
        status: input.status,
        summary: input.summary,
        keyPoints: input.keyPoints ? JSON.stringify(input.keyPoints) : undefined,
        quizQuestions: input.quizQuestions ? JSON.stringify(input.quizQuestions) : undefined,
        flashcards: input.flashcards ? JSON.stringify(input.flashcards) : undefined
      },
      include: documentInclude
    });
    return serializeDocument(document);
  }

  async clearDocumentHistory(userId: string, documentId: string): Promise<ReadingDocumentResponse | null> {
    const prisma = await getPrisma();
    const existing = await prisma.readingDocument.findFirst({ where: { id: documentId, userId, deletedAt: null }, select: { id: true } });
    if (!existing) return null;

    const document = await prisma.readingDocument.update({
      where: { id: documentId },
      data: {
        chunkIndex: 0,
        characterOffset: 0,
        sentenceIndex: 0,
        percent: 0,
        status: "unread",
        lastReadAt: null
      },
      include: documentInclude
    });
    return serializeDocument(document);
  }

  async clearHistory(userId: string): Promise<number> {
    const prisma = await getPrisma();
    const historyWhere = {
      userId,
      deletedAt: null,
      OR: [
        { lastReadAt: { not: null } },
        { percent: { gt: 0 } },
        { status: { in: ["in_progress", "completed"] } }
      ]
    };
    const result = await prisma.readingDocument.updateMany({
      where: historyWhere,
      data: {
        chunkIndex: 0,
        characterOffset: 0,
        sentenceIndex: 0,
        percent: 0,
        status: "unread",
        lastReadAt: null
      }
    });
    return result.count;
  }

  async deleteDocument(userId: string, documentId: string): Promise<boolean> {
    const prisma = await getPrisma();
    const existing = await prisma.readingDocument.findFirst({ where: { id: documentId, userId, deletedAt: null }, select: { id: true } });
    if (!existing) return false;
    const uploads = await prisma.uploadedFile.findMany({
      where: { userId, documentId },
      select: { storageKey: true }
    });
    await removeUploadObjects(uploads.map((upload) => upload.storageKey));
    await clearLearningDataForDocument(prisma, userId, documentId, { includeNotesAndHighlights: true });
    const [, result] = await prisma.$transaction([
      prisma.uploadedFile.deleteMany({ where: { userId, documentId } }),
      prisma.readingDocument.updateMany({
        where: { id: documentId, userId, deletedAt: null },
        data: { deletedAt: new Date(), lastReadAt: null }
      })
    ]);
    return result.count > 0;
  }

  async deleteCompletedDocuments(userId: string): Promise<number> {
    const prisma = await getPrisma();
    const documents = await prisma.readingDocument.findMany({
      where: {
        userId,
        deletedAt: null,
        OR: [{ status: "completed" }, { percent: { gte: 100 } }]
      },
      select: { id: true }
    });
    const documentIds = documents.map((document) => document.id);
    const uploads = documentIds.length
      ? await prisma.uploadedFile.findMany({
          where: { userId, documentId: { in: documentIds } },
          select: { storageKey: true }
        })
      : [];
    await removeUploadObjects(uploads.map((upload) => upload.storageKey));
    await clearLearningDataForDocuments(prisma, userId, documents.map((document) => document.id), { includeNotesAndHighlights: true });
    const [, result] = await prisma.$transaction([
      prisma.uploadedFile.deleteMany({ where: { userId, documentId: { in: documentIds } } }),
      prisma.readingDocument.updateMany({
        where: {
          userId,
          deletedAt: null,
          OR: [{ status: "completed" }, { percent: { gte: 100 } }]
        },
        data: { deletedAt: new Date(), lastReadAt: null }
      })
    ]);
    return result.count;
  }
}

/** Create payload shared by createDocument and the upload conversion transaction. */
export function readingDocumentCreateData(userId: string, input: CreateDocumentInput) {
  const category = categoryForDocument(input);
  const learningData = learningDataForDocument(input);
  return {
    userId,
    title: input.title,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
    canonicalUrl: input.canonicalUrl,
    rssFeedUrl: input.rssFeedUrl,
    dedupeKey: input.dedupeKey,
    category,
    sourceLabel: input.sourceLabel,
    thumbnailUrl: input.thumbnailUrl,
    coverImageUrl: input.coverImageUrl,
    author: input.author,
    description: input.description,
    contentHtml: input.contentHtml,
    topicTags: JSON.stringify(input.topicTags ?? inferTopicTags(input, category)),
    estimatedListeningSeconds: input.estimatedListeningSeconds,
    pageCount: input.pageCount,
    status: input.status ?? statusForProgress(input.progress.percent),
    summary: input.summary ?? learningData.summary,
    keyPoints: JSON.stringify(input.keyPoints ?? learningData.keyPoints),
    quizQuestions: JSON.stringify(input.quizQuestions ?? learningData.quizQuestions),
    flashcards: JSON.stringify(input.flashcards ?? learningData.flashcards),
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
  } satisfies Prisma.ReadingDocumentUncheckedCreateInput;
}

export { documentInclude, serializeDocument };

const documentInclude = {
  blocks: {
    orderBy: { orderIndex: "asc" as const }
  }
};

/** Drop reading blocks and stored HTML, reporting how many blocks exist. */
export function summaryDocument(document: ReadingDocumentResponse): ReadingDocumentResponse {
  return { ...document, contentHtml: undefined, blockCount: document.blockCount ?? document.blocks.length, blocks: [] };
}

async function getPrisma(): Promise<typeof PrismaSingleton> {
  const module = await import("../prisma.js");
  return module.prisma;
}

async function removeUploadObjects(storageKeys: string[]): Promise<void> {
  const uniqueKeys = [...new Set(storageKeys.filter(Boolean))];
  if (uniqueKeys.length === 0) return;
  const { getSupabaseAdminClient, getUploadBucket } = await import("../storage.js");
  const storage = getSupabaseAdminClient().storage.from(getUploadBucket());
  for (let index = 0; index < uniqueKeys.length; index += 100) {
    const { error } = await storage.remove(uniqueKeys.slice(index, index + 100));
    if (error) throw new Error(`Unable to delete uploaded files: ${error.message}`);
  }
}

function serializeDocument(document: any): ReadingDocumentResponse {
  return {
    id: document.id,
    userId: document.userId,
    title: document.title,
    sourceType: document.sourceType,
    sourceUrl: document.sourceUrl ?? undefined,
    canonicalUrl: document.canonicalUrl ?? undefined,
    rssFeedUrl: document.rssFeedUrl ?? undefined,
    dedupeKey: document.dedupeKey ?? undefined,
    category: document.category ?? "Uncategorized",
    sourceLabel: document.sourceLabel ?? undefined,
    thumbnailUrl: document.thumbnailUrl ?? undefined,
    coverImageUrl: document.coverImageUrl ?? undefined,
    author: document.author ?? undefined,
    description: document.description ?? undefined,
    contentHtml: document.contentHtml ?? undefined,
    topicTags: parseTopicTags(document.topicTags),
    estimatedListeningSeconds: document.estimatedListeningSeconds ?? undefined,
    pageCount: document.pageCount ?? undefined,
    status: document.status ?? statusForProgress(document.percent ?? 0),
    summary: document.summary ?? undefined,
    keyPoints: parseJsonArray(document.keyPoints),
    quizQuestions: parseJsonArray(document.quizQuestions),
    flashcards: parseJsonArray(document.flashcards),
    createdAt: toIso(document.createdAt),
    updatedAt: toIso(document.updatedAt),
    lastReadAt: document.lastReadAt ? toIso(document.lastReadAt) : undefined,
    progress: {
      blockIndex: document.chunkIndex ?? 0,
      characterOffset: document.characterOffset ?? 0,
      sentenceIndex: document.sentenceIndex ?? 0,
      percent: document.percent ?? 0
    },
    provider: "google",
    voice: normalizeGoogleTtsVoice(document.voice),
    speed: document.speed,
    blockCount: document._count?.blocks ?? document.blocks?.length ?? 0,
    blocks: (document.blocks ?? []).map((block: any) => ({
      id: block.id,
      orderIndex: block.orderIndex,
      blockType: block.blockType,
      text: block.text,
      sourceSelector: block.sourceSelector ?? undefined,
      sourcePageNumber: block.sourcePageNumber ?? undefined
    }))
  };
}

function documentSearchAliases(
  sourceType: NonNullable<DocumentSearchFilters["sourceType"]>
): Array<(typeof sourceTypes)[number]> {
  if (sourceType === "webpage") return ["webpage", "selection", "url"];
  if (sourceType === "rss") return ["rss", "news"];
  if (sourceType === "document") return ["document", "ocr"];
  return ["pdf"];
}

function toDocumentSearchItem(document: {
  id: string;
  title: string;
  sourceType: (typeof sourceTypes)[number];
  status: (typeof documentStatuses)[number];
  percent: number;
  updatedAt: Date | string;
}): DocumentSearchItemResponse {
  return {
    documentId: document.id,
    title: document.title,
    sourceType: normalizeDocumentSearchSourceType(document.sourceType),
    status: document.status,
    progressPercent: clampProgressPercent(document.percent),
    updatedAt: toIso(document.updatedAt),
    deepLink: `/document/${encodeURIComponent(document.id)}`
  };
}

function toDocumentLibraryItem(document: {
  id: string;
  title: string;
  sourceType: ReadingDocumentResponse["sourceType"];
  category: string | null;
  sourceLabel: string | null;
  author: string | null;
  status: ReadingDocumentResponse["status"];
  percent: number;
  estimatedListeningSeconds: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  lastReadAt: Date | string | null;
}): DocumentLibraryItemResponse {
  return {
    documentId: document.id,
    title: document.title,
    sourceType: document.sourceType,
    category: document.category ?? "Uncategorized",
    sourceLabel: document.sourceLabel ?? undefined,
    author: document.author ?? undefined,
    status: document.status,
    progressPercent: clampProgressPercent(document.percent),
    estimatedListeningSeconds: document.estimatedListeningSeconds ?? undefined,
    createdAt: toIso(document.createdAt),
    updatedAt: toIso(document.updatedAt),
    lastReadAt: document.lastReadAt ? toIso(document.lastReadAt) : undefined
  };
}

function encodeDocumentLibraryCursor(cursor: DocumentLibraryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeDocumentLibraryCursor(value: string): DocumentLibraryCursor | undefined {
  try {
    const decoded = libraryCursorSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (!decoded.success || encodeDocumentLibraryCursor(decoded.data) !== value) return undefined;
    return decoded.data;
  } catch {
    return undefined;
  }
}

function normalizeDocumentSearchSourceType(
  sourceType: (typeof sourceTypes)[number]
): DocumentSearchItemResponse["sourceType"] {
  if (sourceType === "rss" || sourceType === "news") return "rss";
  if (sourceType === "document" || sourceType === "ocr") return "document";
  if (sourceType === "pdf") return "pdf";
  return "webpage";
}

export function toDocumentContext(document: ReadingDocumentResponse): DocumentContextResponse {
  return documentContextFromFields({
    documentId: document.id,
    title: document.title,
    sourceType: document.sourceType,
    sourceLabel: document.sourceLabel,
    status: document.status,
    progressPercent: clampProgressPercent(document.progress.percent),
    summaryAvailable: Boolean(document.summary?.trim()),
    flashcardCount: document.flashcards?.length ?? 0,
    quizCount: document.quizQuestions?.length ?? 0,
    estimatedListeningSeconds: document.estimatedListeningSeconds
  });
}

function documentContextFromFields(
  fields: Omit<DocumentContextResponse, "supportedActions" | "deepLink">
): DocumentContextResponse {
  return {
    ...fields,
    progressPercent: clampProgressPercent(fields.progressPercent),
    supportedActions: ["readmate_prepare_listening", "readmate_generate_study_pack"],
    deepLink: `/document/${encodeURIComponent(fields.documentId)}`
  };
}

function clampProgressPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

function statusForProgress(percent: number): (typeof documentStatuses)[number] {
  if (percent >= 100) return "completed";
  if (percent > 0) return "in_progress";
  return "unread";
}

function duplicateDocumentFilters(input: CreateDocumentInput): Array<{ canonicalUrl?: string; sourceUrl?: string; dedupeKey?: string }> {
  const filters: Array<{ canonicalUrl?: string; sourceUrl?: string; dedupeKey?: string }> = [];
  if (input.dedupeKey) filters.push({ dedupeKey: input.dedupeKey });
  if (input.canonicalUrl) filters.push({ canonicalUrl: input.canonicalUrl });
  if (input.sourceUrl) filters.push({ sourceUrl: input.sourceUrl });
  if (input.sourceUrl && input.sourceUrl !== input.canonicalUrl) filters.push({ canonicalUrl: input.sourceUrl });
  if (input.canonicalUrl && input.canonicalUrl !== input.sourceUrl) filters.push({ sourceUrl: input.canonicalUrl });
  return filters;
}

function parseTopicTags(value: unknown): string[] | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : undefined;
  } catch {
    return undefined;
  }
}

function parseJsonArray(value: unknown): any[] | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function learningDataForDocument(input: CreateDocumentInput): {
  summary: string;
  keyPoints: string[];
  quizQuestions: Array<{ question: string; answer: string }>;
  flashcards: Array<{ front: string; back: string }>;
} {
  const text = [input.title, input.description, ...input.blocks.map((block) => block.text)]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 25);
  const summary = sentences.slice(0, 2).join(" ").slice(0, 900) || input.description || input.title;
  const keyPoints = uniqueStrings(sentences.filter((sentence) => sentence !== input.title).slice(0, 4)).map((sentence) => sentence.slice(0, 500));
  const points = keyPoints.length ? keyPoints : [summary];
  const quizQuestions = points.slice(0, 3).map((point, index) => ({
    question: index === 0 ? `What is the main idea of "${input.title}"?` : `What is one key point from "${input.title}"?`,
    answer: point
  }));
  const flashcards = points.slice(0, 4).map((point, index) => ({
    front: index === 0 ? input.title : `Key point ${index + 1}`,
    back: point
  }));
  return { summary, keyPoints: points.slice(0, 4), quizQuestions, flashcards };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function inferTopicTags(input: CreateDocumentInput, category: string): string[] {
  const tags = new Set<string>();
  if (category && category !== "Uncategorized") tags.add(category);
  const text = [input.title, input.sourceLabel, input.description, ...input.blocks.slice(0, 3).map((block) => block.text)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/\b(ai|software|startup|apple|google|microsoft|cyber|gadget|technology|tech)\b/.test(text)) tags.add("Technology");
  if (/\b(election|president|minister|government|policy|campaign|court|law|politics)\b/.test(text)) tags.add("Politics");
  if (/\b(market|stock|bank|finance|economy|business|revenue|profit|investor)\b/.test(text)) tags.add("Business");
  if (/\b(health|medical|doctor|hospital|fitness|disease|wellness|vaccine)\b/.test(text)) tags.add("Health");
  if (/\b(sport|football|soccer|nba|nfl|tennis|golf|boxing|rugby)\b/.test(text)) tags.add("Sports");
  if (/\b(movie|music|celebrity|entertainment|film|tv|streaming)\b/.test(text)) tags.add("Entertainment");
  return [...tags].slice(0, 8);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function categoryForDocument(input: CreateDocumentInput): string {
  const broadCategories = new Set(["Uncategorized", "Saved", "Websites", "Feeds", "News"]);
  const isArticleLike =
    input.sourceType === "webpage" ||
    input.sourceType === "news" ||
    (input.sourceType === "rss" && !input.blocks.some((block) => /^Saved source:/i.test(block.text)));
  if (!isArticleLike || (input.category && !broadCategories.has(input.category))) return input.category;

  const text = [input.title, input.sourceLabel, input.description, ...input.blocks.slice(0, 4).map((block) => block.text)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/\b(ai|artificial intelligence|software|startup|apple|google|microsoft|tesla|chip|cyber|gadget|technology|tech)\b/.test(text)) return "Technology";
  if (/\b(election|president|parliament|minister|government|policy|campaign|senate|court|law|politics)\b/.test(text)) return "Politics";
  if (/\b(market|stock|bank|finance|economy|business|revenue|profit|investor|trade|inflation)\b/.test(text)) return "Business";
  if (/\b(health|medical|doctor|hospital|fitness|disease|wellness|vaccine|nutrition)\b/.test(text)) return "Health";
  if (/\b(sport|football|soccer|nba|nfl|tennis|golf|boxing|rugby|athlete|match)\b/.test(text)) return "Sports";
  if (/\b(movie|music|celebrity|entertainment|film|tv|streaming|culture)\b/.test(text)) return "Entertainment";
  return input.category === "Websites" ? "News" : input.category;
}
