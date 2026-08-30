import { describe, expect, it } from "vitest";
import {
  MAX_TOOL_OUTPUT_CHARS,
  ReadMateToolExecutionError,
  compactToolSuccess,
  toolErrorFromUnknown,
  toolOutputLength
} from "./tool-results";

describe("ReadMate WebMCP compact result envelopes", () => {
  it("keeps a large search response below the output ceiling", () => {
    const output = compactToolSuccess("readmate_search_library", {
      resource: {
        total: 10,
        results: Array.from({ length: 10 }, (_, index) => ({
          documentId: `doc-${index}`,
          title: `Long untrusted article title ${index} ${"x".repeat(220)}`,
          sourceType: "webpage" as const,
          progressPercent: index,
          updatedAt: "2026-08-29T12:00:00.000Z",
          deepLink: `/document/doc-${index}`
        }))
      },
      message: "Search complete."
    });

    expect(toolOutputLength(output)).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_CHARS);
    expect(output.ok).toBe(true);
    if (output.ok && "results" in output.resource) {
      expect((output.resource.results as unknown[]).length).toBeLessThan(10);
      expect(output.resource).toMatchObject({ truncated: true });
    }
  });

  it("removes secret, raw-content, provider, and absolute URL fields", () => {
    const output = compactToolSuccess("readmate_get_document_context", {
      resource: {
        documentId: "doc-1",
        title: "A safe title",
        sourceType: "document",
        status: "unread",
        progressPercent: 0,
        summaryAvailable: false,
        flashcardCount: 0,
        quizCount: 0,
        supportedActions: [],
        deepLink: "/document/doc-1",
        token: "secret-token",
        blocks: [{ text: "private document body" }],
        storageUrl: "https://storage.invalid/private?signed=yes",
        providerResponse: { detail: "raw provider failure" }
      },
      message: "Bearer abc.def.ghi https://api.invalid/private"
    } as never);
    const serialized = JSON.stringify(output);

    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("private document body");
    expect(serialized).not.toContain("storage.invalid");
    expect(serialized).not.toContain("raw provider failure");
    expect(serialized).not.toContain("api.invalid");
    expect(serialized).toContain("/document/doc-1");
    expect(toolOutputLength(output)).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_CHARS);
  });

  it("uses stable safe errors without echoing provider details", () => {
    expect(toolErrorFromUnknown("readmate_get_document_context", { status: 404, message: "private SQL detail" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" }
    });
    expect(JSON.stringify(toolErrorFromUnknown("readmate_get_document_context", { status: 500, message: "provider key abc" }))).not.toContain("provider key");
    expect(toolErrorFromUnknown("readmate_generate_study_pack", { status: 403 })).toMatchObject({
      error: { code: "PLAN_LIMIT" }
    });
    expect(toolErrorFromUnknown("readmate_search_library", { status: 401 })).toMatchObject({
      error: { code: "AUTH_REQUIRED" }
    });
  });

  it("preserves an explicitly safe domain error", () => {
    const output = toolErrorFromUnknown(
      "readmate_add_web_page",
      new ReadMateToolExecutionError("BLOCKED_URL", "That address cannot be saved.", "Choose a public HTTPS webpage.")
    );
    expect(output).toMatchObject({
      ok: false,
      action: "saved_web_page",
      error: { code: "BLOCKED_URL", message: "That address cannot be saved." }
    });
  });
});

