import { describe, expect, it } from "vitest";
import {
  PrismaWebMcpAuditRepository,
  WEBMCP_ACTION_CLAIM_LEASE_MS,
  type AuditEventDelegate,
  type ClaimWebMcpActionInput,
  type PersistedAuditEvent,
  type RecordWebMcpAuditEventInput
} from "./auditRepository.js";
import {
  AccountDeletionFencedError,
  type WebMcpWriteFenceRunner
} from "./accountDeletionFence.js";

const CLAIM_TOKEN_ONE = "1".repeat(64);
const CLAIM_TOKEN_TWO = "2".repeat(64);
const CLAIM_TOKEN_THREE = "3".repeat(64);

function createMemoryDelegate(clock: () => Date = () => new Date()) {
  const records = new Map<string, PersistedAuditEvent>();
  let nextId = 1;
  let creates = 0;
  const delegate: AuditEventDelegate = {
    async findUnique({ where }) {
      const key = compoundKey(where.userId_requestId_toolName);
      return records.get(key) ?? null;
    },
    async create({ data }) {
      creates += 1;
      const event: PersistedAuditEvent = {
        id: `audit_${nextId++}`,
        ...data,
        createdAt: new Date(clock()),
        updatedAt: new Date(clock())
      };
      if (data.requestId) {
        const key = compoundKey({ userId: data.userId, requestId: data.requestId, toolName: data.toolName });
        if (records.has(key)) throw Object.assign(new Error("unique"), { code: "P2002" });
        records.set(key, event);
      } else {
        records.set(event.id, event);
      }
      return event;
    },
    async update({ where, data }) {
      const entry = [...records.entries()].find(([, event]) => event.id === where.id);
      if (!entry) throw new Error("missing audit event");
      const [key, event] = entry;
      const updated = { ...event, ...data, updatedAt: new Date(clock()) };
      records.set(key, updated);
      return updated;
    },
    async updateMany({ where, data }) {
      const entry = [...records.entries()].find(([, event]) => {
        if (event.id !== where.id) return false;
        if (where.status !== undefined && event.status !== where.status) return false;
        if (where.actionDigest !== undefined && event.actionDigest !== where.actionDigest) return false;
        if (where.claimToken !== undefined && event.claimToken !== where.claimToken) return false;
        if (where.updatedAt !== undefined && timestamp(event.updatedAt) !== timestamp(where.updatedAt)) return false;
        return true;
      });
      if (!entry) return { count: 0 };
      const [key, event] = entry;
      records.set(key, { ...event, ...data, updatedAt: data.updatedAt ?? new Date(clock()) });
      return { count: 1 };
    }
  };
  return { delegate, records, getCreates: () => creates };
}

function actionInput(overrides: Partial<ClaimWebMcpActionInput> = {}): ClaimWebMcpActionInput {
  return {
    userId: "user_1",
    requestId: "request_12345678",
    toolName: "readmate_add_web_page",
    actionClass: "write",
    actionDigest: "c".repeat(64),
    ...overrides
  };
}

function baseInput(overrides: Partial<RecordWebMcpAuditEventInput> = {}): RecordWebMcpAuditEventInput {
  return {
    userId: "user_1",
    requestId: "request_12345678",
    toolName: "readmate_add_web_page",
    actionClass: "write",
    status: "confirmed",
    inputDigest: "a".repeat(64),
    ...overrides
  };
}

