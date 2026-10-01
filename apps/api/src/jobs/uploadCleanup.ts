import { withRlsUser } from "../rls.js";

export type ExpiredUpload = { id: string; userId: string; storageKey: string };

export type UploadCleanupDeps = {
  listExpired(cutoff: Date, limit: number): Promise<ExpiredUpload[]>;
  /** Claims pending deletion durably before removing the object and record. */
  removeIfPending(upload: ExpiredUpload, cutoff: Date): Promise<number>;
};

export type UploadCleanupResult = { examined: number; removed: number; retained: number };

export const PENDING_UPLOAD_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/**
 * Removes uploads that were signed but never converted. The object is deleted
 * first; the record (which holds the quota reservation) is removed only after
 * that succeeds, so a failed delete keeps usage accounted for and is retried.
 */
export async function cleanupExpiredUploads(deps: UploadCleanupDeps, now = new Date()): Promise<UploadCleanupResult> {
  const cutoff = new Date(now.getTime() - PENDING_UPLOAD_MAX_AGE_MS);
  const expired = await deps.listExpired(cutoff, 100);
  const result: UploadCleanupResult = { examined: expired.length, removed: 0, retained: 0 };
  for (const upload of expired) {
    try {
      result.removed += await withRlsUser(upload.userId, () => deps.removeIfPending(upload, cutoff));
    } catch {
      result.retained += 1;
    }
  }
  return result;
}

export async function prismaUploadCleanupDeps(deleteObject?: (key: string) => Promise<void>): Promise<UploadCleanupDeps> {
  const { prisma } = await import("../prisma.js");
  const { SupabaseUploadStorage } = await import("../routes/uploads.js");
  const removeObject = deleteObject ?? ((key: string) => new SupabaseUploadStorage().deleteFile(key));
  return {
    listExpired: (cutoff, limit) => prisma.$queryRaw<ExpiredUpload[]>`SELECT * FROM app.list_expired_pending_uploads(${cutoff}, ${limit}::integer)`,
    removeIfPending: (upload, cutoff) => removePendingUpload(upload, removeObject, cutoff)
  };
}

/** Claim deletion durably before touching storage. Conversion checks this marker
 * under the same locks, so storage timeouts and process restarts cannot reopen
 * conversion while a remote delete may still be in flight.
 */
export async function removePendingUpload(
  upload: ExpiredUpload,
  deleteObject: (key: string) => Promise<void>,
  cutoff?: Date
): Promise<number> {
  const { withRlsTransaction, prisma } = await import("../prisma.js");
  return withRlsUser(upload.userId, async () => {
    const claimed = await withRlsTransaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${upload.userId}, 0))`;
      const pending = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "UploadedFile"
        WHERE "id" = ${upload.id} AND "userId" = ${upload.userId}
          AND "storageKey" = ${upload.storageKey} AND "documentId" IS NULL
          AND (${cutoff ?? null}::timestamp IS NULL OR "createdAt" < ${cutoff ?? null}::timestamp)
        FOR UPDATE`;
      if (!pending.length) return false;
      await tx.$executeRaw`UPDATE "UploadedFile" SET "cleanupStartedAt" = COALESCE("cleanupStartedAt", CURRENT_TIMESTAMP)
        WHERE "id" = ${upload.id} AND "userId" = ${upload.userId}`;
      return true;
    });
    if (!claimed) return 0;
    await deleteObject(upload.storageKey);
    return (await prisma.uploadedFile.deleteMany({ where: { id: upload.id, userId: upload.userId, documentId: null, cleanupStartedAt: { not: null } } })).count;
  });
}

let running = false;
let timer: NodeJS.Timeout | null = null;

export function startUploadCleanupWorker(): void {
  if (process.env.ENABLE_UPLOAD_CLEANUP_WORKER === "false" || timer) return;
  const intervalMs = 30 * 60_000;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await cleanupExpiredUploads(await prismaUploadCleanupDeps());
      console.log(JSON.stringify({ event: "upload_cleanup_worker_run", ...result }));
    } catch (error) {
      console.error(JSON.stringify({ event: "upload_cleanup_worker_error", message: error instanceof Error ? error.message : "Unknown upload cleanup error." }));
    } finally {
      running = false;
    }
  };
  timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 60_000).unref?.();
  console.log("ReadMate upload cleanup worker enabled every 30 minutes.");
}
