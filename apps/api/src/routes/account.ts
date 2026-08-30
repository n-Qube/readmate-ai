import { clerkClient, getAuth } from "@clerk/express";
import { reverificationError } from "@clerk/backend/internal";
import type { Response, Router } from "express";
import { Router as createRouter } from "express";
import { getUserId, type AuthedRequest } from "../auth.js";
import type { prisma as PrismaSingleton } from "../prisma.js";
import { getMediaBucket, getSupabaseAdminClient, getUploadBucket } from "../storage.js";
import { beginAccountDeletionFence } from "../webmcp/accountDeletionFence.js";

export type AccountDeletionSummary = {
  documents: number;
  settings: number;
  sources: number;
  uploads: number;
};

export type AccountDeletionRepository = {
  deleteAccountData(userId: string): Promise<AccountDeletionSummary>;
};

type AccountRouterDeps = {
  repository?: AccountDeletionRepository;
  deleteClerkUser?: (userId: string) => Promise<void>;
  hasRecentVerification?: (req: AuthedRequest) => boolean;
};

export function accountRouter(deps: AccountRouterDeps = {}): Router {
  const router = createRouter();
  const repository = deps.repository ?? new PrismaAccountDeletionRepository();
  const deleteClerkUser = deps.deleteClerkUser ?? ((userId) => clerkClient.users.deleteUser(userId).then(() => undefined));
  const hasRecentVerification = deps.hasRecentVerification ?? ((req) => getAuth(req).has({ reverification: "strict" }));

  router.delete("/", async (req: AuthedRequest, res: Response, next) => {
    try {
      if (!hasRecentVerification(req)) {
        res.status(403).json(reverificationError("strict"));
        return;
      }
      const userId = getUserId(req);
      await repository.deleteAccountData(userId);
      try {
        await deleteClerkUser(userId);
      } catch (error) {
        if (!isAlreadyDeletedClerkUser(error)) throw error;
      }
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function isAlreadyDeletedClerkUser(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { status?: unknown; statusCode?: unknown };
  return value.status === 404 || value.statusCode === 404;
}

export class PrismaAccountDeletionRepository implements AccountDeletionRepository {
  async deleteAccountData(userId: string): Promise<AccountDeletionSummary> {
    await beginAccountDeletionFence(userId);
    const prisma = await getPrisma();
    const uploads = await prisma.uploadedFile.findMany({ where: { userId }, select: { storageKey: true } });
    await removeUploadObjects(uploads.map((upload) => upload.storageKey));
    await removeMediaObjects(userId);

    const [, , , uploadResult, sourceResult, settingsResult, documentResult] = await prisma.$transaction([
      prisma.webMcpAuditEvent.deleteMany({ where: { userId } }),
      prisma.webMcpStudyPackEffect.deleteMany({ where: { userId } }),
      prisma.usageBucket.deleteMany({ where: { userId } }),
      prisma.uploadedFile.deleteMany({ where: { userId } }),
      prisma.sourceSubscription.deleteMany({ where: { userId } }),
      prisma.userSettings.deleteMany({ where: { userId } }),
      prisma.readingDocument.deleteMany({ where: { userId } })
    ]);

    return {
      documents: documentResult.count,
      settings: settingsResult.count,
      sources: sourceResult.count,
      uploads: uploadResult.count
    };
  }
}

async function removeMediaObjects(userId: string) {
  const bucket = getMediaBucket();
  const storage = getSupabaseAdminClient().storage.from(bucket);
  const pendingPrefixes = [userId];
  const objectKeys: string[] = [];

  while (pendingPrefixes.length) {
    const prefix = pendingPrefixes.shift()!;
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await storage.list(prefix, { limit: 100, offset });
      if (error) throw new Error(`Unable to list generated media: ${error.message}`);
      for (const item of data) {
        const key = `${prefix}/${item.name}`;
        if (item.id || item.metadata) objectKeys.push(key);
        else pendingPrefixes.push(key);
      }
      if (data.length < 100) break;
    }
  }

  for (let index = 0; index < objectKeys.length; index += 100) {
    const removed = await storage.remove(objectKeys.slice(index, index + 100));
    if (removed.error) throw new Error(`Unable to delete generated media: ${removed.error.message}`);
  }
}

async function removeUploadObjects(storageKeys: string[]) {
  const uniqueKeys = [...new Set(storageKeys.filter(Boolean))];
  if (uniqueKeys.length === 0) return;

  const bucket = getUploadBucket();
  const storage = getSupabaseAdminClient().storage.from(bucket);
  for (let index = 0; index < uniqueKeys.length; index += 100) {
    const { error } = await storage.remove(uniqueKeys.slice(index, index + 100));
    if (error) {
      throw new Error(`Unable to delete uploaded files: ${error.message}`);
    }
  }
}

async function getPrisma(): Promise<typeof PrismaSingleton> {
  const module = await import("../prisma.js");
  return module.prisma;
}
