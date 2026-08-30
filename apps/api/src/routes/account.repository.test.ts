import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn(async () => 1),
  fenceCreate: vi.fn(async () => ({ count: 1 })),
  auditDelete: vi.fn(async () => ({ count: 2 })),
  studyEffectDelete: vi.fn(async () => ({ count: 1 })),
  usageDelete: vi.fn(async () => ({ count: 1 })),
  uploadDelete: vi.fn(async () => ({ count: 3 })),
  sourceDelete: vi.fn(async () => ({ count: 4 })),
  settingsDelete: vi.fn(async () => ({ count: 1 })),
  documentDelete: vi.fn(async () => ({ count: 5 })),
  transaction: vi.fn(),
  listStorage: vi.fn(async () => ({ data: [], error: null })),
  removeStorage: vi.fn(async () => ({ data: [], error: null }))
}));

vi.mock("../prisma.js", () => ({
  ...(() => {
    const prisma = {
      $executeRaw: mocks.executeRaw,
      accountDeletionFence: { createMany: mocks.fenceCreate },
      webMcpAuditEvent: { deleteMany: mocks.auditDelete },
      webMcpStudyPackEffect: { deleteMany: mocks.studyEffectDelete },
      usageBucket: { deleteMany: mocks.usageDelete },
      uploadedFile: {
        findMany: vi.fn(async () => []),
        deleteMany: mocks.uploadDelete
      },
      sourceSubscription: { deleteMany: mocks.sourceDelete },
      userSettings: { deleteMany: mocks.settingsDelete },
      readingDocument: { deleteMany: mocks.documentDelete },
      $transaction: mocks.transaction
    };
    mocks.transaction.mockImplementation(async (operation: unknown) =>
      typeof operation === "function"
        ? (operation as (tx: typeof prisma) => Promise<unknown>)(prisma)
        : Promise.all(operation as Array<Promise<unknown>>)
    );
    return { prisma, withRlsTransaction: mocks.transaction };
  })()
}));

vi.mock("../storage.js", () => ({
  getMediaBucket: () => "media",
  getUploadBucket: () => "uploads",
  getSupabaseAdminClient: () => ({
    storage: {
      from: () => ({ list: mocks.listStorage, remove: mocks.removeStorage })
    }
  })
}));

import { PrismaAccountDeletionRepository } from "./account.js";

describe("PrismaAccountDeletionRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("installs a hashed deletion fence before deleting both WebMCP identity tables", async () => {
    const repository = new PrismaAccountDeletionRepository();

    await expect(repository.deleteAccountData("user_delete")).resolves.toEqual({
      documents: 5,
      settings: 1,
      sources: 4,
      uploads: 3
    });

    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
    expect(mocks.fenceCreate).toHaveBeenCalledWith({
      data: [{ userHash: "eee4db25aa6de6357da81a457005c2d228d75ab5ae6bd7bdc8fdf3a7b86e46b2" }],
      skipDuplicates: true
    });
    expect(JSON.stringify(mocks.fenceCreate.mock.calls)).not.toContain("user_delete");
    expect(mocks.auditDelete).toHaveBeenCalledWith({ where: { userId: "user_delete" } });
    expect(mocks.studyEffectDelete).toHaveBeenCalledWith({ where: { userId: "user_delete" } });
    expect(mocks.fenceCreate.mock.invocationCallOrder[0]).toBeLessThan(mocks.auditDelete.mock.invocationCallOrder[0]!);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.transaction.mock.calls[1]?.[0]).toHaveLength(7);
  });

  it("keeps the fence durable when cleanup fails and safely retries the remaining cleanup", async () => {
    const repository = new PrismaAccountDeletionRepository();
    mocks.listStorage.mockResolvedValueOnce({
      data: [{ id: "media_1", name: "generated.mp3", metadata: {} }],
      error: null
    });
    mocks.removeStorage.mockResolvedValueOnce({ data: null, error: { message: "storage unavailable" } });

    await expect(repository.deleteAccountData("user_delete")).rejects.toThrow("Unable to delete generated media");

    expect(mocks.fenceCreate).toHaveBeenCalledTimes(1);
    expect(mocks.auditDelete).not.toHaveBeenCalled();

    await expect(repository.deleteAccountData("user_delete")).resolves.toEqual({
      documents: 5,
      settings: 1,
      sources: 4,
      uploads: 3
    });

    expect(mocks.fenceCreate).toHaveBeenCalledTimes(2);
    expect(mocks.fenceCreate).toHaveBeenNthCalledWith(2, {
      data: [{ userHash: "eee4db25aa6de6357da81a457005c2d228d75ab5ae6bd7bdc8fdf3a7b86e46b2" }],
      skipDuplicates: true
    });
  });
});
