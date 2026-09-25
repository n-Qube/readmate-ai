import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentRepository } from "./documents.js";
import type { AuthedRequest } from "../auth.js";
import { DownloadLimitExceededError, UploadQuotaError, uploadsRouter, type UploadRecordResponse, type UploadRepository, type UploadStorage } from "./uploads.js";
import type { WorkLimiter } from "../workLimiter.js";

function createTestApp(repository: UploadRepository, storage: UploadStorage, documentRepository?: DocumentRepository, documentWorkLimiter?: WorkLimiter) {
  const app = express();
  app.use(express.json());
  app.use((req: AuthedRequest, _res, next) => {
    req.userId = String(req.header("x-test-user") ?? "user_a");
    next();
  });
  app.use("/api/uploads", uploadsRouter({
    repository,
    storage,
    documentRepository,
    documentWorkLimiter,
    pdfTextExtractor: async (_bytes, filename) => [
      {
        orderIndex: 0,
        blockType: "page",
        text: `Page 1 readable text from ${filename}`,
        sourcePageNumber: 1
      }
    ]
  }));
  return app;
}

function createMemoryRepository(documentRepository?: DocumentRepository, options: { fenced?: boolean } = {}): UploadRepository {
  const uploads = new Map<string, UploadRecordResponse>();
  let nextId = 1;

  return {
    async createUpload(userId, input, storageKey) {
      const upload = {
        id: `upload_${nextId++}`,
        filename: input.filename,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        storageBucket: "readmate-uploads",
        storageKey,
        documentId: input.documentId,
        createdAt: "2026-05-22T12:00:00.000Z",
        userId
      };
      uploads.set(upload.id, upload);
      return upload;
    },
    async getUpload(userId, uploadId) {
      const upload = uploads.get(uploadId) as (UploadRecordResponse & { userId: string }) | undefined;
      return upload?.userId === userId ? upload : null;
    },
    async attachDocument(userId, uploadId, documentId) {
      const upload = uploads.get(uploadId) as (UploadRecordResponse & { userId: string }) | undefined;
      if (!upload || upload.userId !== userId) return null;
      const updated = { ...upload, documentId };
      uploads.set(uploadId, updated);
      return updated;
    },
    async deleteUpload(userId, uploadId) {
      const upload = uploads.get(uploadId) as (UploadRecordResponse & { userId: string }) | undefined;
      if (!upload || upload.userId !== userId) return false;
      uploads.delete(uploadId);
      return true;
    },
    // Mirrors the Prisma transaction: create, then bind only if still unbound;
    // a loser "rolls back" its document and returns the winner's.
    async createBoundDocument(userId, uploadId, input) {
      if (!documentRepository) throw new Error("test repository has no document repository");
      if (options.fenced) throw new Error("ACCOUNT_DELETION_IN_PROGRESS");
      const document = await documentRepository.createDocument(userId, input);
      const upload = uploads.get(uploadId) as (UploadRecordResponse & { userId: string }) | undefined;
      if (!upload || upload.userId !== userId) throw new Error("upload not found");
      if (upload.documentId) {
        await documentRepository.deleteDocument(userId, document.id);
        const winner = await documentRepository.getDocument(userId, upload.documentId);
        if (!winner) throw new Error("bound document missing");
        return { document: winner, created: false };
      }
      uploads.set(uploadId, { ...upload, documentId: document.id });
      return { document, created: true };
    }
  };
}

type MemoryStorage = UploadStorage & {
  deleted: string[];
  downloads: string[];
  /** Override what storage reports for an object (size/content type), or null for "not uploaded". */
  infoOverride?: { size: number; contentType?: string } | null;
  failDelete?: boolean;
};

