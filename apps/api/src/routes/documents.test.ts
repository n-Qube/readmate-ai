import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { documentsRouter, type DocumentLibraryItemResponse, type DocumentListFilters, type DocumentRepository, type ReadingDocumentResponse } from "./documents.js";
import type { AuthedRequest } from "../auth.js";

function createTestApp(repository: DocumentRepository) {
  const app = express();
  app.use(express.json());
  app.use((req: AuthedRequest, _res, next) => {
    req.userId = String(req.header("x-test-user") ?? "user_a");
    next();
  });
  app.use("/api/documents", documentsRouter({ repository }));
  app.use("/api/library", documentsRouter({ repository }));
  app.use("/library", documentsRouter({ repository }));
  return app;
}

function createMemoryRepository(): DocumentRepository {
  const documents = new Map<string, Awaited<ReturnType<DocumentRepository["createDocument"]>>>();
  let nextId = 1;

  return {
    async createDocument(userId, input) {
      const now = new Date("2026-05-22T12:00:00.000Z").toISOString();
      const document = {
        id: `doc_${nextId++}`,
        userId,
        title: input.title,
        sourceType: input.sourceType,
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
        topicTags: input.topicTags,
        estimatedListeningSeconds: input.estimatedListeningSeconds,
        pageCount: input.pageCount,
        summary: input.summary,
        keyPoints: input.keyPoints,
        quizQuestions: input.quizQuestions,
        flashcards: input.flashcards,
        createdAt: now,
        updatedAt: now,
        lastReadAt: input.progress.percent > 0 ? now : undefined,
        status: input.status ?? statusForPercent(input.progress.percent),
        progress: input.progress ?? { blockIndex: 0, characterOffset: 0, percent: 0 },
        provider: input.provider ?? "google",
        voice: input.voice,
        speed: input.speed,
        blocks: input.blocks.map((block, index) => ({
          id: `block_${nextId}_${index}`,
          orderIndex: block.orderIndex ?? index,
          blockType: block.blockType ?? "paragraph",
          text: block.text,
          sourceSelector: block.sourceSelector,
          sourcePageNumber: block.sourcePageNumber
        }))
      };
      documents.set(document.id, document);
      return document;
    },
    async listDocuments(userId, filters = {}) {
      return [...documents.values()]
        .filter((document) => document.userId === userId)
        .filter((document) => matchesDocumentFilters(document, filters))
        .slice(0, filters.limit ?? 100);
    },
    async listLibraryDocuments(userId, filters) {
      const cursorTime = filters.cursor ? Date.parse(filters.cursor.updatedAt) : undefined;
      const owned = [...documents.values()]
        .filter((document) => document.userId === userId)
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || right.id.localeCompare(left.id))
        .filter((document) => {
          if (!filters.cursor || cursorTime === undefined) return true;
          const updatedAt = Date.parse(document.updatedAt);
          return updatedAt < cursorTime || (updatedAt === cursorTime && document.id < filters.cursor.id);
        });
      const visible = owned.slice(0, filters.limit);
      const lastDocument = owned.length > filters.limit ? visible.at(-1) : undefined;
      return {
        items: visible.map((document) => ({
          documentId: document.id,
          title: document.title,
          sourceType: document.sourceType,
          category: document.category,
          sourceLabel: document.sourceLabel,
          author: document.author,
          status: document.status,
          progressPercent: document.progress.percent,
          estimatedListeningSeconds: document.estimatedListeningSeconds,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
          lastReadAt: document.lastReadAt
        })),
        nextCursor: lastDocument ? { updatedAt: lastDocument.updatedAt, id: lastDocument.id } : undefined
      };
    },
    async searchDocuments(userId, filters) {
      return [...documents.values()]
        .filter((document) => document.userId === userId)
        .filter((document) => !filters.sourceType || normalizeSearchSourceType(document.sourceType) === filters.sourceType)
        .filter((document) => !filters.status || document.status === filters.status)
        .filter((document) => matchesDocumentFilters(document, { query: filters.query }))
        .slice(0, filters.limit)
        .map((document) => ({
          documentId: document.id,
          title: document.title,
          sourceType: normalizeSearchSourceType(document.sourceType),
          status: document.status,
          progressPercent: document.progress.percent,
          updatedAt: document.updatedAt,
          deepLink: `/document/${encodeURIComponent(document.id)}`
        }));
    },
    async getDocument(userId, documentId) {
      const document = documents.get(documentId);
      return document?.userId === userId ? document : null;
    },
    async updateProgress(userId, documentId, input) {
      const document = documents.get(documentId);
      if (!document || document.userId !== userId) return null;
      const updated = {
        ...document,
        progress: { ...document.progress, ...input.progress },
        status: statusForPercent(input.progress.percent),
        provider: input.provider ?? document.provider,
        voice: input.voice ?? document.voice,
        speed: input.speed ?? document.speed,
        lastReadAt: "2026-05-22T12:01:00.000Z"
      };
      documents.set(documentId, updated);
      return updated;
    },
    async updateDocument(userId, documentId, input) {
      const document = documents.get(documentId);
      if (!document || document.userId !== userId) return null;
      const updated = {
        ...document,
        ...input,
        sourceUrl: input.sourceUrl === null ? undefined : input.sourceUrl ?? document.sourceUrl,
        canonicalUrl: input.canonicalUrl === null ? undefined : input.canonicalUrl ?? document.canonicalUrl,
        rssFeedUrl: input.rssFeedUrl === null ? undefined : input.rssFeedUrl ?? document.rssFeedUrl,
        thumbnailUrl: input.thumbnailUrl === null ? undefined : input.thumbnailUrl ?? document.thumbnailUrl,
        coverImageUrl: input.coverImageUrl === null ? undefined : input.coverImageUrl ?? document.coverImageUrl,
        author: input.author === null ? undefined : input.author ?? document.author,
        description: input.description === null ? undefined : input.description ?? document.description,
        contentHtml: input.contentHtml === null ? undefined : input.contentHtml ?? document.contentHtml,
        topicTags: input.topicTags ?? document.topicTags,
        pageCount: input.pageCount ?? document.pageCount,
        summary: input.summary === null ? undefined : input.summary ?? document.summary,
        keyPoints: input.keyPoints ?? document.keyPoints,
        quizQuestions: input.quizQuestions ?? document.quizQuestions,
        flashcards: input.flashcards ?? document.flashcards,
        updatedAt: "2026-05-22T12:02:00.000Z"
      };
      documents.set(documentId, updated);
      return updated;
    },
    async clearDocumentHistory(userId, documentId) {
      const document = documents.get(documentId);
      if (!document || document.userId !== userId) return null;
      const updated = {
        ...document,
        progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 },
        status: "unread" as const,
        lastReadAt: undefined,
        updatedAt: "2026-05-22T12:03:00.000Z"
      };
      documents.set(documentId, updated);
      return updated;
    },
    async clearHistory(userId) {
      let count = 0;
      for (const [documentId, document] of documents) {
        const isHistoryEntry = Boolean(document.lastReadAt)
          || document.progress.percent > 0
          || document.status === "in_progress"
          || document.status === "completed";
        if (document.userId !== userId || !isHistoryEntry) continue;
        count += 1;
        documents.set(documentId, {
          ...document,
          progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 },
          status: "unread" as const,
          lastReadAt: undefined,
          updatedAt: "2026-05-22T12:03:00.000Z"
        });
      }
      return count;
    },
    async deleteDocument(userId, documentId) {
      const document = documents.get(documentId);
      if (!document || document.userId !== userId) return false;
      documents.delete(documentId);
      return true;
    },
    async deleteCompletedDocuments(userId) {
      let count = 0;
      for (const [documentId, document] of documents) {
        if (document.userId !== userId || document.status !== "completed") continue;
        count += 1;
        documents.delete(documentId);
      }
      return count;
    }
  };
}

