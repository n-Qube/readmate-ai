import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthedRequest } from "../auth.js";
import { entitlementForPlan } from "../entitlements.js";
import { entitlementsRouter } from "./entitlements.js";

function createTestApp(overrides: Parameters<typeof entitlementsRouter>[0] = {}) {
  const app = express();
  app.use(express.json());
  app.use((req: AuthedRequest, _res, next) => {
    req.userId = String(req.header("x-test-user") ?? "authenticated_user");
    next();
  });
  app.use("/api/entitlements", entitlementsRouter(overrides));
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: "Unexpected server error." });
  });
  return app;
}

describe("entitlementsRouter", () => {
  it("awaits an asynchronous entitlement resolver", async () => {
    const getEntitlement = vi.fn(async () => entitlementForPlan("premium"));

    const response = await request(createTestApp({ getEntitlement }))
      .get("/api/entitlements")
      .expect(200);

    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toMatchObject({ plan: "premium", isPremium: true });
    expect(getEntitlement).toHaveBeenCalledWith(expect.anything(), "authenticated_user");
  });

  it("refreshes only the authenticated Clerk user's subscriber record", async () => {
    const calls: string[] = [];
    const invalidateCache = vi.fn(async (userId: string) => {
      calls.push(`invalidate:${userId}`);
    });
    const getEntitlement = vi.fn(async (_req: AuthedRequest, userId: string) => {
      calls.push(`resolve:${userId}`);
      return entitlementForPlan("premium");
    });

    const response = await request(createTestApp({ getEntitlement, invalidateCache }))
      .post("/api/entitlements/refresh")
      .set("x-test-user", "authenticated_owner")
      .send({ userId: "attacker_supplied_user" })
      .expect(200);

    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toMatchObject({ plan: "premium", isPremium: true });
    expect(invalidateCache).toHaveBeenCalledWith("authenticated_owner");
    expect(getEntitlement).toHaveBeenCalledWith(expect.anything(), "authenticated_owner");
    expect(calls).toEqual(["invalidate:authenticated_owner", "resolve:authenticated_owner"]);
  });
});
