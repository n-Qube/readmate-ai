import type { Response, Router } from "express";
import { Router as createRouter } from "express";
import { asyncHandler } from "../asyncHandler.js";
import { getUserId, type AuthedRequest } from "../auth.js";
import {
  entitlementForRequest,
  invalidateEntitlementCache,
  type MaybePromise,
  type ReadMateEntitlement
} from "../entitlements.js";

type EntitlementsRouterDeps = {
  getEntitlement?: (req: AuthedRequest, userId: string) => MaybePromise<ReadMateEntitlement>;
  invalidateCache?: (userId: string) => MaybePromise<void>;
};

export function entitlementsRouter(deps: EntitlementsRouterDeps = {}): Router {
  const router = createRouter();
  const getEntitlement = deps.getEntitlement ?? entitlementForRequest;
  const invalidateCache = deps.invalidateCache ?? invalidateEntitlementCache;

  router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await getEntitlement(req, getUserId(req)));
  }));

  router.post("/refresh", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const userId = getUserId(req);
    await invalidateCache(userId);
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await getEntitlement(req, userId));
  }));

  return router;
}
