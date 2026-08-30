import { randomBytes } from "node:crypto";
import type {
  WebMcpActionClass,
  WebMcpAuditStatus,
  WebMcpResourceType,
  WebMcpToolName
} from "./audit.js";
import {
  withAccountDeletionWriteFence,
  type WebMcpWriteFenceRunner
} from "./accountDeletionFence.js";

export type WebMcpAuditEvent = {
  id: string;
  userId: string;
  requestId?: string;
  toolName: WebMcpToolName;
  actionClass: WebMcpActionClass;
  status: WebMcpAuditStatus;
  resourceType?: WebMcpResourceType;
  resourceId?: string;
  inputDigest?: string;
  actionDigest?: string;
  errorCode?: string;
  latencyMs?: number;
  createdAt: string;
};

export type RecordWebMcpAuditEventInput = Omit<WebMcpAuditEvent, "id" | "createdAt"> & {
  claimToken?: string;
};

export type RecordWebMcpAuditEventResult =
  | { kind: "recorded"; event: WebMcpAuditEvent; reused: boolean }
  | { kind: "conflict"; event: WebMcpAuditEvent };

export interface WebMcpAuditRepository {
  recordEvent(input: RecordWebMcpAuditEventInput): Promise<RecordWebMcpAuditEventResult>;
}

export type WebMcpIdempotentToolName = Extract<
  WebMcpToolName,
  "readmate_add_web_page" | "readmate_subscribe_rss" | "readmate_generate_study_pack"
>;

export type ClaimWebMcpActionInput = {
  userId: string;
  requestId: string;
  toolName: WebMcpIdempotentToolName;
  actionClass: Extract<WebMcpActionClass, "write" | "paid_ai">;
  actionDigest: string;
};

export type ClaimWebMcpActionResult =
  | { kind: "execute"; event: ClaimedWebMcpAuditEvent }
  | { kind: "replay"; event: WebMcpAuditEvent }
  | { kind: "in_progress"; event: WebMcpAuditEvent }
  | { kind: "failed"; event: WebMcpAuditEvent }
  | { kind: "cancelled"; event: WebMcpAuditEvent }
  | { kind: "conflict"; event: WebMcpAuditEvent };

export type ClaimedWebMcpAuditEvent = WebMcpAuditEvent & {
  requestId: string;
  actionDigest: string;
  claimToken: string;
};

export interface WebMcpActionIdempotencyRepository extends WebMcpAuditRepository {
  claimAction(input: ClaimWebMcpActionInput): Promise<ClaimWebMcpActionResult>;
}

export const WEBMCP_ACTION_CLAIM_LEASE_MS = 5 * 60 * 1_000;

