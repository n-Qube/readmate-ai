import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { AuthedRequest } from "../auth.js";
import { highlightsRouter, type HighlightRepository, type HighlightResponse } from "./highlights.js";

function createTestApp(repository: HighlightRepository) {
  const app = express();
  app.use(express.json());
  app.use((req: AuthedRequest, _res, next) => {
    req.userId = String(req.header("x-test-user") ?? "owner");
    next();
  });
  app.use("/api/highlights", highlightsRouter({ repository }));
  return app;
}

function createMemoryHighlightRepository(): HighlightRepository {
  const documents = new Map([["doc_1", "owner"]]);
  const highlights = new Map<string, HighlightResponse & { deleted?: boolean }>();
  let nextId = 1;
  const now = "2026-05-27T12:00:00.000Z";
  return {
    async listHighlights(userId, documentId) {
      return [...highlights.values()].filter((highlight) => !highlight.deleted && highlight.userId === userId && (!documentId || highlight.documentId === documentId));
    },
    async createHighlight(userId, input) {
      if (documents.get(input.documentId) !== userId) return null;
      const highlight = {
        id: `highlight_${nextId++}`,
        userId,
        documentId: input.documentId,
        blockId: input.blockId,
        blockIndex: input.blockIndex,
        sentenceIndex: input.sentenceIndex,
        highlightText: input.highlightText,
        highlightType: input.highlightType,
        createdAt: now,
        updatedAt: now
      };
      highlights.set(highlight.id, highlight);
      return highlight;
    },
    async deleteHighlight(userId, highlightId) {
      const highlight = highlights.get(highlightId);
      if (!highlight || highlight.deleted || highlight.userId !== userId) return false;
      highlights.set(highlightId, { ...highlight, deleted: true });
      return true;
    }
  };
}

describe("highlightsRouter", () => {
  let repository: HighlightRepository;

  beforeEach(() => {
    repository = createMemoryHighlightRepository();
  });

  it("creates, lists, and deletes highlights for owned documents", async () => {
    const app = createTestApp(repository);

    const created = await request(app)
      .post("/api/highlights")
      .set("x-test-user", "owner")
      .send({
        documentId: "doc_1",
        blockId: "block_1",
        blockIndex: 1,
        sentenceIndex: 0,
        highlightText: "Important sentence.",
        highlightType: "sentence"
      })
      .expect(201);

    expect(created.body).toMatchObject({ documentId: "doc_1", blockIndex: 1, sentenceIndex: 0, highlightType: "sentence" });

    const listed = await request(app).get("/api/highlights?documentId=doc_1").set("x-test-user", "owner").expect(200);
    expect(listed.body).toHaveLength(1);

    await request(app).delete(`/api/highlights/${created.body.id}`).set("x-test-user", "owner").expect(204);
    const afterDelete = await request(app).get("/api/highlights?documentId=doc_1").set("x-test-user", "owner").expect(200);
    expect(afterDelete.body).toEqual([]);
  });

  it("rejects highlights for documents owned by another user", async () => {
    const app = createTestApp(repository);

    await request(app)
      .post("/api/highlights")
      .set("x-test-user", "other")
      .send({ documentId: "doc_1", blockIndex: 0, highlightText: "Not mine.", highlightType: "manual" })
      .expect(404);
  });
});
