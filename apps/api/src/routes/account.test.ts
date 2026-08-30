import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthedRequest } from "../auth.js";
import { accountRouter, type AccountDeletionRepository } from "./account.js";

function createTestApp(
  repository: AccountDeletionRepository,
  deleteClerkUser = vi.fn(async () => undefined),
  hasRecentVerification = vi.fn(() => true)
) {
  const app = express();
  app.use(express.json());
  app.use((req: AuthedRequest, _res, next) => {
    req.userId = "user_delete";
    next();
  });
  app.use("/api/account", accountRouter({ repository, deleteClerkUser, hasRecentVerification }));
  return { app, deleteClerkUser };
}

describe("accountRouter", () => {
  it("deletes account data and the Clerk user", async () => {
    const deleteAccountData = vi.fn(async () => ({ documents: 2, settings: 1, sources: 1, uploads: 1 }));
    const { app, deleteClerkUser } = createTestApp({ deleteAccountData });

    await request(app).delete("/api/account").expect(204);

    expect(deleteAccountData).toHaveBeenCalledWith("user_delete");
    expect(deleteClerkUser).toHaveBeenCalledWith("user_delete");
  });

  it("requires a fresh Clerk reverification before deletion", async () => {
    const deleteAccountData = vi.fn(async () => ({ documents: 0, settings: 0, sources: 0, uploads: 0 }));
    const deleteClerkUser = vi.fn(async () => undefined);
    const { app } = createTestApp({ deleteAccountData }, deleteClerkUser, vi.fn(() => false));

    const response = await request(app).delete("/api/account").expect(403);

    expect(response.body).toMatchObject({
      clerk_error: {
        type: "forbidden",
        reason: "reverification-error",
        metadata: { reverification: "strict" }
      }
    });
    expect(deleteAccountData).not.toHaveBeenCalled();
    expect(deleteClerkUser).not.toHaveBeenCalled();
  });

  it("does not delete the Clerk identity when application-data cleanup fails", async () => {
    const deleteAccountData = vi.fn(async () => {
      throw new Error("cleanup failed");
    });
    const deleteClerkUser = vi.fn(async () => undefined);
    const { app } = createTestApp({ deleteAccountData }, deleteClerkUser);

    await request(app).delete("/api/account").expect(500);

    expect(deleteAccountData).toHaveBeenCalledWith("user_delete");
    expect(deleteClerkUser).not.toHaveBeenCalled();
  });

  it("treats an already-deleted Clerk identity as a successful cleanup retry", async () => {
    const deleteAccountData = vi.fn(async () => ({ documents: 0, settings: 0, sources: 0, uploads: 0 }));
    const deleteClerkUser = vi.fn(async () => {
      throw Object.assign(new Error("User not found"), { status: 404 });
    });
    const { app } = createTestApp({ deleteAccountData }, deleteClerkUser);

    await request(app).delete("/api/account").expect(204);

    expect(deleteAccountData).toHaveBeenCalledWith("user_delete");
    expect(deleteClerkUser).toHaveBeenCalledWith("user_delete");
  });
});
