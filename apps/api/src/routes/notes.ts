import type { Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { getUserId, type AuthedRequest } from "../auth.js";
import type { prisma as PrismaSingleton } from "../prisma.js";

const createNoteSchema = z.object({
  documentId: z.string().trim().min(1),
  highlightId: z.string().trim().min(1).optional(),
  noteText: z.string().trim().min(1).max(5000),
  blockIndex: z.number().int().min(0).optional(),
  sentenceIndex: z.number().int().min(0).optional()
});

const updateNoteSchema = z.object({
  noteText: z.string().trim().min(1).max(5000)
});

export type NoteResponse = {
  id: string;
  userId: string;
  documentId: string;
  highlightId?: string;
  noteText: string;
  blockIndex?: number;
  sentenceIndex?: number;
  createdAt: string;
  updatedAt: string;
};

export type NoteRepository = {
  listNotes(userId: string, documentId?: string): Promise<NoteResponse[]>;
  createNote(userId: string, input: z.infer<typeof createNoteSchema>): Promise<NoteResponse | null>;
  updateNote(userId: string, noteId: string, input: z.infer<typeof updateNoteSchema>): Promise<NoteResponse | null>;
  deleteNote(userId: string, noteId: string): Promise<boolean>;
};

type NotesRouterDeps = {
  repository?: NoteRepository;
};

export function notesRouter(deps: NotesRouterDeps = {}): Router {
  const router = createRouter();
  const repository = deps.repository ?? new PrismaNoteRepository();

  router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
    res.json(await repository.listNotes(getUserId(req), typeof req.query.documentId === "string" ? req.query.documentId : undefined));
  }));

  router.post("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const payload = createNoteSchema.parse(req.body);
    const note = await repository.createNote(getUserId(req), payload);
    if (!note) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    res.status(201).json(note);
  }));

  router.patch("/:noteId", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const payload = updateNoteSchema.parse(req.body);
    const note = await repository.updateNote(getUserId(req), String(req.params.noteId), payload);
    if (!note) {
      res.status(404).json({ error: "Note not found." });
      return;
    }
    res.json(note);
  }));

  router.delete("/:noteId", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const deleted = await repository.deleteNote(getUserId(req), String(req.params.noteId));
    if (!deleted) {
      res.status(404).json({ error: "Note not found." });
      return;
    }
    res.status(204).end();
  }));

  return router;
}

export class PrismaNoteRepository implements NoteRepository {
  async listNotes(userId: string, documentId?: string): Promise<NoteResponse[]> {
    const prisma = await getPrisma();
    const notes = await prisma.note.findMany({
      where: { userId, deletedAt: null, ...(documentId ? { documentId } : {}) },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 200
    });
    return notes.map(serializeNote);
  }

  async createNote(userId: string, input: z.infer<typeof createNoteSchema>): Promise<NoteResponse | null> {
    const prisma = await getPrisma();
    const document = await prisma.readingDocument.findFirst({ where: { id: input.documentId, userId, deletedAt: null }, select: { id: true } });
    if (!document) return null;
    if (input.highlightId) {
      const highlight = await prisma.highlight.findFirst({ where: { id: input.highlightId, userId, documentId: input.documentId, deletedAt: null }, select: { id: true } });
      if (!highlight) return null;
    }
    const note = await prisma.note.create({ data: { userId, ...input } });
    return serializeNote(note);
  }

  async updateNote(userId: string, noteId: string, input: z.infer<typeof updateNoteSchema>): Promise<NoteResponse | null> {
    const prisma = await getPrisma();
    const existing = await prisma.note.findFirst({ where: { id: noteId, userId, deletedAt: null }, select: { id: true } });
    if (!existing) return null;
    const note = await prisma.note.update({ where: { id: noteId }, data: { noteText: input.noteText } });
    return serializeNote(note);
  }

  async deleteNote(userId: string, noteId: string): Promise<boolean> {
    const prisma = await getPrisma();
    const result = await prisma.note.updateMany({ where: { id: noteId, userId, deletedAt: null }, data: { deletedAt: new Date() } });
    return result.count > 0;
  }
}

async function getPrisma(): Promise<typeof PrismaSingleton> {
  const module = await import("../prisma.js");
  return module.prisma;
}

function serializeNote(note: any): NoteResponse {
  return {
    id: note.id,
    userId: note.userId,
    documentId: note.documentId,
    highlightId: note.highlightId ?? undefined,
    noteText: note.noteText,
    blockIndex: note.blockIndex ?? undefined,
    sentenceIndex: note.sentenceIndex ?? undefined,
    createdAt: toIso(note.createdAt),
    updatedAt: toIso(note.updatedAt)
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