function createMemoryStorage(fileBytes = Buffer.from("%PDF-1.7 readable bytes")): MemoryStorage {
  const store: MemoryStorage = {
    deleted: [],
    downloads: [],
    async createSignedUploadUrl(storageKey) {
      return { signedUrl: `https://storage.example/upload/${storageKey}`, token: "signed-upload-token" };
    },
    async createSignedDownloadUrl(storageKey) {
      return { signedUrl: `https://storage.example/download/${storageKey}` };
    },
    async uploadFile() {
      return undefined;
    },
    async deleteFile(storageKey) {
      if (store.failDelete) throw new Error("storage delete timed out");
      store.deleted.push(storageKey);
    },
    async getObjectInfo() {
      if (store.infoOverride !== undefined) return store.infoOverride;
      return { size: fileBytes.byteLength, contentType: "application/pdf" };
    },
    async downloadFile(storageKey, maxBytes) {
      store.downloads.push(storageKey);
      if (fileBytes.byteLength > maxBytes) throw new DownloadLimitExceededError("download exceeded limit");
      return fileBytes;
    }
  };
  return store;
}

function createMemoryDocumentRepository(): DocumentRepository {
  const documents = new Map<string, Awaited<ReturnType<DocumentRepository["createDocument"]>>>();
  let nextId = 1;

  return {
    async createDocument(userId, input) {
      const now = "2026-05-22T12:00:00.000Z";
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
          id: `block_${index}`,
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
      if (document?.userId !== userId) return false;
      documents.delete(documentId);
      return true;
    },
    async deleteCompletedDocuments() {
      return 0;
    }
  };
}

