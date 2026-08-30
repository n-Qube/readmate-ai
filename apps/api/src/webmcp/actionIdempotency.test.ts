import { afterEach, describe, expect, it, vi } from "vitest";
import { WEBMCP_MAX_AUDIT_LATENCY_MS } from "./audit.js";
import {
  completeWebMcpAction,
  failWebMcpAction,
  type WebMcpActionExecution
} from "./actionIdempotency.js";
import type {
  ClaimedWebMcpAuditEvent,
  RecordWebMcpAuditEventInput,
  WebMcpActionIdempotencyRepository,
  WebMcpAuditEvent
} from "./auditRepository.js";

const CLAIM_TOKEN = "a".repeat(64);

describe("WebMCP action completion fencing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [WEBMCP_MAX_AUDIT_LATENCY_MS, WEBMCP_MAX_AUDIT_LATENCY_MS],
    [WEBMCP_MAX_AUDIT_LATENCY_MS + 1, WEBMCP_MAX_AUDIT_LATENCY_MS]
  ])("records an observed completion latency of %i ms as %i ms", async (elapsed, expected) => {
    const memory = createRecordingRepository();
    vi.spyOn(Date, "now").mockReturnValue(elapsed);

    await completeWebMcpAction(execution(memory.repository, 0), {
      resourceType: "document",
      resourceId: "doc_123"
    });

    expect(memory.inputs).toHaveLength(1);
    expect(memory.inputs[0]).toMatchObject({
      status: "succeeded",
      actionDigest: "c".repeat(64),
      claimToken: CLAIM_TOKEN,
      latencyMs: expected
    });
  });

  it("clamps a failure observed after the claim lease while preserving its current fencing token", async () => {
    const memory = createRecordingRepository();
    vi.spyOn(Date, "now").mockReturnValue(WEBMCP_MAX_AUDIT_LATENCY_MS + 60_000);

    await failWebMcpAction(execution(memory.repository, 0), Object.assign(new Error("provider"), {
      code: "PROVIDER_UNAVAILABLE"
    }));

    expect(memory.inputs).toHaveLength(1);
    expect(memory.inputs[0]).toMatchObject({
      status: "failed",
      actionDigest: "c".repeat(64),
      claimToken: CLAIM_TOKEN,
      errorCode: "PROVIDER_UNAVAILABLE",
      latencyMs: WEBMCP_MAX_AUDIT_LATENCY_MS
    });
  });
});

function execution(
  repository: WebMcpActionIdempotencyRepository,
  startedAt: number
): WebMcpActionExecution {
  const event: ClaimedWebMcpAuditEvent = {
    id: "audit_1",
    userId: "user_1",
    requestId: "request_12345678",
    toolName: "readmate_add_web_page",
    actionClass: "write",
    status: "started",
    actionDigest: "c".repeat(64),
    claimToken: CLAIM_TOKEN,
    createdAt: "2026-08-29T12:00:00.000Z"
  };
  return { kind: "execute", event, repository, startedAt };
}

function createRecordingRepository() {
  const inputs: RecordWebMcpAuditEventInput[] = [];
  const repository: WebMcpActionIdempotencyRepository = {
    async claimAction() {
      throw new Error("not used");
    },
    async recordEvent(input) {
      inputs.push(input);
      const { claimToken: _privateClaimToken, ...safeInput } = input;
      const event: WebMcpAuditEvent = {
        id: "audit_1",
        ...safeInput,
        createdAt: "2026-08-29T12:00:00.000Z"
      };
      return { kind: "recorded", event, reused: true };
    }
  };
  return { repository, inputs };
}