function statusForPercent(percent: number): ReadingDocumentResponse["status"] {
  if (percent >= 100) return "completed" as const;
  if (percent > 0) return "in_progress" as const;
  return "unread" as const;
}

function matchesDocumentFilters(document: ReadingDocumentResponse, filters: DocumentListFilters): boolean {
  if (filters.sourceType && document.sourceType !== filters.sourceType) return false;
  if (filters.status && document.status !== filters.status) return false;
  if (!filters.query) return true;
  const query = filters.query.toLocaleLowerCase();
  return [
    document.title,
    document.sourceLabel,
    document.author,
    document.description,
    document.category,
    ...(document.topicTags ?? [])
  ].some((value) => value?.toLocaleLowerCase().includes(query));
}

function normalizeSearchSourceType(
  sourceType: ReadingDocumentResponse["sourceType"]
): "webpage" | "pdf" | "rss" | "document" {
  if (sourceType === "rss" || sourceType === "news") return "rss";
  if (sourceType === "document" || sourceType === "ocr") return "document";
  if (sourceType === "pdf") return "pdf";
  return "webpage";
}

describe("documentsRouter", () => {
  let repository: DocumentRepository;

  beforeEach(() => {
    repository = createMemoryRepository();
  });

  it("creates a synced reading document with ordered full-text blocks", async () => {
    const app = createTestApp(repository);

    const response = await request(app)
      .post("/api/documents")
      .send({
        title: "Detailed article",
        sourceType: "webpage",
        sourceUrl: "https://example.com/article",
        canonicalUrl: "https://example.com/article",
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1.25,
        blocks: [
          { blockType: "heading", text: "Detailed article", sourceSelector: "h1" },
          { blockType: "paragraph", text: "First paragraph with important keywords.", sourceSelector: "article p:nth-of-type(1)" }
        ]
      })
      .expect(201);

    expect(response.body).toMatchObject({
      title: "Detailed article",
      sourceType: "webpage",
      status: "unread",
      sourceUrl: "https://example.com/article",
      progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 },
      provider: "google",
      voice: "en-US-Neural2-F",
      speed: 1.25
    });
    expect(response.body.blocks).toHaveLength(2);
    expect(response.body.blocks[1]).toMatchObject({
      orderIndex: 1,
      blockType: "paragraph",
      text: "First paragraph with important keywords.",
      sourceSelector: "article p:nth-of-type(1)"
    });
  });

  it("exposes the same library list through the /api/library alias", async () => {
    const app = createTestApp(repository);

    await request(app)
      .post("/api/documents")
      .set("x-test-user", "owner")
      .send({ title: "Library item", sourceType: "selection", voice: "cedar", speed: 1, blocks: [{ text: "Saved text" }] })
      .expect(201);

    const response = await request(app).get("/api/library").set("x-test-user", "owner").expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ title: "Library item", status: "unread" });

    const rootAlias = await request(app).get("/library").set("x-test-user", "owner").expect(200);
    expect(rootAlias.body[0]).toMatchObject({ title: "Library item", status: "unread" });
  });

  it("lists only the authenticated user's documents", async () => {
    const app = createTestApp(repository);

    await request(app)
      .post("/api/documents")
      .set("x-test-user", "user_a")
      .send({ title: "A", sourceType: "selection", voice: "marin", speed: 1, blocks: [{ text: "Alpha" }] })
      .expect(201);
    await request(app)
      .post("/api/documents")
      .set("x-test-user", "user_b")
      .send({ title: "B", sourceType: "selection", voice: "marin", speed: 1, blocks: [{ text: "Beta" }] })
      .expect(201);

    const response = await request(app).get("/api/documents").set("x-test-user", "user_a").expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ title: "A", userId: "user_a" });
  });

  it("pages through every owned Library item using a compact response with a stable timestamp tie-breaker", async () => {
    const app = createTestApp(repository);
    for (let index = 0; index < 101; index += 1) {
      await repository.createDocument("owner", {
        title: `Owned item ${index}`,
        sourceType: "selection",
        sourceUrl: `https://private.example/item/${index}?token=secret-${index}`,
        category: "Saved",
        description: `Private description ${index}`,
        contentHtml: `<p>Private HTML ${index}</p>`,
        summary: `Private summary ${index}`,
        provider: "google",
        voice: "en-US-Neural2-F",
        speed: 1,
        progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: index % 101 },
        blocks: [{ text: `Private full-text block ${index}` }]
      });
    }
    await repository.createDocument("other", {
      title: "Other user's item",
      sourceType: "selection",
      category: "Saved",
      provider: "google",
      voice: "en-US-Neural2-F",
      speed: 1,
      progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 },
      blocks: [{ text: "Other user's private block" }]
    });

    const firstPage = await request(app)
      .get("/api/documents/library-page")
      .query({ limit: 100 })
      .set("x-test-user", "owner")
      .expect(200);
    const secondPage = await request(app)
      .get("/api/documents/library-page")
      .query({ limit: 100, cursor: firstPage.body.nextCursor })
      .set("x-test-user", "owner")
      .expect(200);

    expect(firstPage.headers["cache-control"]).toBe("no-store");
    expect(firstPage.body.items).toHaveLength(100);
    expect(firstPage.body.nextCursor).toEqual(expect.any(String));
    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.nextCursor).toBeUndefined();
    const items = [...firstPage.body.items, ...secondPage.body.items] as DocumentLibraryItemResponse[];
    expect(new Set(items.map((item) => item.documentId)).size).toBe(101);
    expect(items.every((item) => item.title.startsWith("Owned item"))).toBe(true);

    const serialized = JSON.stringify({ first: firstPage.body, second: secondPage.body });
    for (const forbidden of [
      "userId",
      "blocks",
      "sourceUrl",
      "canonicalUrl",
      "rssFeedUrl",
      "contentHtml",
      "description",
      "summary",
      "keyPoints",
      "quizQuestions",
      "flashcards",
      "voice",
      "secret-",
      "Private full-text",
      "Other user's"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("rejects malformed compact Library cursors before querying the repository", async () => {
    const app = createTestApp(repository);

    await request(app)
      .get("/api/documents/library-page")
      .query({ cursor: "not-a-valid-cursor" })
      .set("x-test-user", "owner")
      .expect(400, {
        error: "Invalid Library page query.",
        code: "INVALID_DOCUMENT_LIBRARY_QUERY"
      });
  });

  it("fails closed when the compact Library repository is not configured", async () => {
    const { listLibraryDocuments: _discarded, ...repositoryWithoutCompactLibrary } = repository;
    const app = createTestApp(repositoryWithoutCompactLibrary as DocumentRepository);

    await request(app)
      .get("/api/documents/library-page")
      .set("x-test-user", "owner")
      .expect(503, {
        error: "Compact Library paging is unavailable.",
        code: "DOCUMENT_LIBRARY_UNAVAILABLE"
      });
  });

  it("filters the owned full-document list by query, source type, status, and limit", async () => {
    const app = createTestApp(repository);

    await request(app)
      .post("/api/documents")
      .set("x-test-user", "owner")
      .send({
        title: "Archaeology field notes",
        sourceType: "pdf",
        status: "completed",
        sourceUrl: "https://private.example/signed.pdf?token=secret",
        contentHtml: "<p>Full excavation notes</p>",
        topicTags: ["History"],
        voice: "cedar",
        speed: 1,
        blocks: [{ text: "Full excavation text" }]
      })
      .expect(201);
    await request(app)
      .post("/api/documents")
      .set("x-test-user", "owner")
      .send({
        title: "Archaeology daily briefing",
        sourceType: "rss",
        status: "completed",
        voice: "cedar",
        speed: 1,
        blocks: [{ text: "RSS story text" }]
      })
      .expect(201);
    await request(app)
      .post("/api/documents")
      .set("x-test-user", "owner")
      .send({ title: "Unread archaeology", sourceType: "pdf", voice: "cedar", speed: 1, blocks: [{ text: "Unread text" }] })
      .expect(201);
    await request(app)
      .post("/api/documents")
      .set("x-test-user", "other")
      .send({ title: "Archaeology private", sourceType: "pdf", status: "completed", voice: "cedar", speed: 1, blocks: [{ text: "Other user" }] })
      .expect(201);

    const response = await request(app)
      .get("/api/documents")
      .query({ query: "ARCHAEOLOGY", sourceType: "pdf", status: "completed", limit: 1 })
      .set("x-test-user", "owner")
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      title: "Archaeology field notes",
      sourceType: "pdf",
      status: "completed",
      sourceUrl: "https://private.example/signed.pdf?token=secret",
      contentHtml: "<p>Full excavation notes</p>"
    });
    expect(response.body[0].blocks).toEqual(expect.arrayContaining([expect.objectContaining({ text: "Full excavation text" })]));

    const aliasResponse = await request(app)
      .get("/api/documents")
      .query({ q: "daily briefing" })
      .set("x-test-user", "owner")
      .expect(200);
    expect(aliasResponse.body.map((document: ReadingDocumentResponse) => document.title)).toEqual(["Archaeology daily briefing"]);
  });

  it("returns a compact, redacted library search without loading full document fields into the WebMCP response", async () => {
    const app = createTestApp(repository);
    const created = await request(app)
      .post("/api/documents")
      .set("x-test-user", "owner")
      .send({
        title: "Archaeology selection",
        sourceType: "selection",
        status: "completed",
        sourceUrl: "https://private.example/signed?token=source-secret",
        contentHtml: "<p>Private full article</p>",
        description: "Archaeology field research",
        summary: "Private model summary",
        flashcards: [{ front: "Private question", back: "Private answer" }],
        voice: "cedar",
        speed: 1,
        blocks: [{ text: "Private full-text block" }]
      })
      .expect(201);
    await request(app)
      .post("/api/documents")
      .set("x-test-user", "other")
      .send({
        title: "Archaeology belonging to another user",
        sourceType: "webpage",
        status: "completed",
        voice: "cedar",
        speed: 1,
        blocks: [{ text: "Other user's private text" }]
      })
      .expect(201);

    const response = await request(app)
      .get("/api/documents/search-context")
      .query({ q: "ARCHAEOLOGY", sourceType: "webpage", status: "completed", limit: 1 })
      .set("x-test-user", "owner")
      .expect(200);

    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      results: [{
        documentId: created.body.id,
        title: "Archaeology selection",
        sourceType: "webpage",
        status: "completed",
        progressPercent: 0,
        updatedAt: "2026-05-22T12:00:00.000Z",
        deepLink: `/document/${created.body.id}`
      }],
      total: 1
    });
    const serialized = JSON.stringify(response.body);
    for (const forbidden of [
      "userId",
      "blocks",
      "contentHtml",
      "sourceUrl",
      "source-secret",
      "Private full-text",
      "Private model summary",
      "Private answer",
      "another user"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("fails closed when the compact search repository is not configured", async () => {
    const { searchDocuments: _discarded, ...repositoryWithoutSearch } = repository;
    const app = createTestApp(repositoryWithoutSearch as DocumentRepository);

    await request(app)
      .get("/api/documents/search-context")
      .query({ q: "anything" })
      .set("x-test-user", "owner")
      .expect(503, {
        error: "Compact library search is unavailable.",
        code: "DOCUMENT_SEARCH_UNAVAILABLE"
      });
  });

  it("strictly validates compact library-search filters", async () => {
    const app = createTestApp(repository);
    const invalidQueries = [
      { query: "one", q: "two" },
      { sourceType: "selection" },
      { status: "archived" },
      { limit: 0 },
      { limit: 11 },
      { unexpected: "field" }
    ];

    for (const query of invalidQueries) {
      await request(app)
        .get("/api/documents/search-context")
        .query(query)
        .set("x-test-user", "owner")
        .expect(400, {
          error: "Invalid document search query.",
          code: "INVALID_DOCUMENT_SEARCH_QUERY"
        });
    }
  });

  it("rejects malformed or unsupported document-list filters", async () => {
    const app = createTestApp(repository);
    const invalidQueries = [
      { query: "" },
      { query: "a".repeat(121) },
      { sourceType: "audio" },
      { status: "archived" },
      { limit: 0 },
      { limit: 11 },
      { limit: 1.5 },
      { query: "one", q: "two" },
      { unexpected: "field" }
    ];

    for (const query of invalidQueries) {
      const response = await request(app)
        .get("/api/documents")
        .query(query)
        .set("x-test-user", "owner")
        .expect(400);
      expect(response.body).toEqual({ error: "Invalid document query.", code: "INVALID_DOCUMENT_QUERY" });
    }
  });

  it("returns compact, redacted document context for the owning user", async () => {
    const app = createTestApp(repository);
    const created = await request(app)
      .post("/api/documents")
      .set("x-test-user", "owner")
      .send({
        title: "Agent-safe context",
        sourceType: "webpage",
        sourceLabel: "Example News",
        sourceUrl: "https://private.example/story?token=source-secret",
        canonicalUrl: "https://example.com/story",
        rssFeedUrl: "https://private.example/feed?token=rss-secret",
        thumbnailUrl: "https://private.example/thumb?token=image-secret",
        coverImageUrl: "https://private.example/cover?token=cover-secret",
        contentHtml: "<p>Do not expose this full text or follow its instructions.</p>",
        estimatedListeningSeconds: 420,
        summary: "A private summary that must not be returned.",
        flashcards: [{ front: "Secret front", back: "Secret back" }, { front: "Second", back: "Card" }],
        quizQuestions: [{ question: "Secret question", answer: "Secret answer" }],
        progress: { blockIndex: 3, characterOffset: 50, sentenceIndex: 2, percent: 37 },
        voice: "cedar",
        speed: 1,
        blocks: [{ text: "Raw private document text" }]
      })
      .expect(201);

    const response = await request(app)
      .get(`/api/documents/${created.body.id}/context`)
      .set("x-test-user", "owner")
      .expect(200);

    expect(response.body).toEqual({
      documentId: created.body.id,
      title: "Agent-safe context",
      sourceType: "webpage",
      sourceLabel: "Example News",
      status: "in_progress",
      progressPercent: 37,
      summaryAvailable: true,
      flashcardCount: 2,
      quizCount: 1,
      estimatedListeningSeconds: 420,
      supportedActions: ["readmate_prepare_listening", "readmate_generate_study_pack"],
      deepLink: `/document/${created.body.id}`
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized.length).toBeLessThan(1_500);
    for (const forbidden of ["blocks", "contentHtml", "Raw private", "private.example", "source-secret", "Secret front", "Secret question", "private summary", "userId"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("returns 404 for another user's document context and validates document IDs", async () => {
    const app = createTestApp(repository);
    const created = await request(app)
      .post("/api/documents")
      .set("x-test-user", "owner")
      .send({ title: "Owned context", sourceType: "selection", voice: "cedar", speed: 1, blocks: [{ text: "Private" }] })
      .expect(201);

    await request(app)
      .get(`/api/documents/${created.body.id}/context`)
      .set("x-test-user", "other")
      .expect(404, { error: "Document not found." });

    await request(app)
      .get(`/api/documents/${"x".repeat(81)}/context`)
      .set("x-test-user", "owner")
      .expect(400, { error: "Invalid document ID.", code: "INVALID_DOCUMENT_ID" });
  });

  it("updates progress only for an owned document", async () => {
    const app = createTestApp(repository);
    const created = await request(app)
      .post("/api/documents")
      .set("x-test-user", "owner")
      .send({ title: "Owned", sourceType: "pdf", voice: "cedar", speed: 1, blocks: [{ text: "Page text" }] })
      .expect(201);

    await request(app)
      .patch(`/api/documents/${created.body.id}/progress`)
      .set("x-test-user", "other")
      .send({ progress: { blockIndex: 1, characterOffset: 25, percent: 50 } })
      .expect(404);

    const response = await request(app)
      .patch(`/api/documents/${created.body.id}/progress`)
      .set("x-test-user", "owner")
      .send({ progress: { blockIndex: 1, characterOffset: 25, percent: 50 } })
      .expect(200);

    expect(response.body.progress).toEqual({ blockIndex: 1, characterOffset: 25, sentenceIndex: 0, percent: 50 });
    expect(response.body.status).toBe("in_progress");

    const completed = await request(app)
      .patch(`/api/documents/${created.body.id}/progress`)
      .set("x-test-user", "owner")
      .send({ progress: { blockIndex: 1, characterOffset: 25, percent: 100 } })
      .expect(200);

    expect(completed.body.status).toBe("completed");
  });

  it("updates document metadata for source management", async () => {
    const app = createTestApp(repository);
    const created = await request(app)
      .post("/api/documents")
      .set("x-test-user", "owner")
      .send({ title: "CNN", sourceType: "rss", category: "Feeds", voice: "cedar", speed: 1, blocks: [{ text: "Saved source: https://cnn.com/rss" }] })
      .expect(201);

    await request(app)
      .patch(`/api/documents/${created.body.id}`)
      .set("x-test-user", "other")
      .send({ sourceLabel: "CNN World" })
      .expect(404);

    const response = await request(app)
      .patch(`/api/documents/${created.body.id}`)
      .set("x-test-user", "owner")
      .send({ sourceLabel: "CNN World", sourceUrl: "https://edition.cnn.com/world", canonicalUrl: "https://edition.cnn.com/world", category: "News" })
      .expect(200);

    expect(response.body).toMatchObject({
      sourceLabel: "CNN World",
      sourceUrl: "https://edition.cnn.com/world",
      canonicalUrl: "https://edition.cnn.com/world",
      category: "News"
    });
  });

  it("deletes all completed library documents without touching unread or in-progress items", async () => {
    const app = createTestApp(repository);

    await request(app)
      .post("/api/documents")
      .set("x-test-user", "owner")
      .send({ title: "Unread", sourceType: "selection", voice: "cedar", speed: 1, blocks: [{ text: "Unread" }] })
      .expect(201);
    await request(app)
      .post("/api/documents")
      .set("x-test-user", "owner")
      .send({
        title: "Complete",
        sourceType: "selection",
        voice: "cedar",
        speed: 1,
        progress: { blockIndex: 1, characterOffset: 0, percent: 100 },
        blocks: [{ text: "Complete" }]
      })
      .expect(201);

    const deleted = await request(app).delete("/api/documents/completed").set("x-test-user", "owner").expect(200);
    expect(deleted.body).toEqual({ count: 1 });

    const list = await request(app).get("/api/documents").set("x-test-user", "owner").expect(200);
    expect(list.body.map((document: { title: string }) => document.title)).toEqual(["Unread"]);
  });

  it("clears listening history without deleting saved documents", async () => {
    const app = createTestApp(repository);
    const created = await request(app)
      .post("/api/documents")
      .set("x-test-user", "owner")
      .send({
        title: "Owned",
        sourceType: "webpage",
        voice: "cedar",
        speed: 1,
        progress: { blockIndex: 2, characterOffset: 10, percent: 80 },
        summary: "Keep this study summary",
        keyPoints: ["Keep this key point"],
        blocks: [{ text: "Article text" }]
      })
      .expect(201);

    const response = await request(app)
      .delete(`/api/documents/${created.body.id}/history`)
      .set("x-test-user", "owner")
      .expect(200);

    expect(response.body.progress).toEqual({ blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 });
    expect(response.body.status).toBe("unread");
    expect(response.body.lastReadAt).toBeUndefined();
    expect(response.body.summary).toBe("Keep this study summary");
    expect(response.body.keyPoints).toEqual(["Keep this key point"]);

    const list = await request(app).get("/api/documents").set("x-test-user", "owner").expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      id: created.body.id,
      title: "Owned",
      status: "unread",
      progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 }
    });
    expect(list.body[0].lastReadAt).toBeUndefined();
  });

  it("does not let another user clear an owner's listening history", async () => {
    const app = createTestApp(repository);
    const created = await request(app)
      .post("/api/documents")
      .set("x-test-user", "owner")
      .send({
        title: "Owner history",
        sourceType: "webpage",
        voice: "cedar",
        speed: 1,
        progress: { blockIndex: 3, characterOffset: 24, sentenceIndex: 2, percent: 70 },
        blocks: [{ text: "Private owner content" }]
      })
      .expect(201);
    const before = await request(app)
      .get(`/api/documents/${created.body.id}`)
      .set("x-test-user", "owner")
      .expect(200);

    await request(app)
      .delete(`/api/documents/${created.body.id}/history`)
      .set("x-test-user", "other")
      .expect(404);

    const after = await request(app)
      .get(`/api/documents/${created.body.id}`)
      .set("x-test-user", "owner")
      .expect(200);
    expect(after.body).toEqual(before.body);
    expect(after.body.progress).toEqual({ blockIndex: 3, characterOffset: 24, sentenceIndex: 2, percent: 70 });
    expect(after.body.status).toBe("in_progress");
    expect(after.body.lastReadAt).toBeDefined();
  });

  it("clears all RSS and article history while preserving unread Library items", async () => {
    const app = createTestApp(repository);
    await request(app)
      .post("/api/documents")
      .set("x-test-user", "owner")
      .send({
        title: "RSS article",
        sourceType: "rss",
        voice: "cedar",
        speed: 1,
        progress: { blockIndex: 2, characterOffset: 0, percent: 55 },
        summary: "Keep the RSS summary",
        keyPoints: ["Keep the RSS key point"],
        blocks: [{ text: "RSS text" }]
      })
      .expect(201);
    await request(app)
      .post("/api/documents")
      .set("x-test-user", "owner")
      .send({
        title: "Legacy article",
        sourceType: "webpage",
        status: "in_progress",
        voice: "cedar",
        speed: 1,
        progress: { blockIndex: 0, characterOffset: 0, percent: 0 },
        blocks: [{ text: "Article text" }]
      })
      .expect(201);
    await request(app)
      .post("/api/documents")
      .set("x-test-user", "owner")
      .send({
        title: "Unread saved PDF",
        sourceType: "pdf",
        voice: "cedar",
        speed: 1,
        progress: { blockIndex: 0, characterOffset: 0, percent: 0 },
        blocks: [{ text: "Saved text" }]
      })
      .expect(201);

    const cleared = await request(app)
      .delete("/api/documents/history")
      .set("x-test-user", "owner")
      .expect(200);

    expect(cleared.body).toEqual({ count: 2 });
    const list = await request(app).get("/api/documents").set("x-test-user", "owner").expect(200);
    expect(list.body).toHaveLength(3);
    expect(list.body.every((document: ReadingDocumentResponse) =>
      document.status === "unread"
      && document.progress.percent === 0
      && document.lastReadAt === undefined
    )).toBe(true);
    expect(list.body.find((document: ReadingDocumentResponse) => document.title === "RSS article")).toMatchObject({
      summary: "Keep the RSS summary",
      keyPoints: ["Keep the RSS key point"]
    });
  });

  it("leaves another user's history unchanged when bulk history is cleared", async () => {
    const app = createTestApp(repository);
    const ownerDocument = await request(app)
      .post("/api/documents")
      .set("x-test-user", "owner")
      .send({
        title: "Owner article",
        sourceType: "webpage",
        voice: "cedar",
        speed: 1,
        progress: { blockIndex: 2, characterOffset: 12, sentenceIndex: 1, percent: 60 },
        blocks: [{ text: "Owner article text" }]
      })
      .expect(201);
    const otherDocument = await request(app)
      .post("/api/documents")
      .set("x-test-user", "other")
      .send({
        title: "Other user's article",
        sourceType: "rss",
        voice: "cedar",
        speed: 1,
        progress: { blockIndex: 4, characterOffset: 18, sentenceIndex: 3, percent: 75 },
        blocks: [{ text: "Other user article text" }]
      })
      .expect(201);

    const cleared = await request(app)
      .delete("/api/documents/history")
      .set("x-test-user", "owner")
      .expect(200);
    expect(cleared.body).toEqual({ count: 1 });

    const ownerAfter = await request(app)
      .get(`/api/documents/${ownerDocument.body.id}`)
      .set("x-test-user", "owner")
      .expect(200);
    expect(ownerAfter.body).toMatchObject({
      status: "unread",
      progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 }
    });
    expect(ownerAfter.body.lastReadAt).toBeUndefined();

    const otherAfter = await request(app)
      .get(`/api/documents/${otherDocument.body.id}`)
      .set("x-test-user", "other")
      .expect(200);
    expect(otherAfter.body).toMatchObject({
      status: "in_progress",
      progress: { blockIndex: 4, characterOffset: 18, sentenceIndex: 3, percent: 75 }
    });
    expect(otherAfter.body.lastReadAt).toBeDefined();
  });

  it("deletes a library document completely for the owning user", async () => {
    const app = createTestApp(repository);
    const created = await request(app)
      .post("/api/documents")
      .set("x-test-user", "owner")
      .send({
        title: "Delete me",
        sourceType: "pdf",
        voice: "cedar",
        speed: 1,
        progress: { blockIndex: 1, characterOffset: 12, percent: 45 },
        blocks: [{ text: "PDF text" }]
      })
      .expect(201);

    await request(app).delete(`/api/documents/${created.body.id}`).set("x-test-user", "other").expect(404);
    await request(app).get(`/api/documents/${created.body.id}`).set("x-test-user", "owner").expect(200);

    await request(app).delete(`/api/documents/${created.body.id}`).set("x-test-user", "owner").expect(204);

    await request(app).get(`/api/documents/${created.body.id}`).set("x-test-user", "owner").expect(404);
    const list = await request(app).get("/api/documents").set("x-test-user", "owner").expect(200);
    expect(list.body).toEqual([]);
  });
});
