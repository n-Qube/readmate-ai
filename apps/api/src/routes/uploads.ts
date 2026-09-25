import type { NextFunction, Response, Router } from "express";
import { Router as createRouter } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getUserId, type AuthedRequest } from "../auth.js";
import type { prisma as PrismaSingleton } from "../prisma.js";
import { extractPdfTextBlocks, isPdfBytes, type ExtractedPdfBlock, type PdfExtractionLimits } from "../pdf/extractPdfText.js";
import { getSupabaseAdminClient, getUploadBucket, toPlainUint8Array } from "../storage.js";
import { normalizeGoogleTtsVoice } from "../ttsSchema.js";
import { PrismaDocumentRepository, type CreateDocumentInput, type DocumentRepository, type ReadingDocumentResponse } from "./documents.js";
import { documentProcessingLimiter, type WorkLimiter, type WorkPermit } from "../workLimiter.js";
import { entitlementForRequest, requireDocumentWithinPlan, type MaybePromise, type ReadMateEntitlement } from "../entitlements.js";

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const DEFAULT_UPLOAD_DAILY_BYTE_LIMIT = 200 * 1024 * 1024;
const DEFAULT_UPLOAD_TOTAL_BYTE_LIMIT = 1024 * 1024 * 1024;
const DEFAULT_UPLOAD_TOTAL_OBJECT_LIMIT = 1000;
const DEFAULT_UPLOAD_PENDING_OBJECT_LIMIT = 20;
const PENDING_UPLOAD_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const providerSchema = z.preprocess(() => "google", z.literal("google"));
const voiceSchema = z.preprocess(normalizeGoogleTtsVoice, z.string().trim().min(1).max(100));

const createPdfUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(180),
  byteSize: z.number().int().min(1).max(MAX_PDF_BYTES),
  documentId: z.string().trim().min(1).optional()
}).superRefine((value, context) => {
  if (!/\.pdf$/i.test(value.filename) || value.mimeType !== "application/pdf") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Only PDF uploads are accepted." });
  }
});

const createPdfDocumentSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  provider: providerSchema.default("google"),
  voice: voiceSchema,
  speed: z.number().min(0.5).max(4)
});

class UploadValidationError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
  }
}

export class UploadQuotaError extends Error {
  readonly statusCode = 429;
  readonly code = "UPLOAD_QUOTA_REACHED";

  constructor() {
    super("Upload quota reached.");
    this.name = "UploadQuotaError";
  }
}

export type CreatePdfUploadInput = z.infer<typeof createPdfUploadSchema>;

export type UploadRecordResponse = {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  storageBucket: string;
  storageKey: string;
  documentId?: string;
  createdAt: string;
};

export type SignedUploadResponse = UploadRecordResponse & {
  signedUrl: string;
  token?: string;
  expiresInSeconds: number;
};

export type SignedDownloadResponse = {
  signedUrl: string;
  expiresInSeconds: number;
};

export type UploadRepository = {
  createUpload(userId: string, input: CreatePdfUploadInput, storageKey: string): Promise<UploadRecordResponse>;
  getUpload(userId: string, uploadId: string): Promise<UploadRecordResponse | null>;
  attachDocument(userId: string, uploadId: string, documentId: string): Promise<UploadRecordResponse | null>;
  /**
   * Creates the document and binds it to the upload atomically. If another
   * request bound the upload first, this call's document is rolled back and
   * the winner's is returned with created: false.
   */
  createBoundDocument(userId: string, uploadId: string, input: CreateDocumentInput): Promise<{ document: ReadingDocumentResponse; created: boolean }>;
  deleteUpload(userId: string, uploadId: string): Promise<boolean>;
  listExpiredPendingUploads?(userId: string, olderThan: Date): Promise<UploadRecordResponse[]>;
};

