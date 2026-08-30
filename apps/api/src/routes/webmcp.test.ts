import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AuthedRequest } from "../auth.js";
import type {
  RecordWebMcpAuditEventInput,
  WebMcpAuditEvent,
  WebMcpAuditRepository
} from "../webmcp/auditRepository.js";
import { webMcpRouter } from "./webmcp.js";

const digestKey = "test-only-webmcp-audit-key-32-bytes";

function createTestApp(repository: WebMcpAuditRepository) {
  const app = express();
  app.use(express.json());
  app.use((req: AuthedRequest, _res, next) => {
    req.userId = String(req.header("x-test-user") ?? "owner");
    next();
  });
  app.use("/api/webmcp", webMcpRouter({ repository, digestKey }));
  return app;
}

function createMemoryRepository() {
  const inputs: RecordWebMcpAuditEventInput[] = [];
  const events = new Map<string, WebMcpAuditEvent>();
  let nextId = 1;
  const repository: WebMcpAuditRepository = {
    async recordEvent(input) {
      inputs.push(input);
      const key = input.requestId ? `${input.userId}:${input.toolName}:${input.requestId}` : `unkeyed:${nextId}`;
      const existing = events.get(key);
      if (existing) {
        if (existing.inputDigest && input.inputDigest && existing.inputDigest !== input.inputDigest) {
          return { kind: "conflict", event: existing };
        }
        return { kind: "recorded", event: existing, reused: true };
      }
      const event = {
        id: `audit_${nextId++}`,
        ...input,
        claimToken: "f".repeat(64),
        createdAt: "2026-08-29T12:00:00.000Z"
      } as WebMcpAuditEvent & { claimToken: string };
      events.set(key, event);
      return { kind: "recorded", event, reused: false };
    }
  };
  return { repository, inputs };
}

describe("webMcpRouter", () => {
  it("stores only a keyed digest and safe operational fields", async () => {
    const memory = createMemoryRepository();
    const app = createTestApp(memory.repository);
    const response = await request(app)
      .post("/api/webmcp/events")
      .set("x-test-user", "owner")
      .send({
        requestId: "request_12345678",
        toolName: "readmate_add_web_page",
        actionClass: "write",
        status: "succeeded",
        resourceType: "document",
        resourceId: "doc_123",
        latencyMs: 420,
        input: {
          url: "https://example.com/private/article?access_token=do-not-store",
          title: "A private working title",
          preferredLanguage: "gaa"
        }
      })
      .expect(201);

    expect(memory.inputs).toHaveLength(1);
    expect(memory.inputs[0]).toMatchObject({
      userId: "owner",
      requestId: "request_12345678",
      resourceId: "doc_123",
      inputDigest: expect.stringMatching(/^[0-9a-f]{64}$/)
    });
    const persisted = JSON.stringify(memory.inputs[0]);
    expect(persisted).not.toContain("example.com");
    expect(persisted).not.toContain("access_token");
    expect(persisted).not.toContain("do-not-store");
    expect(persisted).not.toContain("private working title");
    expect(response.body).not.toHaveProperty("event.userId");
    expect(response.body).not.toHaveProperty("event.claimToken");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("accepts the submit-layer request ID header and returns the same event for a retry", async () => {
    const memory = createMemoryRepository();
    const app = createTestApp(memory.repository);
    const payload = {
      toolName: "readmate_subscribe_rss",
      actionClass: "write",
      status: "confirmed",
      input: { feedUrl: "https://example.com/feed.xml", sourceName: "Example" }
    };

    const first = await request(app)
      .post("/api/webmcp/events")
      .set("X-ReadMate-Request-Id", "request_header_123")
      .send(payload)
      .expect(201);
    const retry = await request(app)
      .post("/api/webmcp/events")
      .set("X-ReadMate-Request-Id", "request_header_123")
      .send(payload)
      .expect(200);

    expect(first.body.reused).toBe(false);
    expect(retry.body.reused).toBe(true);
    expect(retry.body.event.id).toBe(first.body.event.id);
  });

  it("rejects conflicting header/body IDs and request-ID reuse with changed input", async () => {
    const memory = createMemoryRepository();
    const app = createTestApp(memory.repository);

    await request(app)
      .post("/api/webmcp/events")
      .set("X-ReadMate-Request-Id", "request_header_123")
      .send({
        requestId: "request_body_456",
        toolName: "readmate_add_web_page",
        actionClass: "write",
        status: "confirmed"
      })
      .expect(400);

    const base = {
      requestId: "request_conflict_123",
      toolName: "readmate_add_web_page",
      actionClass: "write",
      status: "confirmed"
    };
    await request(app)
      .post("/api/webmcp/events")
      .send({ ...base, input: { url: "https://example.com/one" } })
      .expect(201);
    const conflict = await request(app)
      .post("/api/webmcp/events")
      .send({ ...base, input: { url: "https://example.com/two" } })
      .expect(409);
    expect(conflict.body.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("rejects document text, prompts, tokens, full metadata URLs, and raw provider errors", async () => {
    const memory = createMemoryRepository();
    const app = createTestApp(memory.repository);
    const unsafeFields = [
      { documentText: "full document" },
      { prompt: "agent prompt" },
      { token: "secret" },
      { claimToken: "f".repeat(64) },
      { metadata: { privateUrl: "https://private.example/path" } },
      { providerError: "raw provider response" }
    ];

    for (const extra of unsafeFields) {
      await request(app)
        .post("/api/webmcp/events")
        .send({
          toolName: "readmate_search_library",
          actionClass: "read",
          status: "succeeded",
          input: { query: "safe query" },
          ...extra
        })
        .expect(400);
    }
    expect(memory.inputs).toHaveLength(0);
  });

  it("keeps events for different authenticated users isolated", async () => {
    const memory = createMemoryRepository();
    const app = createTestApp(memory.repository);
    const payload = {
      requestId: "request_shared_123",
      toolName: "readmate_generate_study_pack",
      actionClass: "paid_ai",
      status: "succeeded",
      input: { documentId: "doc_123", flashcardCount: 6, quizCount: 4 }
    };

    const owner = await request(app).post("/api/webmcp/events").set("x-test-user", "owner").send(payload).expect(201);
    const other = await request(app).post("/api/webmcp/events").set("x-test-user", "other").send(payload).expect(201);
    expect(other.body.event.id).not.toBe(owner.body.event.id);
  });

  it("fails closed before persistence when input hashing is unavailable", async () => {
    const memory = createMemoryRepository();
    const app = express();
    app.use(express.json());
    app.use((req: AuthedRequest, _res, next) => {
      req.userId = "owner";
      next();
    });
    app.use("/api/webmcp", webMcpRouter({ repository: memory.repository, digestKey: "too-short" }));

    const response = await request(app)
      .post("/api/webmcp/events")
      .send({
        toolName: "readmate_search_library",
        actionClass: "read",
        status: "succeeded",
        input: { query: "private query" }
      })
      .expect(503);

    expect(response.body.code).toBe("AUDIT_UNAVAILABLE");
    expect(memory.inputs).toHaveLength(0);
  });
});
