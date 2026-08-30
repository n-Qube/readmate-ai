import { describe, expect, it, vi } from "vitest";
import type { prisma as PrismaSingleton } from "../prisma.js";
import type { CreateDocumentInput, DocumentRepository } from "./documents.js";
import {
  createTrackedRssDocument,
  TrackedRssDocumentHydrationError
} from "./sources.js";

const input: CreateDocumentInput = {
  title: "New RSS story",
  sourceType: "rss",
  category: "News",
  provider: "google",
  voice: "en-US-Neural2-F",
  speed: 1,
  progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 },
  blocks: [{ blockType: "paragraph", text: "A readable RSS story for hydration rollback testing." }]
};

function createPrismaDouble(deleteCreated: () => Promise<unknown>) {
  const deleteMany = vi.fn(deleteCreated);
  const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) => operation({
    readingDocument: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "rss_document_new" })),
      deleteMany: vi.fn(async () => ({ count: 0 }))
    }
  }));
  return {
    prisma: {
      $transaction: transaction,
      readingDocument: {
        findFirst: vi.fn(async () => null),
        deleteMany
      }
    } as unknown as typeof PrismaSingleton,
    deleteMany
  };
}

const unavailableDocumentRepository = {
  getDocument: vi.fn(async () => null)
} as unknown as DocumentRepository;

describe("createTrackedRssDocument hydration compensation", () => {
  it("deletes the exact newly inserted row when post-transaction hydration fails", async () => {
    const { prisma, deleteMany } = createPrismaDouble(async () => ({ count: 1 }));

    await expect(createTrackedRssDocument(
      prisma,
      unavailableDocumentRepository,
      "reader_1",
      input
    )).rejects.toThrow("The imported RSS document could not be loaded.");

    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: "rss_document_new", userId: "reader_1" }
    });
  });

  it("exposes the created ID when immediate cleanup fails so outer compensation can retry", async () => {
    const { prisma } = createPrismaDouble(async () => {
      throw new Error("database temporarily unavailable");
    });

    const error = await createTrackedRssDocument(
      prisma,
      unavailableDocumentRepository,
      "reader_1",
      input
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TrackedRssDocumentHydrationError);
    expect((error as TrackedRssDocumentHydrationError).createdDocumentId).toBe("rss_document_new");
  });
});