export type UploadStorage = {
  createSignedUploadUrl(storageKey: string): Promise<{ signedUrl: string; token?: string }>;
  createSignedDownloadUrl(storageKey: string, expiresInSeconds: number): Promise<{ signedUrl: string }>;
  uploadFile(storageKey: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  deleteFile(storageKey: string): Promise<void>;
  downloadFile(storageKey: string): Promise<Uint8Array>;
};

type UploadsRouterDeps = {
  repository?: UploadRepository;
  storage?: UploadStorage;
  documentRepository?: DocumentRepository;
  pdfTextExtractor?: (bytes: Uint8Array, filename: string, limits?: PdfExtractionLimits) => Promise<ExtractedPdfBlock[]>;
  documentWorkLimiter?: WorkLimiter;
  getEntitlement?: (req: AuthedRequest, userId: string) => MaybePromise<ReadMateEntitlement>;
};

export function uploadsRouter(deps: UploadsRouterDeps = {}): Router {
  const router = createRouter();
  const repository = deps.repository ?? new PrismaUploadRepository();
  const storage = deps.storage ?? new SupabaseUploadStorage();
  const documentRepository = deps.documentRepository ?? new PrismaDocumentRepository();
  const pdfTextExtractor = deps.pdfTextExtractor ?? ((bytes: Uint8Array, _filename: string, limits?: PdfExtractionLimits) => extractPdfTextBlocks(bytes, limits));
  const workLimiter = deps.documentWorkLimiter ?? documentProcessingLimiter;
  const getEntitlement = deps.getEntitlement ?? entitlementForRequest;

  router.post("/pdf/sign", async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const payload = createPdfUploadSchema.parse(req.body);
      const userId = getUserId(req);
      requireDocumentWithinPlan(await getEntitlement(req, userId), { byteSize: payload.byteSize });
      await cleanupExpiredPendingUploads(userId, repository, storage);
      const storageKey = `${userId}/${randomUUID()}-${sanitizeFilename(payload.filename)}`;
      const record = await repository.createUpload(userId, payload, storageKey);
      let signedUpload: { signedUrl: string; token?: string };
      try {
        signedUpload = await storage.createSignedUploadUrl(storageKey);
      } catch (error) {
        await repository.deleteUpload(userId, record.id).catch(() => undefined);
        throw error;
      }

      res.status(201).json({
        ...record,
        signedUrl: signedUpload.signedUrl,
        token: signedUpload.token,
        expiresInSeconds: 7200
      } satisfies SignedUploadResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.issues[0]?.message ?? "Invalid upload request." });
        return;
      }
      if (error instanceof UploadQuotaError) {
        res.status(error.statusCode).json({ error: "Upload quota reached.", code: error.code });
        return;
      }
      next(error);
    }
  });

  router.get("/:id/download-url", async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const upload = await repository.getUpload(getUserId(req), String(req.params.id));
      if (!upload) {
        res.status(404).json({ error: "Upload not found." });
        return;
      }

      const expiresInSeconds = 300;
      const signedDownload = await storage.createSignedDownloadUrl(upload.storageKey, expiresInSeconds);
      res.json({ signedUrl: signedDownload.signedUrl, expiresInSeconds } satisfies SignedDownloadResponse);
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/pdf/document", async (req: AuthedRequest, res: Response, next: NextFunction) => {
    let releasePermit: WorkPermit | undefined;
    try {
      const upload = await repository.getUpload(getUserId(req), String(req.params.id));
      if (!upload) {
        res.status(404).json({ error: "Upload not found." });
        return;
      }
      // The upload is the conversion identity: a retry, a lost response, or a
      // repeat with different settings returns the document already made.
      if (upload.documentId) {
        const existing = await documentRepository.getDocument(getUserId(req), upload.documentId);
        if (existing) {
          res.status(200).json(existing);
          return;
        }
      }
      releasePermit = workLimiter.tryAcquire() ?? undefined;
      if (!releasePermit) {
        res.setHeader("Retry-After", "5");
        res.status(503).json({ error: "Document processing is busy. Please retry shortly." });
        return;
      }

      const payload = createPdfDocumentSchema.parse(req.body);
      const bytes = await storage.downloadFile(upload.storageKey);
      const entitlement = await getEntitlement(req, getUserId(req));
      requireDocumentWithinPlan(entitlement, { byteSize: bytes.byteLength });
      if (bytes.byteLength > MAX_PDF_BYTES || bytes.byteLength > upload.byteSize || !isPdfBytes(bytes)) {
        throw new UploadValidationError("Uploaded bytes are not a valid PDF within the declared size.");
      }
      let blocks: ExtractedPdfBlock[];
      try {
        blocks = await pdfTextExtractor(bytes, upload.filename, {
          maxPages: entitlement.limits.maxPdfPages,
          maxTextChars: entitlement.limits.maxDocumentCharacters
        });
      } catch (error) {
        if (!entitlement.isPremium && /(?:page|text).*(?:limit|exceed)|(?:limit|exceed).*(?:page|text)/i.test(error instanceof Error ? error.message : "")) {
          requireDocumentWithinPlan(entitlement, { textCharacters: entitlement.limits.maxDocumentCharacters + 1 });
        }
        throw error;
      }
      if (!blocks.length) {
        res.status(422).json({ error: "ReadMate could not extract readable text from this PDF." });
        return;
      }
      requireDocumentWithinPlan(entitlement, {
        pageCount: Math.max(...blocks.map((block) => block.sourcePageNumber), 0),
        textCharacters: blocks.reduce((total, block) => total + block.text.length, 0)
      });

      const { document, created } = await repository.createBoundDocument(getUserId(req), upload.id, {
        title: payload.title ?? upload.filename.replace(/\.pdf$/i, ""),
        sourceType: "pdf",
        category: "Documents",
        sourceLabel: "PDF upload",
        description: `PDF uploaded as ${upload.filename}.`,
        estimatedListeningSeconds: estimateListeningSeconds(blocks, payload.speed),
        provider: payload.provider,
        voice: payload.voice,
        speed: payload.speed,
        progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 },
        blocks
      });

      res.status(created ? 201 : 200).json(document);
    } catch (error) {
      if (isAccountDeletionFenceError(error)) {
        res.status(409).json({ error: "This account is being deleted, so the document was not created." });
        return;
      }
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.issues[0]?.message ?? "Invalid PDF document request." });
        return;
      }
      if (error instanceof UploadValidationError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      next(error);
    } finally {
      releasePermit?.();
    }
  });

  return router;
}


