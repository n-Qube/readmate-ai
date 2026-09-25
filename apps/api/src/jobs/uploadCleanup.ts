import { withRlsUser } from "../rls.js";

export type ExpiredUpload = { id: string; userId: string; storageKey: string };

export type UploadCleanupDeps = {
  listExpired(cutoff: Date, limit: number): Promise<ExpiredUpload[]>;
  deleteObject(storageKey: string): Promise<void>;
  /** Deletes the record only while it is still unconverted; returns rows removed. */
  deleteRecordIfPending(userId: string, uploadId: string): Promise<number>;
};

export type UploadCleanupResult = { examined: number; removed: number; retained: number };

export const PENDING_UPLOAD_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/**
 * Removes uploads that were signed but never converted. The object is deleted
 * first; the record (which holds the quota reservation) is removed only after
 * that succeeds, so a failed delete keeps usage accounted for and is retried.
 */
export async function cleanupExpiredUploads(deps: UploadCleanupDeps, now = new Date()): Promise<UploadCleanupResult> {
  const expired = await deps.listExpired(new Date(now.getTime() - PENDING_UPLOAD_MAX_AGE_MS), 100);
  const result: UploadCleanupResult = { examined: expired.length, removed: 0, retained: 0 };
  for (const upload of expired) {
    try {
      await deps.deleteObject(upload.storageKey);
      result.removed += await withRlsUser(upload.userId, () => deps.deleteRecordIfPending(upload.userId, upload.id));
    } catch {
      result.retained += 1;
    }
  }
  return result;
}

export async function prismaUploadCleanupDeps(): Promise<UploadCleanupDeps> {
  const { prisma } = await import("../prisma.js");
  const { SupabaseUploadStorage } = await import("../routes/uploads.js");
  const storage = new SupabaseUploadStorage();
  return {
    listExpired: (cutoff, limit) => prisma.$queryRaw<ExpiredUpload[]>`SELECT * FROM app.list_expired_pending_uploads(${cutoff}, ${limit}::integer)`,
    deleteObject: (storageKey) => storage.deleteFile(storageKey),
    deleteRecordIfPending: async (userId, uploadId) =>
      (await prisma.uploadedFile.deleteMany({ where: { id: uploadId, userId, documentId: null } })).count
  };
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
