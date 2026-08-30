import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { AuthedRequest } from "../auth.js";
import { notesRouter, type NoteRepository, type NoteResponse } from "./notes.js";

function createTestApp(repository: NoteRepository) {
  const app = express();
  app.use(express.json());
  app.use((req: AuthedRequest, _res, next) => {
    req.userId = String(req.header("x-test-user") ?? "owner");
    next();
  });
  app.use("/api/notes", notesRouter({ repository }));
  return app;
}

function createMemoryNoteRepository(): NoteRepository {
  const documents = new Map([["doc_1", "owner"]]);
  const notes = new Map<string, NoteResponse & { deleted?: boolean }>();
  let nextId = 1;
  const now = "2026-05-27T12:00:00.000Z";
  return {
    async listNotes(userId, documentId) {
      return [...notes.values()].filter((note) => !note.deleted && note.userId === userId && (!documentId || note.documentId === documentId));
    },
    async createNote(userId, input) {
      if (documents.get(input.documentId) !== userId) return null;
      const note = {
        id: `note_${nextId++}`,
        userId,
        documentId: input.documentId,
        highlightId: input.highlightId,
        noteText: input.noteText,
        blockIndex: input.blockIndex,
        sentenceIndex: input.sentenceIndex,
        createdAt: now,
        updatedAt: now
      };
      notes.set(note.id, note);
      return note;
    },
    async updateNote(userId, noteId, input) {
      const note = notes.get(noteId);
      if (!note || note.deleted || note.userId !== userId) return null;
      const updated = { ...note, noteText: input.noteText, updatedAt: "2026-05-27T12:01:00.000Z" };
      notes.set(noteId, updated);
      return updated;
    },
    async deleteNote(userId, noteId) {
      const note = notes.get(noteId);
      if (!note || note.deleted || note.userId !== userId) return false;
      notes.set(noteId, { ...note, deleted: true });
      return true;
    }
  };
}

describe("notesRouter", () => {
  let repository: NoteRepository;

  beforeEach(() => {
    repository = createMemoryNoteRepository();
  });

  it("creates, lists, updates, and deletes notes for owned documents", async () => {
    const app = createTestApp(repository);

    const created = await request(app)
      .post("/api/notes")
      .set("x-test-user", "owner")
      .send({ documentId: "doc_1", noteText: "Remember this paragraph.", blockIndex: 1, sentenceIndex: 0 })
      .expect(201);

    expect(created.body).toMatchObject({ documentId: "doc_1", noteText: "Remember this paragraph.", blockIndex: 1, sentenceIndex: 0 });

    const listed = await request(app).get("/api/notes?documentId=doc_1").set("x-test-user", "owner").expect(200);
    expect(listed.body).toHaveLength(1);

    const updated = await request(app)
      .patch(`/api/notes/${created.body.id}`)
      .set("x-test-user", "owner")
      .send({ noteText: "Updated note." })
      .expect(200);
    expect(updated.body.noteText).toBe("Updated note.");

    await request(app).delete(`/api/notes/${created.body.id}`).set("x-test-user", "owner").expect(204);
    const afterDelete = await request(app).get("/api/notes?documentId=doc_1").set("x-test-user", "owner").expect(200);
    expect(afterDelete.body).toEqual([]);
  });

  it("rejects notes for documents owned by another user", async () => {
    const app = createTestApp(repository);

    await request(app)
      .post("/api/notes")
      .set("x-test-user", "other")
      .send({ documentId: "doc_1", noteText: "Not mine." })
      .expect(404);
  });
});