export class SupabaseUploadStorage implements UploadStorage {
  async createSignedUploadUrl(storageKey: string): Promise<{ signedUrl: string; token?: string }> {
    const { data, error } = await getSupabaseAdminClient().storage.from(getUploadBucket()).createSignedUploadUrl(storageKey);
    if (error) throw new Error(error.message);
    return { signedUrl: data.signedUrl, token: data.token };
  }

  async createSignedDownloadUrl(storageKey: string, expiresInSeconds: number): Promise<{ signedUrl: string }> {
    const { data, error } = await getSupabaseAdminClient().storage.from(getUploadBucket()).createSignedUrl(storageKey, expiresInSeconds);
    if (error) throw new Error(error.message);
    return { signedUrl: data.signedUrl };
  }

  async uploadFile(storageKey: string, bytes: Uint8Array, mimeType: string): Promise<void> {
    const { error } = await getSupabaseAdminClient().storage.from(getUploadBucket()).upload(storageKey, toPlainUint8Array(bytes), {
      contentType: mimeType,
      upsert: false
    });
    if (error) throw new Error(error.message);
  }

  async deleteFile(storageKey: string): Promise<void> {
    const { error } = await getSupabaseAdminClient().storage.from(getUploadBucket()).remove([storageKey]);
    if (error) throw new Error(error.message);
  }

  async downloadFile(storageKey: string): Promise<Uint8Array> {
    const { data, error } = await getSupabaseAdminClient().storage.from(getUploadBucket()).download(storageKey);
    if (error) throw new Error(error.message);
    return new Uint8Array(await data.arrayBuffer());
  }
}

