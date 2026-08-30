import type { WebMcpActionExecution } from "./actionIdempotency.js";
import {
  withAccountDeletionWriteFence,
  type WebMcpWriteFenceRunner
} from "./accountDeletionFence.js";

export type StudyPackEffect = {
  id: string;
  userId: string;
  requestId: string;
  actionDigest: string;
  documentId: string;
  status: "started" | "succeeded" | "failed";
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
};

export type ClaimStudyPackEffectResult =
  | { kind: "execute"; effect: StudyPackEffect }
  | { kind: "replay"; effect: StudyPackEffect }
  | { kind: "in_progress"; effect: StudyPackEffect }
  | { kind: "failed"; effect: StudyPackEffect }
  | { kind: "conflict"; effect: StudyPackEffect };

export type ClaimStudyPackEffectInput = {
  userId: string;
  requestId: string;
  actionDigest: string;
  documentId: string;
};

export interface StudyPackEffectRepository {
  claim(input: ClaimStudyPackEffectInput): Promise<ClaimStudyPackEffectResult>;
  complete(effect: StudyPackEffect): Promise<StudyPackEffect>;
  fail(effect: StudyPackEffect, errorCode: string): Promise<StudyPackEffect>;
}

export type StudyPackEffectExecution = {
  kind: "execute";
  effect: StudyPackEffect;
  repository: StudyPackEffectRepository;
};

export type BeginStudyPackEffectResult =
  | StudyPackEffectExecution
  | { kind: "replay"; effect: StudyPackEffect }
  | { kind: "in_progress"; effect: StudyPackEffect }
  | { kind: "failed"; effect: StudyPackEffect }
  | { kind: "conflict"; effect: StudyPackEffect };

