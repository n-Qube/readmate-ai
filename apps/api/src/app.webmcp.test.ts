import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

describe("WebMCP route mount", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed when Clerk authentication is not configured", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CLERK_SECRET_KEY", "");
    vi.stubEnv("CLERK_PUBLISHABLE_KEY", "");

    const response = await request(createApp())
      .post("/api/webmcp/events")
      .send({
        toolName: "readmate_search_library",
        actionClass: "read",
        status: "succeeded",
        input: { query: "archaeology" }
      })
      .expect(503);

    expect(response.body.error).toMatch(/Clerk is not configured/i);
  });
});