export class PrismaUploadRepository implements UploadRepository {
  async createUpload(userId: string, input: CreatePdfUploadInput, storageKey: string): Promise<UploadRecordResponse> {
    const prisma = await getPrisma();
    const id = randomUUID();
    const dailyLimit = uploadLimitFromEnv("UPLOAD_DAILY_BYTE_LIMIT", DEFAULT_UPLOAD_DAILY_BYTE_LIMIT);
    const totalLimit = uploadLimitFromEnv("UPLOAD_TOTAL_BYTE_LIMIT", DEFAULT_UPLOAD_TOTAL_BYTE_LIMIT);
    const totalObjectLimit = uploadLimitFromEnv("UPLOAD_TOTAL_OBJECT_LIMIT", DEFAULT_UPLOAD_TOTAL_OBJECT_LIMIT);
    const pendingObjectLimit = uploadLimitFromEnv("UPLOAD_PENDING_OBJECT_LIMIT", DEFAULT_UPLOAD_PENDING_OBJECT_LIMIT);
    const uploads = await prisma.$queryRaw<any[]>`
      WITH locked AS (
        SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))
      ), usage AS (
        SELECT
          COALESCE(SUM("byteSize"), 0)::bigint AS total_bytes,
          COALESCE(SUM("byteSize") FILTER (
            WHERE "createdAt" >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
          ), 0)::bigint AS daily_bytes,
          COUNT(*)::bigint AS total_objects,
          COUNT(*) FILTER (WHERE "documentId" IS NULL)::bigint AS pending_objects
        FROM "UploadedFile", locked
        WHERE "userId" = ${userId}
      )
      INSERT INTO "UploadedFile" (
        "id", "userId", "documentId", "filename", "mimeType", "byteSize", "storageKey", "createdAt"
      )
      SELECT
        ${id}, ${userId}, ${input.documentId ?? null}, ${input.filename}, ${input.mimeType},
        ${input.byteSize}, ${storageKey}, CURRENT_TIMESTAMP
      FROM usage
      WHERE total_bytes + ${BigInt(input.byteSize)} <= ${BigInt(totalLimit)}
        AND daily_bytes + ${BigInt(input.byteSize)} <= ${BigInt(dailyLimit)}
        AND total_objects + 1 <= ${BigInt(totalObjectLimit)}
        AND pending_objects + 1 <= ${BigInt(pendingObjectLimit)}
      RETURNING *
    `;
    const upload = uploads[0];
    if (!upload) throw new UploadQuotaError();
    return serializeUpload(upload);
  }

  async getUpload(userId: string, uploadId: string): Promise<UploadRecordResponse | null> {
    const prisma = await getPrisma();
    const upload = await prisma.uploadedFile.findFirst({ where: { id: uploadId, userId } });
    if (upload?.documentId) {
      const document = await prisma.readingDocument.findFirst({ where: { id: upload.documentId, userId, deletedAt: null }, select: { id: true } });
      if (!document) return null;
    }
    return upload ? serializeUpload(upload) : null;
  }

  async attachDocument(userId: string, uploadId: string, documentId: string): Promise<UploadRecordResponse | null> {
    const prisma = await getPrisma();
    const existing = await prisma.uploadedFile.findFirst({ where: { id: uploadId, userId }, select: { id: true } });
    if (!existing) return null;
    const upload = await prisma.uploadedFile.update({
      where: { id: uploadId },
      data: { documentId }
    });
    return serializeUpload(upload);
  }