describe("PrismaWebMcpAuditRepository", () => {
  it("blocks a new audit claim once account deletion is fenced", async () => {
    const memory = createMemoryDelegate();
    const runner: WebMcpWriteFenceRunner<AuditEventDelegate> = {
      async run() {
        throw new AccountDeletionFencedError();
      }
    };
    const repository = new PrismaWebMcpAuditRepository(
      memory.delegate,
      () => new Date(),
      () => CLAIM_TOKEN_ONE,
      runner
    );

    await expect(repository.claimAction(actionInput())).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_IN_PROGRESS"
    });
    expect(memory.getCreates()).toBe(0);
  });

  it("returns the existing event for an exact idempotent retry", async () => {
    const memory = createMemoryDelegate();
    const repository = new PrismaWebMcpAuditRepository(memory.delegate);

    const first = await repository.recordEvent(baseInput());
    const retry = await repository.recordEvent(baseInput());

    expect(first).toMatchObject({ kind: "recorded", reused: false });
    expect(retry).toMatchObject({ kind: "recorded", reused: true });
    expect(retry.event.id).toBe(first.event.id);
    expect(memory.getCreates()).toBe(1);
  });

  it("recovers the winning event when concurrent inserts hit the unique key", async () => {
    const input = baseInput();
    const winner: PersistedAuditEvent = {
      id: "audit_winner",
      userId: input.userId,
      requestId: input.requestId ?? null,
      toolName: input.toolName,
      actionClass: input.actionClass,
      status: input.status,
      resourceType: null,
      resourceId: null,
      inputDigest: input.inputDigest ?? null,
      actionDigest: null,
      claimToken: null,
      errorCode: null,
      latencyMs: null,
      createdAt: new Date("2026-08-29T12:00:00.000Z"),
      updatedAt: new Date("2026-08-29T12:00:00.000Z")
    };
    let findCount = 0;
    const delegate: AuditEventDelegate = {
      async findUnique() {
        findCount += 1;
        return findCount === 1 ? null : winner;
      },
      async create() {
        throw Object.assign(new Error("unique"), { code: "P2002" });
      },
      async update() {
        throw new Error("an exact retry must not update the winning row");
      },
      async updateMany() {
        throw new Error("an exact retry must not claim the winning row");
      }
    };

    const result = await new PrismaWebMcpAuditRepository(delegate).recordEvent(input);
    expect(result).toMatchObject({ kind: "recorded", reused: true, event: { id: "audit_winner" } });
    expect(findCount).toBe(2);
  });

  it("advances a confirmed operation to one terminal outcome without creating a second event", async () => {
    const memory = createMemoryDelegate();
    const repository = new PrismaWebMcpAuditRepository(memory.delegate);
    const confirmed = await repository.recordEvent(baseInput());
    const succeeded = await repository.recordEvent(baseInput({
      status: "succeeded",
      resourceType: "document",
      resourceId: "doc_123",
      latencyMs: 420
    }));
    const lateFailure = await repository.recordEvent(baseInput({ status: "failed", errorCode: "NETWORK_TIMEOUT" }));

    expect(succeeded).toMatchObject({
      kind: "recorded",
      reused: true,
      event: { id: confirmed.event.id, status: "succeeded", resourceId: "doc_123", latencyMs: 420 }
    });
    expect(lateFailure).toMatchObject({ kind: "recorded", reused: true, event: { status: "succeeded" } });
    expect(memory.getCreates()).toBe(1);
  });

  it("rejects reuse of a request ID with a different canonical input or resource", async () => {
    const memory = createMemoryDelegate();
    const repository = new PrismaWebMcpAuditRepository(memory.delegate);
    await repository.recordEvent(baseInput({ resourceType: "document", resourceId: "doc_123" }));

    const changedInput = await repository.recordEvent(baseInput({ inputDigest: "b".repeat(64) }));
    const changedResource = await repository.recordEvent(baseInput({ resourceType: "document", resourceId: "doc_456" }));

    expect(changedInput.kind).toBe("conflict");
    expect(changedResource.kind).toBe("conflict");
    expect(memory.getCreates()).toBe(1);
  });

  it("scopes uniqueness by user and tool, while unkeyed read events remain append-only", async () => {
    const memory = createMemoryDelegate();
    const repository = new PrismaWebMcpAuditRepository(memory.delegate);

    const first = await repository.recordEvent(baseInput());
    const otherUser = await repository.recordEvent(baseInput({ userId: "user_2" }));
    const otherTool = await repository.recordEvent({
      ...baseInput(),
      toolName: "readmate_subscribe_rss"
    });
    const readOne = await repository.recordEvent({
      userId: "user_1",
      toolName: "readmate_search_library",
      actionClass: "read",
      status: "succeeded"
    });
    const readTwo = await repository.recordEvent({
      userId: "user_1",
      toolName: "readmate_search_library",
      actionClass: "read",
      status: "succeeded"
    });

    expect(new Set([first.event.id, otherUser.event.id, otherTool.event.id, readOne.event.id, readTwo.event.id]).size).toBe(5);
  });

  it("atomically claims a confirmed action and reports its duplicate as in progress", async () => {
    const memory = createMemoryDelegate();
    const repository = new PrismaWebMcpAuditRepository(memory.delegate);
    const confirmed = await repository.recordEvent(baseInput());

    const [first, duplicate] = await Promise.all([
      repository.claimAction(actionInput()),
      repository.claimAction(actionInput())
    ]);

    expect([first.kind, duplicate.kind].sort()).toEqual(["execute", "in_progress"]);
    expect(first.event.id).toBe(confirmed.event.id);
    expect(duplicate.event.id).toBe(confirmed.event.id);
    expect(first.event).toMatchObject({ status: "started", actionDigest: "c".repeat(64) });
    expect(duplicate.event).toMatchObject({ status: "started", actionDigest: "c".repeat(64) });
    const executor = first.kind === "execute" ? first : duplicate.kind === "execute" ? duplicate : undefined;
    const observer = first.kind === "in_progress" ? first : duplicate.kind === "in_progress" ? duplicate : undefined;
    expect(executor?.event.claimToken).toMatch(/^[0-9a-f]{64}$/);
    expect(observer?.event).not.toHaveProperty("claimToken");
    expect(memory.getCreates()).toBe(1);
  });

  it("allows only one executor when concurrent claims race to create the audit row", async () => {
    const memory = createMemoryDelegate();
    const repository = new PrismaWebMcpAuditRepository(memory.delegate);

    const results = await Promise.all([
      repository.claimAction(actionInput()),
      repository.claimAction(actionInput())
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual(["execute", "in_progress"]);
    expect(results[0].event.id).toBe(results[1].event.id);
    expect(memory.getCreates()).toBe(2);
  });

  it("replays a succeeded action and never regresses started back to confirmed", async () => {
    const memory = createMemoryDelegate();
    const repository = new PrismaWebMcpAuditRepository(memory.delegate);

    const claimed = await repository.claimAction(actionInput());
    if (claimed.kind !== "execute") throw new Error("expected an executable claim");
    const lateConfirmation = await repository.recordEvent(baseInput());
    const succeeded = await repository.recordEvent(baseInput({
      status: "succeeded",
      actionDigest: actionInput().actionDigest,
      claimToken: claimed.event.claimToken,
      resourceType: "document",
      resourceId: "doc_123"
    }));
    const replay = await repository.claimAction(actionInput());

    expect(claimed.kind).toBe("execute");
    expect(lateConfirmation).toMatchObject({ kind: "recorded", event: { status: "started" } });
    expect(succeeded).toMatchObject({ kind: "recorded", event: { status: "succeeded" } });
    expect([...memory.records.values()][0].claimToken).toBeNull();
    expect(replay).toMatchObject({
      kind: "replay",
      event: { id: claimed.event.id, resourceType: "document", resourceId: "doc_123" }
    });
  });

  it("does not let a duplicate client failure terminate an action owned by the mutation route", async () => {
    let currentTime = new Date("2026-08-29T12:00:00.000Z");
    const clock = () => new Date(currentTime);
    const memory = createMemoryDelegate(clock);
    const repository = new PrismaWebMcpAuditRepository(memory.delegate, clock);
    const claimed = await repository.claimAction(actionInput());
    if (claimed.kind !== "execute") throw new Error("expected an executable claim");
    const originalUpdatedAt = timestamp([...memory.records.values()][0].updatedAt);
    currentTime = new Date(currentTime.getTime() + 60_000);

    const duplicateFailure = await repository.recordEvent(baseInput({
      status: "failed",
      errorCode: "CONFLICT",
      resourceType: "document",
      resourceId: "doc_untrusted",
      latencyMs: 10
    }));
    expect(claimed).toMatchObject({ kind: "execute", event: { status: "started" } });
    expect(duplicateFailure).toMatchObject({ kind: "recorded", event: { status: "started" } });
    expect(duplicateFailure.event.resourceType).toBeUndefined();
    expect(duplicateFailure.event.resourceId).toBeUndefined();
    expect(duplicateFailure.event.inputDigest).toBeUndefined();
    expect(duplicateFailure.event.latencyMs).toBeUndefined();
    expect(timestamp([...memory.records.values()][0].updatedAt)).toBe(originalUpdatedAt);

    const completed = await repository.recordEvent(baseInput({
      status: "succeeded",
      actionDigest: actionInput().actionDigest,
      claimToken: claimed.event.claimToken,
      resourceType: "document",
      resourceId: "doc_123"
    }));
    expect(completed).toMatchObject({
      kind: "recorded",
      event: { status: "succeeded", resourceId: "doc_123" }
    });
  });

  it("uses compare-and-set so a racing external event cannot overwrite a new claim", async () => {
    const memory = createMemoryDelegate();
    const repository = new PrismaWebMcpAuditRepository(memory.delegate);
    await repository.recordEvent(baseInput());

    const [claim, externalCompletion] = await Promise.all([
      repository.claimAction(actionInput()),
      repository.recordEvent(baseInput({
        status: "succeeded",
        resourceType: "document",
        resourceId: "doc_untrusted"
      }))
    ]);

    expect(claim.kind).toBe("execute");
    expect(externalCompletion).toMatchObject({ kind: "recorded", event: { status: "started" } });
    expect(externalCompletion.event.resourceId).toBeUndefined();
  });

  it("rejects action request-ID reuse with a different canonical action digest", async () => {
    const memory = createMemoryDelegate();
    const repository = new PrismaWebMcpAuditRepository(memory.delegate);
    await repository.recordEvent(baseInput());

    const first = await repository.claimAction(actionInput());
    const conflict = await repository.claimAction(actionInput({ actionDigest: "d".repeat(64) }));

    expect(first.kind).toBe("execute");
    expect(conflict).toMatchObject({ kind: "conflict", event: { actionDigest: "c".repeat(64) } });
  });

  it.each([
    ["failed", "failed"],
    ["cancelled", "cancelled"]
  ] as const)("classifies a terminal %s action without executing it again", async (status, expectedKind) => {
    const memory = createMemoryDelegate();
    const repository = new PrismaWebMcpAuditRepository(memory.delegate);
    const claimed = await repository.claimAction(actionInput());
    if (claimed.kind !== "execute") throw new Error("expected an executable claim");
    await repository.recordEvent(baseInput({
      status,
      actionDigest: actionInput().actionDigest,
      claimToken: claimed.event.claimToken,
      ...(status === "failed" ? { errorCode: "PROVIDER_UNAVAILABLE" } : {})
    }));

    const retry = await repository.claimAction(actionInput());
    expect(retry.kind).toBe(expectedKind);
  });

  it("fails closed when a legacy terminal row has no action digest", async () => {
    const memory = createMemoryDelegate();
    const repository = new PrismaWebMcpAuditRepository(memory.delegate);
    await repository.recordEvent(baseInput({
      status: "succeeded",
      resourceType: "document",
      resourceId: "doc_legacy"
    }));

    const result = await repository.claimAction(actionInput());
    expect(result.kind).toBe("conflict");
  });

  it("rejects a pre-claim row that already contains resource fields", async () => {
    const memory = createMemoryDelegate();
    const repository = new PrismaWebMcpAuditRepository(memory.delegate);
    await repository.recordEvent(baseInput({ resourceType: "document", resourceId: "doc_untrusted" }));

    const result = await repository.claimAction(actionInput());
    expect(result).toMatchObject({
      kind: "conflict",
      event: { status: "confirmed", resourceId: "doc_untrusted" }
    });
  });

  it("keeps a fresh started claim in progress during its five-minute lease", async () => {
    let currentTime = new Date("2026-08-29T12:00:00.000Z");
    const clock = () => new Date(currentTime);
    const memory = createMemoryDelegate(clock);
    const repository = new PrismaWebMcpAuditRepository(memory.delegate, clock);
    await repository.claimAction(actionInput());
    currentTime = new Date(currentTime.getTime() + WEBMCP_ACTION_CLAIM_LEASE_MS - 1);

    const result = await repository.claimAction(actionInput());
    expect(result.kind).toBe("in_progress");
  });

  it("atomically recovers a started claim after its five-minute lease expires", async () => {
    let currentTime = new Date("2026-08-29T12:00:00.000Z");
    const clock = () => new Date(currentTime);
    const memory = createMemoryDelegate(clock);
    const repository = new PrismaWebMcpAuditRepository(
      memory.delegate,
      clock,
      sequentialClaimTokens(CLAIM_TOKEN_ONE, CLAIM_TOKEN_TWO)
    );
    const first = await repository.claimAction(actionInput());
    currentTime = new Date(currentTime.getTime() + WEBMCP_ACTION_CLAIM_LEASE_MS);

    const recovered = await repository.claimAction(actionInput());
    const duplicate = await repository.claimAction(actionInput());

    expect(first.kind).toBe("execute");
    expect(recovered).toMatchObject({ kind: "execute", event: { id: first.event.id } });
    expect(duplicate).toMatchObject({ kind: "in_progress", event: { id: first.event.id } });
    if (first.kind !== "execute" || recovered.kind !== "execute") throw new Error("expected executable claims");
    expect(first.event.claimToken).toBe(CLAIM_TOKEN_ONE);
    expect(recovered.event.claimToken).toBe(CLAIM_TOKEN_TWO);
    expect(duplicate.event).not.toHaveProperty("claimToken");
    const persisted = [...memory.records.values()][0];
    expect(timestamp(persisted.updatedAt)).toBe(currentTime.getTime());
  });

  it("allows only one executor when concurrent retries recover a stale claim", async () => {
    let currentTime = new Date("2026-08-29T12:00:00.000Z");
    const clock = () => new Date(currentTime);
    const memory = createMemoryDelegate(clock);
    const repository = new PrismaWebMcpAuditRepository(memory.delegate, clock);
    await repository.claimAction(actionInput());
    currentTime = new Date(currentTime.getTime() + WEBMCP_ACTION_CLAIM_LEASE_MS + 1);

    const results = await Promise.all([
      repository.claimAction(actionInput()),
      repository.claimAction(actionInput())
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual(["execute", "in_progress"]);
  });

  it("never leases a stale claim to a different canonical action digest", async () => {
    let currentTime = new Date("2026-08-29T12:00:00.000Z");
    const clock = () => new Date(currentTime);
    const memory = createMemoryDelegate(clock);
    const repository = new PrismaWebMcpAuditRepository(memory.delegate, clock);
    await repository.claimAction(actionInput());
    currentTime = new Date(currentTime.getTime() + WEBMCP_ACTION_CLAIM_LEASE_MS + 1);

    const result = await repository.claimAction(actionInput({ actionDigest: "d".repeat(64) }));
    expect(result.kind).toBe("conflict");
  });

  it("fences a stale executor after a retry reclaims the expired action", async () => {
    let currentTime = new Date("2026-08-29T12:00:00.000Z");
    const clock = () => new Date(currentTime);
    const memory = createMemoryDelegate(clock);
    const repository = new PrismaWebMcpAuditRepository(
      memory.delegate,
      clock,
      sequentialClaimTokens(CLAIM_TOKEN_ONE, CLAIM_TOKEN_TWO)
    );
    const staleExecutor = await repository.claimAction(actionInput());
    if (staleExecutor.kind !== "execute") throw new Error("expected the initial executor");
    currentTime = new Date(currentTime.getTime() + WEBMCP_ACTION_CLAIM_LEASE_MS);
    const currentExecutor = await repository.claimAction(actionInput());
    if (currentExecutor.kind !== "execute") throw new Error("expected the recovery executor");

    const staleCompletion = await repository.recordEvent(baseInput({
      status: "succeeded",
      actionDigest: actionInput().actionDigest,
      claimToken: staleExecutor.event.claimToken,
      resourceType: "document",
      resourceId: "doc_stale"
    }));
    const staleFailure = await repository.recordEvent(baseInput({
      status: "failed",
      actionDigest: actionInput().actionDigest,
      claimToken: staleExecutor.event.claimToken,
      errorCode: "STALE_EXECUTOR"
    }));

    expect(staleExecutor.event.claimToken).toBe(CLAIM_TOKEN_ONE);
    expect(currentExecutor.event.claimToken).toBe(CLAIM_TOKEN_TWO);
    expect(staleCompletion).toMatchObject({ kind: "conflict", event: { status: "started" } });
    expect(staleFailure).toMatchObject({ kind: "conflict", event: { status: "started" } });

    const currentCompletion = await repository.recordEvent(baseInput({
      status: "succeeded",
      actionDigest: actionInput().actionDigest,
      claimToken: currentExecutor.event.claimToken,
      resourceType: "document",
      resourceId: "doc_current"
    }));
    expect(currentCompletion).toMatchObject({
      kind: "recorded",
      event: { status: "succeeded", resourceId: "doc_current" }
    });
    expect([...memory.records.values()][0].claimToken).toBeNull();
  });

  it("fails closed when an injected claim token is not a 256-bit lowercase hex value", async () => {
    const memory = createMemoryDelegate();
    const repository = new PrismaWebMcpAuditRepository(memory.delegate, () => new Date(), () => "predictable");

    await expect(repository.claimAction(actionInput())).rejects.toThrow("claim token generation failed");
  });
});

function compoundKey(value: { userId: string; requestId: string; toolName: string }): string {
  return `${value.userId}\u0000${value.requestId}\u0000${value.toolName}`;
}

function timestamp(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

function sequentialClaimTokens(...tokens: string[]): () => string {
  let index = 0;
  return () => tokens[index++] ?? CLAIM_TOKEN_THREE;
}
