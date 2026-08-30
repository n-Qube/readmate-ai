import type { Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { getUserId, type AuthedRequest } from "../auth.js";
import type { prisma as PrismaSingleton } from "../prisma.js";

const documentSchema = z.object({
  title: z.string().min(1),
  sourceType: z.enum(["webpage", "selection", "pdf", "ocr", "url", "rss", "news", "document"]),
  sourceUrl: z.string().url().optional(),
  category: z.string().trim().min(1).max(80).default("Uncategorized"),
  sourceLabel: z.string().trim().min(1).max(120).optional(),
  progress: z.object({
    chunkIndex: z.number().int().min(0),
    sentenceIndex: z.number().int().min(0).default(0),
    percent: z.number().int().min(0).max(100)
  }),
  voice: z.string().min(1),
  speed: z.number().min(0.75).max(2)
});

export function historyRouter(): Router {
  const router = createRouter();

  router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const userId = getUserId(req);
    const prisma = await getPrisma();
    const documents = await prisma.readingDocument.findMany({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 50
    });
    res.json(
      documents.map((document) => ({
        id: document.id,
        userId: document.userId,
        title: document.title,
        sourceType: document.sourceType,
        sourceUrl: document.sourceUrl ?? undefined,
        category: document.category,
        sourceLabel: document.sourceLabel ?? undefined,
        createdAt: document.createdAt.toISOString(),
        updatedAt: document.updatedAt.toISOString(),
        lastReadAt: document.lastReadAt?.toISOString(),
        progress: { chunkIndex: document.chunkIndex, sentenceIndex: document.sentenceIndex, percent: document.percent },
        voice: document.voice,
        speed: document.speed
      }))
    );
  }));

  router.post("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const userId = getUserId(req);
    const prisma = await getPrisma();
    const payload = documentSchema.parse(req.body);
    const document = await prisma.readingDocument.create({
      data: {
        userId,
        title: payload.title,
        sourceType: payload.sourceType,
        sourceUrl: payload.sourceUrl,
        category: payload.category,
        sourceLabel: payload.sourceLabel,
        chunkIndex: payload.progress.chunkIndex,
        sentenceIndex: payload.progress.sentenceIndex,
        percent: payload.progress.percent,
        lastReadAt: new Date(),
        voice: payload.voice,
        speed: payload.speed
      }
    });
    res.status(201).json(document);
  }));

  router.patch("/:id/progress", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const userId = getUserId(req);
    const prisma = await getPrisma();
    const id = String(req.params.id);
    const progress = documentSchema.pick({ progress: true, voice: true, speed: true }).parse(req.body);
    await prisma.readingDocument.updateMany({
      where: { id, userId, deletedAt: null },
      data: {
        chunkIndex: progress.progress.chunkIndex,
        sentenceIndex: progress.progress.sentenceIndex,
        percent: progress.progress.percent,
        lastReadAt: new Date(),
        voice: progress.voice,
        speed: progress.speed
      }
    });
    res.status(204).end();
  }));

  router.delete("/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const userId = getUserId(req);
    const prisma = await getPrisma();
    const id = String(req.params.id);
    await prisma.readingDocument.updateMany({
      where: { id, userId, deletedAt: null },
      data: {
        chunkIndex: 0,
        characterOffset: 0,
        sentenceIndex: 0,
        percent: 0,
        lastReadAt: null
      }
    });
    res.status(204).end();
  }));

  return router;
}

async function getPrisma(): Promise<typeof PrismaSingleton> {
  const module = await import("../prisma.js");
  return module.prisma;
}