  async createBoundDocument(userId: string, uploadId: string, input: CreateDocumentInput): Promise<{ document: ReadingDocumentResponse; created: boolean }> {
    const { withRlsTransaction } = await import("../prisma.js");
    const { readingDocumentCreateData, documentInclude, serializeDocument } = await import("./documents.js");
    try {
      const document = await withRlsTransaction(async (tx) => {
        const created = await tx.readingDocument.create({ data: readingDocumentCreateData(userId, input), include: documentInclude });
        // Conditional bind: under READ COMMITTED a concurrent binder blocks on
        // the row lock, then re-checks "documentId" IS NULL and matches nothing.
        const bound = await tx.$executeRaw`
          UPDATE "UploadedFile" SET "documentId" = ${created.id}
          WHERE "id" = ${uploadId} AND "userId" = ${userId} AND "documentId" IS NULL
        `;
        if (bound !== 1) throw new ConversionAlreadyBoundError();
        return created;
      });
      return { document: serializeDocument(document), created: true };
    } catch (error) {
      if (!(error instanceof ConversionAlreadyBoundError)) throw error;
      const prisma = await getPrisma();
      const upload = await prisma.uploadedFile.findFirst({ where: { id: uploadId, userId }, select: { documentId: true } });
      const winner = upload?.documentId
        ? await prisma.readingDocument.findFirst({ where: { id: upload.documentId, userId, deletedAt: null }, include: documentInclude })
        : null;
      if (!winner) throw new UploadValidationError("This upload was converted, but its document is no longer available.", 409);
      return { document: serializeDocument(winner), created: false };
    }
  }

  async deleteUpload(userId: string, uploadId: string): Promise<boolean> {
    const prisma = await getPrisma();
    const result = await prisma.uploadedFile.deleteMany({ where: { id: uploadId, userId } });
    return result.count > 0;
  }

  async listExpiredPendingUploads(userId: string, olderThan: Date): Promise<UploadRecordResponse[]> {
    const prisma = await getPrisma();
    const uploads = await prisma.uploadedFile.findMany({
      where: { userId, documentId: null, createdAt: { lt: olderThan } },
      take: DEFAULT_UPLOAD_PENDING_OBJECT_LIMIT,
      orderBy: { createdAt: "asc" }
    });
    return uploads.map(serializeUpload);
  }
}

async function cleanupExpiredPendingUploads(
  userId: string,
  repository: UploadRepository,
  storage: UploadStorage
): Promise<void> {
  if (!repository.listExpiredPendingUploads) return;
  const olderThan = new Date(Date.now() - PENDING_UPLOAD_MAX_AGE_MS);
  const expired = await repository.listExpiredPendingUploads(userId, olderThan);
  for (const upload of expired) {
    try {
      await storage.deleteFile(upload.storageKey);
      await repository.deleteUpload(userId, upload.id);
    } catch {
      // Keep the record so quota enforcement continues to account for an object
      // that could not be confirmed deleted from storage.
    }
  }
}

async function getPrisma(): Promise<typeof PrismaSingleton> {
  const module = await import("../prisma.js");
  return module.prisma;
}

function serializeUpload(upload: any): UploadRecordResponse {
  return {
    id: upload.id,
    filename: upload.filename,
    mimeType: upload.mimeType,
    byteSize: upload.byteSize,
    storageBucket: getUploadBucket(),
    storageKey: upload.storageKey,
    documentId: upload.documentId ?? undefined,
    createdAt: upload.createdAt instanceof Date ? upload.createdAt.toISOString() : upload.createdAt
  };
}

function sanitizeFilename(filename: string): string {
  const clean = filename
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
  return clean.toLowerCase().endsWith(".pdf") ? clean : `${clean}.pdf`;
}

function estimateListeningSeconds(blocks: Array<{ text: string }>, speed: number): number {
  const words = blocks.reduce((count, block) => count + block.text.trim().split(/\s+/).filter(Boolean).length, 0);
  return Math.max(30, Math.round((words / 160) * 60 / Math.max(0.5, speed)));
}

function uploadLimitFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

class ConversionAlreadyBoundError extends Error {
  readonly name = "ConversionAlreadyBoundError";
}

/** The ReadingDocument trigger raises this while an account deletion is in progress. */
function isAccountDeletionFenceError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("ACCOUNT_DELETION_IN_PROGRESS");
}
