import type { Request, Response } from "express";
import {
  digestWebMcpActionInput,
  resolveWebMcpAuditDigestKey,
  WEBMCP_MAX_AUDIT_LATENCY_MS,
  webMcpRequestIdSchema,
  type WebMcpActionClass,
  type WebMcpResourceType,
  type WebMcpToolName
} from "./audit.js";
import {
  PrismaWebMcpAuditRepository,
  type WebMcpActionIdempotencyRepository,
  type ClaimedWebMcpAuditEvent,
  type WebMcpAuditEvent
} from "./auditRepository.js";

const REQUEST_ID_HEADER = "x-readmate-request-id";

export type WebMcpActionIdempotencyDeps = {
  repository?: WebMcpActionIdempotencyRepository;
  digestKey?: string;
};

type BeginWebMcpActionInput = {
  userId: string;
  toolName: Extract<
    WebMcpToolName,
    "readmate_add_web_page" | "readmate_subscribe_rss" | "readmate_generate_study_pack"
  >;
  actionClass: Extract<WebMcpActionClass, "write" | "paid_ai">;
  canonicalInput: unknown;
};

export type WebMcpActionExecution = {
  kind: "execute";
  event: ClaimedWebMcpAuditEvent;
  repository: WebMcpActionIdempotencyRepository;
  startedAt: number;
};

export type BeginWebMcpActionResult =
  | { kind: "disabled" }
  | WebMcpActionExecution
  | { kind: "replay"; event: WebMcpAuditEvent };

export class WebMcpActionIdempotencyError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "WebMcpActionIdempotencyError";
  }
}

/**
 * Opts a mutation into WebMCP idempotency only when the trusted confirmation
 * layer supplies its request-ID header. Ordinary app and extension callers are
 * deliberately unchanged.
 */
export async function beginWebMcpAction(
  req: Request,
  input: BeginWebMcpActionInput,
  deps: WebMcpActionIdempotencyDeps = {}
): Promise<BeginWebMcpActionResult> {
  const rawRequestId = req.header(REQUEST_ID_HEADER);
  if (rawRequestId === undefined) return { kind: "disabled" };

  const parsedRequestId = webMcpRequestIdSchema.safeParse(rawRequestId);
  if (!parsedRequestId.success) {
    throw new WebMcpActionIdempotencyError(
      "INVALID_IDEMPOTENCY_KEY",
      400,
      "The WebMCP request ID is invalid."
    );
  }

  const repository = deps.repository ?? new PrismaWebMcpAuditRepository();
  const actionDigest = digestWebMcpActionInput(
    input.canonicalInput,
    deps.digestKey ?? resolveWebMcpAuditDigestKey()
  );
  const claim = await repository.claimAction({
    userId: input.userId,
    requestId: parsedRequestId.data,
    toolName: input.toolName,
    actionClass: input.actionClass,
    actionDigest
  });

  if (claim.kind === "execute") {
    return { kind: "execute", event: claim.event, repository, startedAt: Date.now() };
  }
  if (claim.kind === "replay") return { kind: "replay", event: claim.event };
  if (claim.kind === "conflict") {
    throw new WebMcpActionIdempotencyError(
      "IDEMPOTENCY_CONFLICT",
      409,
      "This request ID was already used with different action input."
    );
  }
  if (claim.kind === "in_progress") {
    throw new WebMcpActionIdempotencyError(
      "IDEMPOTENCY_IN_PROGRESS",
      409,
      "This action is already in progress. Retry with the same request ID.",
      2
    );
  }
  if (claim.kind === "cancelled") {
    throw new WebMcpActionIdempotencyError(
      "IDEMPOTENCY_CANCELLED",
      409,
      "This confirmed action was cancelled. Confirm it again to create a new request."
    );
  }
  throw new WebMcpActionIdempotencyError(
    "IDEMPOTENCY_PREVIOUSLY_FAILED",
    409,
    "This confirmed action previously failed. Confirm it again to create a new request."
  );
}

export async function completeWebMcpAction(
  execution: WebMcpActionExecution | { kind: "disabled" },
  resource: { resourceType: WebMcpResourceType; resourceId: string; latencyMs?: number }
): Promise<void> {
  if (execution.kind === "disabled") return;
  const result = await execution.repository.recordEvent({
    userId: execution.event.userId,
    requestId: execution.event.requestId,
    toolName: execution.event.toolName,
    actionClass: execution.event.actionClass,
    status: "succeeded",
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    actionDigest: execution.event.actionDigest,
    claimToken: execution.event.claimToken,
    latencyMs: boundedAuditLatency(resource.latencyMs ?? Date.now() - execution.startedAt)
  });
  if (
    result.kind === "conflict" ||
    result.event.status !== "succeeded" ||
    result.event.resourceType !== resource.resourceType ||
    result.event.resourceId !== resource.resourceId
  ) {
    throw new WebMcpActionIdempotencyError(
      "IDEMPOTENCY_CONFLICT",
      409,
      "This request ID conflicts with an existing action."
    );
  }
}

export async function failWebMcpAction(
  execution: WebMcpActionExecution | { kind: "disabled" } | undefined,
  error: unknown
): Promise<void> {
  if (!execution || execution.kind === "disabled") return;
  try {
    await execution.repository.recordEvent({
      userId: execution.event.userId,
      requestId: execution.event.requestId,
      toolName: execution.event.toolName,
      actionClass: execution.event.actionClass,
      status: "failed",
      actionDigest: execution.event.actionDigest,
      claimToken: execution.event.claimToken,
      errorCode: safeErrorCode(error),
      latencyMs: boundedAuditLatency(Date.now() - execution.startedAt)
    });
  } catch {
    // The original request failure remains authoritative; audit persistence must
    // not replace it or expose provider details to the caller.
  }
}

export function markWebMcpReplay(res: Response): void {
  res.setHeader("X-ReadMate-Idempotent-Replay", "true");
}

export function requireWebMcpReplayResourceId(
  event: WebMcpAuditEvent,
  resourceType: WebMcpResourceType
): string {
  if (event.resourceType === resourceType && event.resourceId) return event.resourceId;
  throw new WebMcpActionIdempotencyError(
    "IDEMPOTENCY_RESOURCE_UNAVAILABLE",
    409,
    "The completed action result is no longer available. Confirm the action again to create a new request."
  );
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(code)) return code;
  }
  return "ACTION_FAILED";
}

function boundedAuditLatency(value: number): number {
  if (!Number.isFinite(value)) return WEBMCP_MAX_AUDIT_LATENCY_MS;
  return Math.min(WEBMCP_MAX_AUDIT_LATENCY_MS, Math.max(0, Math.trunc(value)));
}
