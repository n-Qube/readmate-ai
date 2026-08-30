import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn(async () => 1),
  findFence: vi.fn(async () => ({ userHash: "fenced" })),
  transaction: vi.fn()
}));

vi.mock("../prisma.js", () => ({
  ...(() => {
    const transaction = {
      $executeRaw: mocks.executeRaw,
      accountDeletionFence: { findUnique: mocks.findFence }
    };
    mocks.transaction.mockImplementation(async (operation: (tx: typeof transaction) => Promise<unknown>) =>
      operation(transaction)
    );
    return { withRlsTransaction: mocks.transaction };
  })()
}));

import {
  isAccountDeletionFencedError,
  withAccountDeletionWriteFence
} from "./accountDeletionFence.js";

describe("withAccountDeletionWriteFence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("locks and rejects a fenced user before invoking a persistence mutation", async () => {
    const operation = vi.fn(async () => "written");

    await expect(withAccountDeletionWriteFence("user_delete", operation)).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_IN_PROGRESS"
    });

    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
    expect(mocks.findFence).toHaveBeenCalledWith({
      where: { userHash: "eee4db25aa6de6357da81a457005c2d228d75ab5ae6bd7bdc8fdf3a7b86e46b2" },
      select: { userHash: true }
    });
    expect(mocks.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.findFence.mock.invocationCallOrder[0]!);
    expect(operation).not.toHaveBeenCalled();
  });

  it("preserves ordinary persistence when no deletion fence exists", async () => {
    mocks.findFence.mockResolvedValueOnce(null);
    const operation = vi.fn(async () => "written");

    await expect(withAccountDeletionWriteFence("user_active", operation)).resolves.toBe("written");

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("recognizes a database-trigger rejection as the same public fence error", () => {
    expect(isAccountDeletionFencedError(
      new Error("Prisma write failed: ACCOUNT_DELETION_IN_PROGRESS")
    )).toBe(true);
  });

  it("atomically fences WebMCP metadata and stale business writes in the migration", () => {
    const migration = readFileSync(
      new URL("../../prisma/migrations/20260829150000_account_deletion_fence/migration.sql", import.meta.url),
      "utf8"
    );

    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("sha256(convert_to(NEW.\"userId\", 'UTF8'))");
    for (const table of [
      "WebMcpAuditEvent",
      "WebMcpStudyPackEffect",
      "ReadingDocument",
      "SourceSubscription",
      "UsageBucket",
      "UserSettings",
      "LearningFlashcard",
      "LearningQuizQuestion"
    ]) {
      expect(migration).toContain(`BEFORE INSERT OR UPDATE ON \"${table}\"`);
    }
  });
});
