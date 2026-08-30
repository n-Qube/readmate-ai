import type { Response, Router } from "express";
import { Router as createRouter } from "express";
import { asyncHandler } from "../asyncHandler.js";
import { getUserId, type AuthedRequest } from "../auth.js";
import {
  digestWebMcpInput,
  resolveWebMcpAuditDigestKey,
  webMcpAuditRequestSchema,
  webMcpRequestIdSchema
} from "../webmcp/audit.js";
import {
  PrismaWebMcpAuditRepository,
  type WebMcpAuditEvent,
  type WebMcpAuditRepository
} from "../webmcp/auditRepository.js";

type WebMcpRouterDeps = {
  repository?: WebMcpAuditRepository;
  digestKey?: string;
};

export function webMcpRouter(deps: WebMcpRouterDeps = {}): Router {
  const router = createRouter();
  const repository = deps.repository ?? new PrismaWebMcpAuditRepository();

  router.post("/events", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const headerRequestId = parseHeaderRequestId(req.header("x-readmate-request-id"));
    if (headerRequestId === null) {
      invalidAuditEvent(res);
      return;
    }

    const rawBody = isRecord(req.body) && headerRequestId && req.body.requestId === undefined
      ? { ...req.body, requestId: headerRequestId }
      : req.body;
    const parsed = webMcpAuditRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      invalidAuditEvent(res);
      return;
    }

    if (headerRequestId && parsed.data.requestId && headerRequestId !== parsed.data.requestId) {
      invalidAuditEvent(res);
      return;
    }

    let inputDigest: string | undefined;
    if (parsed.data.input !== undefined) {
      try {
        inputDigest = digestWebMcpInput(
          parsed.data.input,
          deps.digestKey ?? resolveWebMcpAuditDigestKey()
        );
      } catch {
        res.status(503).json({
          error: "WebMCP audit logging is temporarily unavailable.",
          code: "AUDIT_UNAVAILABLE"
        });
        return;
      }
    }

    const { input: _discardedRawInput, ...safePayload } = parsed.data;
    const result = await repository.recordEvent({
      userId: getUserId(req),
      ...safePayload,
      requestId: parsed.data.requestId ?? headerRequestId ?? undefined,
      inputDigest
    });

    res.setHeader("Cache-Control", "no-store");
    if (result.kind === "conflict") {
      res.status(409).json({
        error: "This request ID was already used for a different WebMCP operation.",
        code: "IDEMPOTENCY_CONFLICT",
        event: publicEvent(result.event)
      });
      return;
    }

    res.status(result.reused ? 200 : 201).json({
      event: publicEvent(result.event),
      reused: result.reused
    });
  }));

  return router;
}

function parseHeaderRequestId(value: string | undefined): string | undefined | null {
  if (value === undefined) return undefined;
  const parsed = webMcpRequestIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function invalidAuditEvent(res: Response): void {
  res.status(400).json({ error: "Invalid WebMCP audit event.", code: "INVALID_AUDIT_EVENT" });
}

function publicEvent(event: WebMcpAuditEvent): Omit<WebMcpAuditEvent, "userId"> {
  const { userId: _privateUserId, claimToken: _privateClaimToken, ...safe } = event as WebMcpAuditEvent & {
    claimToken?: string;
  };
  return safe;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