describe("uploadsRouter", () => {
  let repository: UploadRepository;
  let storage: UploadStorage;

  beforeEach(() => {
    repository = createMemoryRepository();
    storage = createMemoryStorage();
  });

  it("creates a signed PDF upload URL scoped to the authenticated user", async () => {
    const app = createTestApp(repository, storage);

    const response = await request(app)
      .post("/api/uploads/pdf/sign")
      .set("x-test-user", "user_123")
      .send({ filename: "Research Paper.pdf", mimeType: "application/pdf", byteSize: 2048 })
      .expect(201);

    expect(response.body).toMatchObject({
      id: "upload_1",
      filename: "Research Paper.pdf",
      mimeType: "application/pdf",
      byteSize: 2048,
      storageBucket: "readmate-uploads",
      token: "signed-upload-token",
      expiresInSeconds: 7200
    });
    expect(response.body.storageKey).toMatch(/^user_123\/.+-Research-Paper\.pdf$/);
    expect(response.body.signedUrl).toContain(response.body.storageKey);
  });

  it("returns a stable 429 response when the durable upload quota is exhausted", async () => {
    const repository = createMemoryRepository();
    repository.createUpload = async () => {
      throw new UploadQuotaError();
    };

    const storage = createMemoryStorage();
    storage.createSignedUploadUrl = vi.fn(storage.createSignedUploadUrl);
    const response = await request(createTestApp(repository, storage))
      .post("/api/uploads/pdf/sign")
      .set("x-test-user", "user_a")
      .send({ filename: "research.pdf", mimeType: "application/pdf", byteSize: 2048 })
      .expect(429);

    expect(response.body).toEqual({ error: "Upload quota reached.", code: "UPLOAD_QUOTA_REACHED" });
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("removes reserved upload metadata when URL signing fails", async () => {
    const deleteUpload = vi.spyOn(repository, "deleteUpload");
    storage.createSignedUploadUrl = async () => {
      throw new Error("signing unavailable");
    };

    await request(createTestApp(repository, storage))
      .post("/api/uploads/pdf/sign")
      .set("x-test-user", "owner")
      .send({ filename: "research.pdf", mimeType: "application/pdf", byteSize: 2048 })
      .expect(500);

    expect(deleteUpload).toHaveBeenCalledWith("owner", "upload_1");
    expect(await repository.getUpload("owner", "upload_1")).toBeNull();
  });

  it("rejects non-PDF uploads", async () => {
    const app = createTestApp(repository, storage);

    await request(app)
      .post("/api/uploads/pdf/sign")
      .send({ filename: "notes.txt", mimeType: "text/plain", byteSize: 100 })
      .expect(400);
  });

  it("creates download URLs only for the owner", async () => {
    const app = createTestApp(repository, storage);

    const created = await request(app)
      .post("/api/uploads/pdf/sign")
      .set("x-test-user", "owner")
      .send({ filename: "paper.pdf", mimeType: "application/pdf", byteSize: 1024 })
      .expect(201);

    await request(app).get(`/api/uploads/${created.body.id}/download-url`).set("x-test-user", "other").expect(404);

    const response = await request(app).get(`/api/uploads/${created.body.id}/download-url`).set("x-test-user", "owner").expect(200);
    expect(response.body).toMatchObject({ expiresInSeconds: 300 });
    expect(response.body.signedUrl).toContain(created.body.storageKey);
  });

  it("creates a readable PDF document from an uploaded file", async () => {
    const documentRepository = createMemoryDocumentRepository();
    repository = createMemoryRepository(documentRepository);
    const app = createTestApp(repository, storage, documentRepository);
    const created = await request(app)
      .post("/api/uploads/pdf/sign")
      .set("x-test-user", "owner")
      .send({ filename: "lecture-notes.pdf", mimeType: "application/pdf", byteSize: 1024 })
      .expect(201);

    const response = await request(app)
      .post(`/api/uploads/${created.body.id}/pdf/document`)
      .set("x-test-user", "owner")
      .send({
        title: "Lecture notes",
        provider: "google",
        voice: "en-US-Neural2-J",
        speed: 1.1
      })
      .expect(201);

    expect(response.body).toMatchObject({
      id: "doc_1",
      title: "Lecture notes",
      sourceType: "pdf",
      category: "Documents",
      sourceLabel: "PDF upload",
      provider: "google",
      voice: "en-US-Neural2-J",
      speed: 1.1,
      progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 }
    });
    expect(response.body.blocks).toEqual([
      expect.objectContaining({
        orderIndex: 0,
        blockType: "page",
        text: "Page 1 readable text from lecture-notes.pdf",
        sourcePageNumber: 1
      })
    ]);

    const upload = await repository.getUpload("owner", created.body.id);
    expect(upload?.documentId).toBe("doc_1");
  });

  it("rejects PDF extraction when document-processing capacity is exhausted", async () => {
    const documentRepository = createMemoryDocumentRepository();
    const app = createTestApp(repository, storage, documentRepository, { tryAcquire: () => null });
    const created = await request(app)
      .post("/api/uploads/pdf/sign")
      .set("x-test-user", "owner")
      .send({ filename: "lecture-notes.pdf", mimeType: "application/pdf", byteSize: 1024 })
      .expect(201);

    const response = await request(app)
      .post(`/api/uploads/${created.body.id}/pdf/document`)
      .set("x-test-user", "owner")
      .send({ provider: "google", voice: "en-US-Neural2-J", speed: 1 })
      .expect(503);

    expect(response.headers["retry-after"]).toBe("5");
    expect(response.body.error).toContain("processing is busy");
  });

  it("rejects stored bytes that are not PDF content", async () => {
    const documentRepository = createMemoryDocumentRepository();
    const app = createTestApp(repository, createMemoryStorage(Buffer.from("not a pdf")), documentRepository);
    const created = await request(app)
      .post("/api/uploads/pdf/sign")
      .set("x-test-user", "owner")
      .send({ filename: "notes.pdf", mimeType: "application/pdf", byteSize: 1024 })
      .expect(201);

    await request(app)
      .post(`/api/uploads/${created.body.id}/pdf/document`)
      .set("x-test-user", "owner")
      .send({ title: "Notes", provider: "google", voice: "en-US-Neural2-J", speed: 1 })
      .expect(400);
  });

  it("rejects signed upload metadata that is not a PDF", async () => {
    const app = createTestApp(repository, storage);
    await request(app)
      .post("/api/uploads/pdf/sign")
      .set("x-test-user", "owner")
      .send({ filename: "notes.txt", mimeType: "text/plain", byteSize: 100 })
      .expect(400);
  });

  describe("PDF conversion is idempotent per upload (RM-02)", () => {
    async function signedUpload(app: ReturnType<typeof createTestApp>) {
      const created = await request(app)
        .post("/api/uploads/pdf/sign")
        .set("x-test-user", "owner")
        .send({ filename: "lecture-notes.pdf", mimeType: "application/pdf", byteSize: 1024 })
        .expect(201);
      return created.body.id as string;
    }
    const body = { title: "Lecture notes", provider: "google", voice: "en-US-Neural2-J", speed: 1 };

    it("returns the same document when the conversion is repeated", async () => {
      const documentRepository = createMemoryDocumentRepository();
      repository = createMemoryRepository(documentRepository);
      const app = createTestApp(repository, storage, documentRepository);
      const uploadId = await signedUpload(app);

      const first = await request(app).post(`/api/uploads/${uploadId}/pdf/document`).set("x-test-user", "owner").send(body).expect(201);
      const retry = await request(app).post(`/api/uploads/${uploadId}/pdf/document`).set("x-test-user", "owner").send(body).expect(200);

      expect(retry.body.id).toBe(first.body.id);
      expect(await documentRepository.listDocuments("owner")).toHaveLength(1);
    });

    it("gives simultaneous conversions one winning document", async () => {
      const documentRepository = createMemoryDocumentRepository();
      repository = createMemoryRepository(documentRepository);
      const app = createTestApp(repository, storage, documentRepository);
      const uploadId = await signedUpload(app);

      const responses = await Promise.all([1, 2, 3].map(() =>
        request(app).post(`/api/uploads/${uploadId}/pdf/document`).set("x-test-user", "owner").send(body)
      ));

      const ids = new Set(responses.map((response) => response.body.id));
      expect(ids.size).toBe(1);
      expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
      expect(responses.every((response) => response.status === 201 || response.status === 200)).toBe(true);
      expect(await documentRepository.listDocuments("owner")).toHaveLength(1);
      expect((await repository.getUpload("owner", uploadId))?.documentId).toBe([...ids][0]);
    });

    it("returns the canonical document for a retry with different settings", async () => {
      const documentRepository = createMemoryDocumentRepository();
      repository = createMemoryRepository(documentRepository);
      const app = createTestApp(repository, storage, documentRepository);
      const uploadId = await signedUpload(app);

      const first = await request(app).post(`/api/uploads/${uploadId}/pdf/document`).set("x-test-user", "owner").send(body).expect(201);
      const changed = await request(app)
        .post(`/api/uploads/${uploadId}/pdf/document`)
        .set("x-test-user", "owner")
        .send({ ...body, title: "Renamed", speed: 1.5 })
        .expect(200);

      expect(changed.body).toMatchObject({ id: first.body.id, title: "Lecture notes", speed: 1 });
    });

    it("does not convert another user's upload", async () => {
      const documentRepository = createMemoryDocumentRepository();
      repository = createMemoryRepository(documentRepository);
      const app = createTestApp(repository, storage, documentRepository);
      const uploadId = await signedUpload(app);

      await request(app).post(`/api/uploads/${uploadId}/pdf/document`).set("x-test-user", "intruder").send(body).expect(404);
      expect(await documentRepository.listDocuments("intruder")).toHaveLength(0);
    });

    it("refuses conversion for an account that is being deleted", async () => {
      const documentRepository = createMemoryDocumentRepository();
      repository = createMemoryRepository(documentRepository, { fenced: true });
      const app = createTestApp(repository, storage, documentRepository);
      const uploadId = await signedUpload(app);

      const response = await request(app).post(`/api/uploads/${uploadId}/pdf/document`).set("x-test-user", "owner").send(body).expect(409);
      expect(response.body.error).toMatch(/being deleted/i);
      expect(await documentRepository.listDocuments("owner")).toHaveLength(0);
    });
  });

  describe("actual upload size is enforced before parsing (RM-03)", () => {
    const body = { provider: "google", voice: "en-US-Neural2-J", speed: 1 };
    async function signed(app: ReturnType<typeof createTestApp>, byteSize = 1024) {
      const created = await request(app)
        .post("/api/uploads/pdf/sign")
        .set("x-test-user", "owner")
        .send({ filename: "notes.pdf", mimeType: "application/pdf", byteSize })
        .expect(201);
      return created.body as { id: string; storageKey: string };
    }

    it("rejects an object larger than declared without downloading it, and removes it", async () => {
      const documentRepository = createMemoryDocumentRepository();
      repository = createMemoryRepository(documentRepository);
      const store = createMemoryStorage();
      store.infoOverride = { size: 40 * 1024 * 1024, contentType: "application/pdf" };
      const app = createTestApp(repository, store, documentRepository);
      const upload = await signed(app, 1024);

      const response = await request(app).post(`/api/uploads/${upload.id}/pdf/document`).set("x-test-user", "owner").send(body).expect(413);

      expect(response.body.error).toMatch(/larger than/i);
      expect(store.downloads).toHaveLength(0);
      expect(store.deleted).toEqual([upload.storageKey]);
      expect(await repository.getUpload("owner", upload.id)).toBeNull();
      expect(await documentRepository.listDocuments("owner")).toHaveLength(0);
    });

    it("keeps the reservation when the oversized object cannot be deleted", async () => {
      const documentRepository = createMemoryDocumentRepository();
      repository = createMemoryRepository(documentRepository);
      const store = createMemoryStorage();
      store.infoOverride = { size: 40 * 1024 * 1024, contentType: "application/pdf" };
      store.failDelete = true;
      const app = createTestApp(repository, store, documentRepository);
      const upload = await signed(app, 1024);

      await request(app).post(`/api/uploads/${upload.id}/pdf/document`).set("x-test-user", "owner").send(body).expect(413);
      expect(await repository.getUpload("owner", upload.id)).not.toBeNull();
    });

    it("asks the client to wait when the object has not been uploaded yet", async () => {
      const documentRepository = createMemoryDocumentRepository();
      repository = createMemoryRepository(documentRepository);
      const store = createMemoryStorage();
      store.infoOverride = null;
      const app = createTestApp(repository, store, documentRepository);
      const upload = await signed(app);

      await request(app).post(`/api/uploads/${upload.id}/pdf/document`).set("x-test-user", "owner").send(body).expect(409);
      expect(store.deleted).toHaveLength(0);
      expect(await repository.getUpload("owner", upload.id)).not.toBeNull();
    });

    it("rejects a stored object whose content type is not PDF, and removes it", async () => {
      const documentRepository = createMemoryDocumentRepository();
      repository = createMemoryRepository(documentRepository);
      const store = createMemoryStorage();
      store.infoOverride = { size: 512, contentType: "text/html" };
      const app = createTestApp(repository, store, documentRepository);
      const upload = await signed(app);

      await request(app).post(`/api/uploads/${upload.id}/pdf/document`).set("x-test-user", "owner").send(body).expect(415);
      expect(store.downloads).toHaveLength(0);
      expect(store.deleted).toEqual([upload.storageKey]);
    });

    it("removes an object whose bytes are not a PDF", async () => {
      const documentRepository = createMemoryDocumentRepository();
      repository = createMemoryRepository(documentRepository);
      const store = createMemoryStorage(Buffer.from("not a pdf"));
      const app = createTestApp(repository, store, documentRepository);
      const upload = await signed(app);

      await request(app).post(`/api/uploads/${upload.id}/pdf/document`).set("x-test-user", "owner").send(body).expect(400);
      expect(store.deleted).toEqual([upload.storageKey]);
      expect(await repository.getUpload("owner", upload.id)).toBeNull();
    });

    it("caps the download at the declared size", async () => {
      const documentRepository = createMemoryDocumentRepository();
      repository = createMemoryRepository(documentRepository);
      const store = createMemoryStorage(Buffer.concat([Buffer.from("%PDF-1.7 "), Buffer.alloc(4096, 97)]));
      // Metadata understates the object, e.g. it was replaced after the check.
      store.infoOverride = { size: 100, contentType: "application/pdf" };
      const app = createTestApp(repository, store, documentRepository);
      const upload = await signed(app, 200);

      await request(app).post(`/api/uploads/${upload.id}/pdf/document`).set("x-test-user", "owner").send(body).expect(413);
      expect(store.deleted).toEqual([upload.storageKey]);
    });
  });
});
