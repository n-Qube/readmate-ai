import type { Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { getUserId, type AuthedRequest } from "../auth.js";
import type { prisma as PrismaSingleton } from "../prisma.js";

const highlightTypes = ["sentence", "paragraph", "manual", "ai"] as const;

const createHighlightSchema = z.object({
  documentId: z.string().trim().min(1),
  blockId: z.string().trim().min(1).optional(),
  blockIndex: z.number().int().min(0),
  sentenceIndex: z.number().int().min(0).optional(),
  highlightText: z.string().trim().min(1).max(5000),
  highlightType: z.enum(highlightTypes).default("manual")
});

export type HighlightResponse = {
  id: string;
  userId: string;
  documentId: string;
  blockId?: string;
  blockIndex: number;
  sentenceIndex?: number;
  highlightText: string;
  highlightType: (typeof highlightTypes)[number];
  createdAt: string;
  updatedAt: string;
};

export type HighlightRepository = {
  listHighlights(userId: string, documentId?: string): Promise<HighlightResponse[]>;
  createHighlight(userId: string, input: z.infer<typeof createHighlightSchema>): Promise<HighlightResponse | null>;
  deleteHighlight(userId: string, highlightId: string): Promise<boolean>;
};

type HighlightsRouterDeps = {
  repository?: HighlightRepository;
};

export function highlightsRouter(deps: HighlightsRouterDeps = {}): Router {
  const router = createRouter();
  const repository = deps.repository ?? new PrismaHighlightRepository();

  router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
    res.json(await repository.listHighlights(getUserId(req), typeof req.query.documentId === "string" ? req.query.documentId : undefined));
  }));

  router.post("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const payload = createHighlightSchema.parse(req.body);
    const highlight = await repository.createHighlight(getUserId(req), payload);
    if (!highlight) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    res.status(201).json(highlight);
  }));

  router.delete("/:highlightId", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const deleted = await repository.deleteHighlight(getUserId(req), String(req.params.highlightId));
    if (!deleted) {
      res.status(404).json({ error: "Highlight not found." });
      return;
    }
    res.status(204).end();
  }));

  return router;
}

export class PrismaHighlightRepository implements HighlightRepository {
  async listHighlights(userId: string, documentId?: string): Promise<HighlightResponse[]> {
    const prisma = await getPrisma();
    const highlights = await prisma.highlight.findMany({
      where: { userId, deletedAt: null, ...(documentId ? { documentId } : {}) },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 200
    });
    return highlights.map(serializeHighlight);
  }

  async createHighlight(userId: string, input: z.infer<typeof createHighlightSchema>): Promise<HighlightResponse | null> {
    const prisma = await getPrisma();
    const document = await prisma.readingDocument.findFirst({ where: { id: input.documentId, userId, deletedAt: null }, select: { id: true } });
    if (!document) return null;
    const highlight = await prisma.highlight.create({ data: { userId, ...input } });
    return serializeHighlight(highlight);
  }

  async deleteHighlight(userId: string, highlightId: string): Promise<boolean> {
    const prisma = await getPrisma();
    const result = await prisma.highlight.updateMany({ where: { id: highlightId, userId, deletedAt: null }, data: { deletedAt: new Date() } });
    return result.count > 0;
  }
}

async function getPrisma(): Promise<typeof PrismaSingleton> {
  const module = await import("../prisma.js");
  return module.prisma;
}

function serializeHighlight(highlight: any): HighlightResponse {
  return {
    id: highlight.id,
    userId: highlight.userId,
    documentId: highlight.documentId,
    blockId: highlight.blockId ?? undefined,
    blockIndex: highlight.blockIndex,
    sentenceIndex: highlight.sentenceIndex ?? undefined,
    highlightText: highlight.highlightText,
    highlightType: highlight.highlightType,
    createdAt: toIso(highlight.createdAt),
    updatedAt: toIso(highlight.updatedAt)
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
