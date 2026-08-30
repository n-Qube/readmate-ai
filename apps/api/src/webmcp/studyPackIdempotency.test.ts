import { describe, expect, it } from "vitest";
import {
  PrismaStudyPackEffectRepository,
  type PersistedStudyPackEffect,
  type StudyPackEffectDelegate
} from "./studyPackIdempotency.js";
import {
  AccountDeletionFencedError,
  type WebMcpWriteFenceRunner
} from "./accountDeletionFence.js";

function createMemoryDelegate() {
  const records = new Map<string, PersistedStudyPackEffect>();
  let creates = 0;
  const delegate: StudyPackEffectDelegate = {
    async findUnique({ where }) {
      return records.get(key(where.userId_requestId.userId, where.userId_requestId.requestId)) ?? null;
    },
    async create({ data }) {
      creates += 1;
      const recordKey = key(data.userId, data.requestId);
      if (records.has(recordKey)) throw Object.assign(new Error("unique"), { code: "P2002" });
      const record: PersistedStudyPackEffect = {
        id: `effect_${creates}`,
        ...data,
        createdAt: "2026-08-29T12:00:00.000Z",
        updatedAt: "2026-08-29T12:00:00.000Z"
      };
      records.set(recordKey, record);
      return record;
    },
    async updateMany({ where, data }) {
      const entry = [...records.entries()].find(([, record]) =>
        record.id === where.id &&
        record.status === where.status &&
        record.actionDigest === where.actionDigest &&
        record.documentId === where.documentId
      );
      if (!entry) return { count: 0 };
      const [recordKey, record] = entry;
      records.set(recordKey, { ...record, ...data, updatedAt: "2026-08-29T12:01:00.000Z" });
      return { count: 1 };
    }
  };
  return { delegate, records, getCreates: () => creates };
}

function input(overrides: Partial<Parameters<PrismaStudyPackEffectRepository["claim"]>[0]> = {}) {
  return {
    userId: "user_1",
    requestId: "study-request-001",
    actionDigest: "a".repeat(64),
    documentId: "doc_1",
    ...overrides
  };
}

describe("PrismaStudyPackEffectRepository", () => {
  it("blocks a new study-pack effect once account deletion is fenced", async () => {
    const memory = createMemoryDelegate();
    const runner: WebMcpWriteFenceRunner<StudyPackEffectDelegate> = {
      async run() {
        throw new AccountDeletionFencedError();
      }
    };
    const repository = new PrismaStudyPackEffectRepository(memory.delegate, runner);

    await expect(repository.claim(input())).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_IN_PROGRESS"
    });
    expect(memory.getCreates()).toBe(0);
  });

  it("allows one paid side-effect executor and keeps exact retries in progress", async () => {
    const memory = createMemoryDelegate();
    const repository = new PrismaStudyPackEffectRepository(memory.delegate);

    const [first, duplicate] = await Promise.all([repository.claim(input()), repository.claim(input())]);

    expect([first.kind, duplicate.kind].sort()).toEqual(["execute", "in_progress"]);
    expect(first.effect.id).toBe(duplicate.effect.id);
    expect(memory.records.size).toBe(1);
  });

  it("never reclaims an unfinished paid side effect, regardless of its age", async () => {
    const memory = createMemoryDelegate();
    const repository = new PrismaStudyPackEffectRepository(memory.delegate);
    const first = await repository.claim(input());
    expect(first.kind).toBe("execute");
    const record = [...memory.records.values()][0]!;
    record.updatedAt = "2020-01-01T00:00:00.000Z";

    const retry = await repository.claim(input());

    expect(retry.kind).toBe("in_progress");
    expect(memory.getCreates()).toBe(1);
  });

  it("replays a completed effect without creating another resource operation", async () => {
    const memory = createMemoryDelegate();
    const repository = new PrismaStudyPackEffectRepository(memory.delegate);
    const first = await repository.claim(input());
    if (first.kind !== "execute") throw new Error("Expected first execution.");
    await repository.complete(first.effect);

    const replay = await repository.claim(input());

    expect(replay).toMatchObject({ kind: "replay", effect: { documentId: "doc_1", status: "succeeded" } });
    expect(memory.getCreates()).toBe(1);
  });

  it("rejects changed action input or target resources for the same request ID", async () => {
    const memory = createMemoryDelegate();
    const repository = new PrismaStudyPackEffectRepository(memory.delegate);
    await repository.claim(input());

    expect(await repository.claim(input({ actionDigest: "b".repeat(64) }))).toMatchObject({ kind: "conflict" });
    expect(await repository.claim(input({ documentId: "doc_2" }))).toMatchObject({ kind: "conflict" });
    expect(memory.getCreates()).toBe(1);
  });
});

function key(userId: string, requestId: string): string {
  return `${userId}:${requestId}`;
}
