import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";
import { withRlsUser } from "./rls.js";

export type AuthedRequest = Request & {
  userId?: string;
};

export function requireClerkUser() {
  return [
    (req: AuthedRequest, res: Response, next: NextFunction) => {
      const userId = getAuth(req).userId ?? undefined;
      if (!userId) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }
      req.userId = userId;
      withRlsUser(userId, next);
    }
  ];
}

export function getUserId(req: AuthedRequest): string {
  if (!req.userId) throw new Error("Authentication required.");
  return req.userId;
}
