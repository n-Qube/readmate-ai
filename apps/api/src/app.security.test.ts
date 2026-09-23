import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

describe("API hardening", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends security headers and hides the framework", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CLERK_SECRET_KEY", "");
    vi.stubEnv("CLERK_PUBLISHABLE_KEY", "");

    const response = await request(createApp()).get("/health").expect(200);

    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["strict-transport-security"]).toBeUndefined();
  });

  it("rate limits content ingestion per caller with a JSON 429", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CLERK_SECRET_KEY", "");
    vi.stubEnv("CLERK_PUBLISHABLE_KEY", "");
    const app = createApp();

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await request(app).post("/api/content/save-url").send({}).expect(503);
    }
    const limited = await request(app).post("/api/content/save-url").send({}).expect(429);

    expect(limited.body.code).toBe("RATE_LIMITED");
  });
});