export type PersistedAuditEvent = {
  id: string;
  userId: string;
  requestId: string | null;
  toolName: string;
  actionClass: string;
  status: string;
  resourceType: string | null;
  resourceId: string | null;
  inputDigest: string | null;
  actionDigest: string | null;
  claimToken: string | null;
  errorCode: string | null;
  latencyMs: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type AuditEventDelegate = {
  findUnique(args: {
    where: {
      userId_requestId_toolName: { userId: string; requestId: string; toolName: string };
    };
  }): Promise<PersistedAuditEvent | null>;
  create(args: {
    data: {
      userId: string;
      requestId: string | null;
      toolName: string;
      actionClass: string;
      status: string;
      resourceType: string | null;
      resourceId: string | null;
      inputDigest: string | null;
      actionDigest: string | null;
      claimToken: string | null;
      errorCode: string | null;
      latencyMs: number | null;
    };
  }): Promise<PersistedAuditEvent>;
  update(args: {
    where: { id: string };
    data: {
      status?: string;
      resourceType?: string | null;
      resourceId?: string | null;
      inputDigest?: string | null;
      actionDigest?: string | null;
      claimToken?: string | null;
      errorCode?: string | null;
      latencyMs?: number | null;
    };
  }): Promise<PersistedAuditEvent>;
  updateMany(args: {
    where: {
      id: string;
      status?: string;
      actionDigest?: string | null;
      claimToken?: string | null;
      updatedAt?: Date | string;
    };
    data: {
      status?: string;
      resourceType?: string | null;
      resourceId?: string | null;
      inputDigest?: string | null;
      actionDigest?: string | null;
      claimToken?: string | null;
      errorCode?: string | null;
      latencyMs?: number | null;
      updatedAt?: Date | string;
    };
  }): Promise<{ count: number }>;
};

export class PrismaWebMcpAuditRepository implements WebMcpActionIdempotencyRepository {
  constructor(
    private readonly injectedDelegate?: AuditEventDelegate,
    private readonly now: () => Date = () => new Date(),
    private readonly claimTokenFactory: () => string = secureClaimToken,
    private readonly injectedWriteFenceRunner?: WebMcpWriteFenceRunner<AuditEventDelegate>
  ) {}

  async recordEvent(input: RecordWebMcpAuditEventInput): Promise<RecordWebMcpAuditEventResult> {
    return this.withUserWrite(input.userId, (delegate) => this.recordEventWithDelegate(delegate, input));
  }

  async claimAction(input: ClaimWebMcpActionInput): Promise<ClaimWebMcpActionResult> {
    return this.withUserWrite(input.userId, (delegate) => this.claimActionWithDelegate(delegate, input));
  }

  private async recordEventWithDelegate(
    delegate: AuditEventDelegate,
    input: RecordWebMcpAuditEventInput
  ): Promise<RecordWebMcpAuditEventResult> {
    if (!input.requestId) {
      rejectOrphanedClaimProof(input);
      return { kind: "recorded", event: serialize(await delegate.create({ data: persistenceData(input) })), reused: false };
    }

    const existing = await delegate.findUnique({ where: { userId_requestId_toolName: uniqueWhere(input) } });
    if (existing) return reuseOrUpdate(delegate, existing, input);
    rejectOrphanedClaimProof(input);

    try {
      const created = await delegate.create({ data: persistenceData(input) });
      return { kind: "recorded", event: serialize(created), reused: false };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await delegate.findUnique({ where: { userId_requestId_toolName: uniqueWhere(input) } });
      if (!raced) throw error;
      return reuseOrUpdate(delegate, raced, input);
    }
  }

  private async claimActionWithDelegate(
    delegate: AuditEventDelegate,
    input: ClaimWebMcpActionInput
  ): Promise<ClaimWebMcpActionResult> {
    const claimTime = this.now();
    const existing = await delegate.findUnique({ where: { userId_requestId_toolName: uniqueWhere(input) } });
    if (existing) return claimExistingAction(delegate, existing, input, claimTime, this.claimTokenFactory);

    try {
      const created = await delegate.create({ data: actionPersistenceData(input, nextClaimToken(this.claimTokenFactory)) });
      return { kind: "execute", event: serializeClaimed(created) };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await delegate.findUnique({ where: { userId_requestId_toolName: uniqueWhere(input) } });
      if (!raced) throw error;
      return claimExistingAction(delegate, raced, input, claimTime, this.claimTokenFactory);
    }
  }

  private async withUserWrite<T>(
    userId: string,
    operation: (delegate: AuditEventDelegate) => Promise<T>
  ): Promise<T> {
    if (this.injectedWriteFenceRunner) return this.injectedWriteFenceRunner.run(userId, operation);
    if (this.injectedDelegate) return operation(this.injectedDelegate);
    return withAccountDeletionWriteFence(userId, (tx) =>
      operation(tx.webMcpAuditEvent as unknown as AuditEventDelegate)
    );
  }
}

async function claimExistingAction(
  delegate: AuditEventDelegate,
  existing: PersistedAuditEvent,
  input: ClaimWebMcpActionInput,
  claimTime: Date,
  claimTokenFactory: () => string
): Promise<ClaimWebMcpActionResult> {
  if (
    existing.actionClass !== input.actionClass ||
    (existing.actionDigest !== null && existing.actionDigest !== input.actionDigest)
  ) {
    return { kind: "conflict", event: serialize(existing) };
  }

  if (
    existing.actionDigest === null &&
    (existing.resourceType !== null || existing.resourceId !== null)
  ) {
    return { kind: "conflict", event: serialize(existing) };
  }

  if (isTerminalStatus(existing.status)) {
    if (existing.actionDigest === null) {
      return { kind: "conflict", event: serialize(existing) };
    }
    return { kind: terminalClaimKind(existing.status), event: serialize(existing) };
  }

  if (
    existing.status === "started" &&
    existing.actionDigest === input.actionDigest &&
    !claimLeaseExpired(existing.updatedAt, claimTime)
  ) {
    return { kind: "in_progress", event: serialize(existing) };
  }

  if (existing.status !== "confirmed" && existing.status !== "started") {
    return { kind: "conflict", event: serialize(existing) };
  }

  const expectedActionDigest = existing.actionDigest;
  const expectedClaimToken = existing.claimToken;
  const claimToken = nextClaimToken(claimTokenFactory);
  const claimed = await delegate.updateMany({
    where: {
      id: existing.id,
      status: existing.status,
      actionDigest: expectedActionDigest,
      claimToken: expectedClaimToken,
      updatedAt: existing.updatedAt
    },
    data: {
      status: "started",
      actionDigest: input.actionDigest,
      claimToken,
      updatedAt: claimTime
    }
  });

  if (claimed.count === 1) {
    return {
      kind: "execute",
      event: serializeClaimed({
        ...existing,
        status: "started",
        actionDigest: input.actionDigest,
        claimToken,
        updatedAt: claimTime
      })
    };
  }

  const raced = await delegate.findUnique({ where: { userId_requestId_toolName: uniqueWhere(input) } });
  if (!raced) {
    throw new Error("WebMCP action claim disappeared during an atomic update.");
  }
  return claimExistingAction(delegate, raced, input, claimTime, claimTokenFactory);
}

function claimLeaseExpired(updatedAt: Date | string, claimTime: Date): boolean {
  const updatedAtMs = updatedAt instanceof Date ? updatedAt.getTime() : Date.parse(updatedAt);
  return Number.isFinite(updatedAtMs) && claimTime.getTime() - updatedAtMs >= WEBMCP_ACTION_CLAIM_LEASE_MS;
}

function terminalClaimKind(status: string): "replay" | "failed" | "cancelled" {
  if (status === "succeeded") return "replay";
  if (status === "failed") return "failed";
  return "cancelled";
}

async function reuseOrUpdate(
  delegate: AuditEventDelegate,
  existing: PersistedAuditEvent,
  input: RecordWebMcpAuditEventInput
): Promise<RecordWebMcpAuditEventResult> {
  const incomingClaimProof = input.actionDigest !== undefined || input.claimToken !== undefined;
  if (
    existing.actionClass !== input.actionClass ||
    (existing.inputDigest && input.inputDigest && existing.inputDigest !== input.inputDigest) ||
    (incomingClaimProof &&
      (input.actionDigest !== existing.actionDigest || input.claimToken !== existing.claimToken)) ||
    (existing.resourceType && input.resourceType && existing.resourceType !== input.resourceType) ||
    (existing.resourceId && input.resourceId && existing.resourceId !== input.resourceId)
  ) {
    return { kind: "conflict", event: serialize(existing) };
  }

  const claimedActionIsOwned = existing.actionDigest !== null || existing.claimToken !== null;
  const incomingOwnsClaim = Boolean(
    existing.actionDigest &&
    existing.claimToken &&
    input.actionDigest === existing.actionDigest &&
    input.claimToken === existing.claimToken
  );
  const canMutateClaimedAction = !claimedActionIsOwned || incomingOwnsClaim;
  const shouldAdvance =
    !isTerminalStatus(existing.status) &&
    statusRank(input.status) > statusRank(existing.status) &&
    canMutateClaimedAction;
  const update = {
    ...(shouldAdvance ? { status: input.status } : {}),
    ...(canMutateClaimedAction && !existing.resourceType && input.resourceType ? { resourceType: input.resourceType } : {}),
    ...(canMutateClaimedAction && !existing.resourceId && input.resourceId ? { resourceId: input.resourceId } : {}),
    ...(canMutateClaimedAction && !existing.inputDigest && input.inputDigest ? { inputDigest: input.inputDigest } : {}),
    ...(shouldAdvance && isTerminalStatus(input.status) ? { claimToken: null } : {}),
    ...(shouldAdvance && input.status === "failed" ? { errorCode: input.errorCode ?? null } : {}),
    ...(shouldAdvance && input.status !== "failed" ? { errorCode: null } : {}),
    ...(canMutateClaimedAction && existing.latencyMs === null && input.latencyMs !== undefined
      ? { latencyMs: input.latencyMs }
      : {})
  };

  if (Object.keys(update).length === 0) {
    return { kind: "recorded", event: serialize(existing), reused: true };
  }

  const updated = await delegate.updateMany({
    where: {
      id: existing.id,
      status: existing.status,
      actionDigest: existing.actionDigest,
      claimToken: existing.claimToken,
      updatedAt: existing.updatedAt
    },
    data: update
  });
  const persisted = await delegate.findUnique({ where: { userId_requestId_toolName: uniqueWhere(input) } });
  if (!persisted) {
    throw new Error("WebMCP audit event disappeared during an atomic update.");
  }
  if (updated.count === 0) {
    return reuseOrUpdate(delegate, persisted, input);
  }

  return {
    kind: "recorded",
    event: serialize(persisted),
    reused: true
  };
}

function persistenceData(input: RecordWebMcpAuditEventInput) {
  return {
    userId: input.userId,
    requestId: input.requestId ?? null,
    toolName: input.toolName,
    actionClass: input.actionClass,
    status: input.status,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    inputDigest: input.inputDigest ?? null,
    actionDigest: null,
    claimToken: null,
    errorCode: input.errorCode ?? null,
    latencyMs: input.latencyMs ?? null
  };
}

function actionPersistenceData(input: ClaimWebMcpActionInput, claimToken: string) {
  return {
    userId: input.userId,
    requestId: input.requestId,
    toolName: input.toolName,
    actionClass: input.actionClass,
    status: "started",
    resourceType: null,
    resourceId: null,
    inputDigest: null,
    actionDigest: input.actionDigest,
    claimToken,
    errorCode: null,
    latencyMs: null
  };
}

function rejectOrphanedClaimProof(input: RecordWebMcpAuditEventInput): void {
  if (input.actionDigest !== undefined || input.claimToken !== undefined) {
    throw new Error("A WebMCP action claim must exist before it can be completed.");
  }
}

function secureClaimToken(): string {
  return randomBytes(32).toString("hex");
}

function nextClaimToken(factory: () => string): string {
  const token = factory();
  if (!/^[0-9a-f]{64}$/.test(token)) {
    throw new Error("WebMCP claim token generation failed.");
  }
  return token;
}

function uniqueWhere(input: Pick<RecordWebMcpAuditEventInput, "userId" | "requestId" | "toolName">) {
  return { userId: input.userId, requestId: input.requestId!, toolName: input.toolName };
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

function isTerminalStatus(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function statusRank(status: string): number {
  if (status === "confirmed") return 0;
  if (status === "started") return 1;
  return 2;
}

function serialize(event: PersistedAuditEvent): WebMcpAuditEvent {
  return {
    id: event.id,
    userId: event.userId,
    requestId: event.requestId ?? undefined,
    toolName: event.toolName as WebMcpToolName,
    actionClass: event.actionClass as WebMcpActionClass,
    status: event.status as WebMcpAuditStatus,
    resourceType: (event.resourceType as WebMcpResourceType | null) ?? undefined,
    resourceId: event.resourceId ?? undefined,
    inputDigest: event.inputDigest ?? undefined,
    actionDigest: event.actionDigest ?? undefined,
    errorCode: event.errorCode ?? undefined,
    latencyMs: event.latencyMs ?? undefined,
    createdAt: event.createdAt instanceof Date ? event.createdAt.toISOString() : event.createdAt
  };
}

function serializeClaimed(event: PersistedAuditEvent): ClaimedWebMcpAuditEvent {
  const serialized = serialize(event);
  if (!serialized.requestId || !serialized.actionDigest || !event.claimToken) {
    throw new Error("WebMCP action claim persistence is incomplete.");
  }
  return { ...serialized, claimToken: event.claimToken } as ClaimedWebMcpAuditEvent;
}