export type PersistedStudyPackEffect = {
  id: string;
  userId: string;
  requestId: string;
  actionDigest: string;
  documentId: string;
  status: string;
  errorCode: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type StudyPackEffectDelegate = {
  findUnique(args: {
    where: { userId_requestId: { userId: string; requestId: string } };
  }): Promise<PersistedStudyPackEffect | null>;
  create(args: {
    data: {
      userId: string;
      requestId: string;
      actionDigest: string;
      documentId: string;
      status: string;
      errorCode: string | null;
    };
  }): Promise<PersistedStudyPackEffect>;
  updateMany(args: {
    where: {
      id: string;
      status: string;
      actionDigest: string;
      documentId: string;
    };
    data: { status: string; errorCode: string | null };
  }): Promise<{ count: number }>;
};

/**
 * A durable, fail-closed side-effect gate for paid study generation.
 *
 * Unlike the short audit execution lease, this row is never reclaimed. Once a
 * request starts consuming quota or contacting the AI provider, another worker
 * with the same request ID may only observe its outcome. If the worker dies,
 * the user must explicitly confirm a new request instead of risking a duplicate
 * charge or duplicate generated resources.
 */
export class PrismaStudyPackEffectRepository implements StudyPackEffectRepository {
  constructor(
    private readonly injectedDelegate?: StudyPackEffectDelegate,
    private readonly injectedWriteFenceRunner?: WebMcpWriteFenceRunner<StudyPackEffectDelegate>
  ) {}

  async claim(input: ClaimStudyPackEffectInput): Promise<ClaimStudyPackEffectResult> {
    return this.withUserWrite(input.userId, (delegate) => this.claimWithDelegate(delegate, input));
  }

  private async claimWithDelegate(
    delegate: StudyPackEffectDelegate,
    input: ClaimStudyPackEffectInput
  ): Promise<ClaimStudyPackEffectResult> {
    const existing = await delegate.findUnique({ where: { userId_requestId: uniqueWhere(input) } });
    if (existing) return classifyExisting(existing, input);

    try {
      const created = await delegate.create({
        data: {
          userId: input.userId,
          requestId: input.requestId,
          actionDigest: input.actionDigest,
          documentId: input.documentId,
          status: "started",
          errorCode: null
        }
      });
      return { kind: "execute", effect: serialize(created) };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await delegate.findUnique({ where: { userId_requestId: uniqueWhere(input) } });
      if (!raced) throw error;
      return classifyExisting(raced, input);
    }
  }

  async complete(effect: StudyPackEffect): Promise<StudyPackEffect> {
    return this.advance(effect, "succeeded", null);
  }

  async fail(effect: StudyPackEffect, errorCode: string): Promise<StudyPackEffect> {
    return this.advance(effect, "failed", normalizeErrorCode(errorCode));
  }

  private async advance(
    effect: StudyPackEffect,
    status: "succeeded" | "failed",
    errorCode: string | null
  ): Promise<StudyPackEffect> {
    return this.withUserWrite(effect.userId, async (delegate) => {
      await delegate.updateMany({
        where: {
          id: effect.id,
          status: "started",
          actionDigest: effect.actionDigest,
          documentId: effect.documentId
        },
        data: { status, errorCode }
      });
      const persisted = await delegate.findUnique({
        where: { userId_requestId: { userId: effect.userId, requestId: effect.requestId } }
      });
      if (!persisted) throw new Error("Study-pack side-effect record disappeared.");
      const result = serialize(persisted);
      if (
        result.actionDigest !== effect.actionDigest ||
        result.documentId !== effect.documentId ||
        (result.status !== status && result.status !== "succeeded")
      ) {
        throw new Error("Study-pack side-effect record conflicts with this execution.");
      }
      return result;
    });
  }

  private async withUserWrite<T>(
    userId: string,
    operation: (delegate: StudyPackEffectDelegate) => Promise<T>
  ): Promise<T> {
    if (this.injectedWriteFenceRunner) return this.injectedWriteFenceRunner.run(userId, operation);
    if (this.injectedDelegate) return operation(this.injectedDelegate);
    return withAccountDeletionWriteFence(userId, (tx) =>
      operation(tx.webMcpStudyPackEffect as unknown as StudyPackEffectDelegate)
    );
  }
}

export async function beginStudyPackEffect(
  action: WebMcpActionExecution,
  documentId: string,
  repository: StudyPackEffectRepository = new PrismaStudyPackEffectRepository()
): Promise<BeginStudyPackEffectResult> {
  const result = await repository.claim({
    userId: action.event.userId,
    requestId: action.event.requestId,
    actionDigest: action.event.actionDigest,
    documentId
  });
  return result.kind === "execute" ? { ...result, repository } : result;
}

export async function completeStudyPackEffect(execution: StudyPackEffectExecution | undefined): Promise<void> {
  if (!execution) return;
  await execution.repository.complete(execution.effect);
}

export async function failStudyPackEffect(
  execution: StudyPackEffectExecution | undefined,
  error: unknown
): Promise<void> {
  if (!execution) return;
  try {
    await execution.repository.fail(execution.effect, safeErrorCode(error));
  } catch {
    // Preserve the original request error; the side-effect row remains
    // fail-closed and cannot be claimed by another worker.
  }
}

function classifyExisting(
  existing: PersistedStudyPackEffect,
  input: ClaimStudyPackEffectInput
): ClaimStudyPackEffectResult {
  const effect = serialize(existing);
  if (effect.actionDigest !== input.actionDigest || effect.documentId !== input.documentId) {
    return { kind: "conflict", effect };
  }
  if (effect.status === "succeeded") return { kind: "replay", effect };
  if (effect.status === "started") return { kind: "in_progress", effect };
  return { kind: "failed", effect };
}

function uniqueWhere(input: Pick<ClaimStudyPackEffectInput, "userId" | "requestId">) {
  return { userId: input.userId, requestId: input.requestId };
}

function serialize(value: PersistedStudyPackEffect): StudyPackEffect {
  if (value.status !== "started" && value.status !== "succeeded" && value.status !== "failed") {
    throw new Error("Study-pack side-effect status is invalid.");
  }
  return {
    id: value.id,
    userId: value.userId,
    requestId: value.requestId,
    actionDigest: value.actionDigest,
    documentId: value.documentId,
    status: value.status,
    errorCode: value.errorCode ?? undefined,
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt)
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeErrorCode(value: string): string {
  return /^[A-Z][A-Z0-9_]{1,63}$/.test(value) ? value : "ACTION_FAILED";
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return normalizeErrorCode(code);
  }
  return "ACTION_FAILED";
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}
