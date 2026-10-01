import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { normalizeIp, perUserRateLimit, rateLimitKey } from "./rateLimits.js";

describe("rate limit keys", () => {
  it("keys anonymous callers by IPv4 address, unwrapping IPv4-mapped IPv6", () => {
    expect(normalizeIp("203.0.113.9")).toBe("203.0.113.9");
    expect(normalizeIp("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });

  it("groups IPv6 callers by /64 so address rotation cannot evade limits", () => {
    expect(normalizeIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(normalizeIp("2001:db8:1:2:ffff::1")).toBe("2001:db8:1:2::/64");
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(normalizeIp(undefined)).toBe("unknown");
  });

  it("falls back to the client IP when Clerk middleware is not installed", () => {
    expect(rateLimitKey({ ip: "198.51.100.4" } as express.Request)).toBe("ip:198.51.100.4");
  });
});

describe("perUserRateLimit", () => {
  it("returns a JSON 429 that the apps can show to the user", async () => {
    const app = express();
    app.use(perUserRateLimit(1));
    app.get("/", (_req, res) => res.json({ ok: true }));

    await request(app).get("/").expect(200);
    const limited = await request(app).get("/").expect(429);

    expect(limited.body).toEqual({ error: "Too many requests. Please wait a moment and try again.", code: "RATE_LIMITED" });
    expect(limited.headers["ratelimit-limit"]).toBe("1");
  });
});
