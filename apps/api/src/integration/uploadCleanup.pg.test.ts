/** Scheduled abandoned-upload cleanup against PostgreSQL as the app role (RM-03). */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const appUrl = process.env.READMATE_PG_TEST_URL;
const adminUrl = process.env.READMATE_PG_ADMIN_URL;

describe.skipIf(!appUrl || !adminUrl)("abandoned upload cleanup against PostgreSQL (app role)", () => {
  let admin: PrismaClient;
  let prisma: typeof import("../prisma.js").prisma;
  let cleanup: typeof import("../jobs/uploadCleanup.js");

  beforeAll(async () => {
    process.env.DATABASE_URL = appUrl;
    admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    ({ prisma } = await import("../prisma.js"));
    cleanup = await import("../jobs/uploadCleanup.js");
  });
  afterAll(async () => {
    await admin?.$disconnect();
    await prisma?.$disconnect();
  });

  async function upload(userId: string, hoursAgo: number, documentId: string | null = null) {
    const id = randomUUID();
    await admin.$executeRaw`
      INSERT INTO "UploadedFile" ("id","userId","documentId","filename","mimeType","byteSize","storageKey","createdAt")
      VALUES (${id}, ${userId}, ${documentId}, 'n.pdf', 'application/pdf', 1024, ${`${userId}/${id}.pdf`}, NOW() - (${hoursAgo} * INTERVAL '1 hour'))`;
    return id;
  }

  it("lists and removes abandoned uploads across users, sparing fresh and converted ones", async () => {
    const alice = `cleanup_alice_${randomUUID()}`;
    const bob = `cleanup_bob_${randomUUID()}`;
    const doc = await admin.readingDocument.create({ data: { userId: bob, title: "Converted", sourceType: "pdf", provider: "google", voice: "en-US-Neural2-F", speed: 1 } });
    const oldAlice = await upload(alice, 5);
    const oldBob = await upload(bob, 6);
    const fresh = await upload(alice, 1);
    const converted = await upload(bob, 8, doc.id);

    const deletedObjects: string[] = [];
    const real = await cleanup.prismaUploadCleanupDeps(async (key) => { deletedObjects.push(key); });
    const result = await cleanup.cleanupExpiredUploads({
      listExpired: async (cutoff, limit) => (await real.listExpired(cutoff, limit)).filter((u) => [alice, bob].includes(u.userId)),
      removeIfPending: real.removeIfPending
    });

    expect(result).toMatchObject({ examined: 2, removed: 2, retained: 0 });
    const remaining = await admin.uploadedFile.findMany({ where: { userId: { in: [alice, bob] } }, select: { id: true } });
    expect(remaining.map((u) => u.id).sort()).toEqual([fresh, converted].sort());
    expect(deletedObjects.sort()).toEqual([`${alice}/${oldAlice}.pdf`, `${bob}/${oldBob}.pdf`].sort());
  });

  it("preserves the original when conversion wins after the cleanup listing", async () => {
    const userId = `cleanup_converted_${randomUUID()}`;
    const id = await upload(userId, 5);
    const { withRlsUser } = await import("../rls.js");
    const { PrismaUploadRepository } = await import("../routes/uploads.js");
    const deleted: string[] = [];
    const real = await cleanup.prismaUploadCleanupDeps(async (key) => { deleted.push(key); });
    const cutoff = new Date(Date.now() - cleanup.PENDING_UPLOAD_MAX_AGE_MS);
    const candidate = (await real.listExpired(cutoff, 100)).find((u) => u.id === id)!;
    const converted = await withRlsUser(userId, () => new PrismaUploadRepository().createBoundDocument(userId, id, {
      title: "Converted", sourceType: "pdf", provider: "google", voice: "en-US-Neural2-F", speed: 1,
      progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 },
      blocks: [{ orderIndex: 0, blockType: "page", text: "Original PDF text" }]
    }));
    expect(await real.removeIfPending(candidate, cutoff)).toBe(0);
    expect(deleted).toEqual([]);
    expect((await admin.uploadedFile.findUnique({ where: { id } }))?.documentId).toBe(converted.document.id);
  });

  it("rejects conversion while claimed storage deletion is in flight", async () => {
    const userId = `cleanup_race_${randomUUID()}`;
    const id = await upload(userId, 5);
    const { withRlsUser } = await import("../rls.js");
    const { PrismaUploadRepository } = await import("../routes/uploads.js");
    let entered!: () => void;
    let release!: () => void;
    const deleting = new Promise<void>((resolve) => { entered = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const real = await cleanup.prismaUploadCleanupDeps(async () => { entered(); await released; });
    const cutoff = new Date(Date.now() - cleanup.PENDING_UPLOAD_MAX_AGE_MS);
    const candidate = (await real.listExpired(cutoff, 100)).find((u) => u.id === id)!;
    const removal = real.removeIfPending(candidate, cutoff);
    await deleting;
    const conversion = withRlsUser(userId, () => new PrismaUploadRepository().createBoundDocument(userId, id, {
      title: "Racing", sourceType: "pdf", provider: "google", voice: "en-US-Neural2-F", speed: 1,
      progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 },
      blocks: [{ orderIndex: 0, blockType: "page", text: "Original PDF text" }]
    }));
    // Conversion must reject before deletion finishes, rather than relying on a
    // transaction staying alive for the duration of an external storage call.
    try {
      await expect(conversion).rejects.toThrow(/expired or is being removed/);
      expect(await admin.readingDocument.count({ where: { userId } })).toBe(0);
    } finally { release(); }
    const [removed, converted] = await Promise.allSettled([removal, conversion]);
    expect(removed).toMatchObject({ status: "fulfilled", value: 1 });
    expect(converted.status).toBe("rejected");
    expect(await admin.readingDocument.count({ where: { userId } })).toBe(0);
    expect(await admin.uploadedFile.findUnique({ where: { id } })).toBeNull();
  });

  it("retains a durable claim on storage failure and retries cleanup safely", async () => {
    const userId = `cleanup_failure_${randomUUID()}`;
    const id = await upload(userId, 5);
    const real = await cleanup.prismaUploadCleanupDeps(async () => { throw new Error("Storage unavailable"); });
    const cutoff = new Date(Date.now() - cleanup.PENDING_UPLOAD_MAX_AGE_MS);
    const candidate = (await real.listExpired(cutoff, 100)).find((u) => u.id === id)!;
    await expect(real.removeIfPending(candidate, cutoff)).rejects.toThrow("Storage unavailable");
    expect((await admin.uploadedFile.findUnique({ where: { id } }))?.documentId).toBeNull();
    expect((await admin.uploadedFile.findUnique({ where: { id } }))?.cleanupStartedAt).toBeInstanceOf(Date);
    // Older revisions do not know the marker; the database invariant still
    // rolls back their create-and-bind transaction during rollout/rollback.
    await expect(admin.$transaction(async (tx) => {
      const document = await tx.readingDocument.create({ data: { userId, title: "Legacy", sourceType: "pdf", provider: "google", voice: "en-US-Neural2-F", speed: 1 } });
      await tx.uploadedFile.update({ where: { id }, data: { documentId: document.id } });
    })).rejects.toThrow(/UploadedFile_cleanup_pending_only/);
    expect(await admin.readingDocument.count({ where: { userId } })).toBe(0);
    const { withRlsUser } = await import("../rls.js");
    const { PrismaUploadRepository } = await import("../routes/uploads.js");
    await expect(withRlsUser(userId, () => new PrismaUploadRepository().createBoundDocument(userId, id, {
      title: "Retry", sourceType: "pdf", provider: "google", voice: "en-US-Neural2-F", speed: 1,
      progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 },
      blocks: [{ orderIndex: 0, blockType: "page", text: "Original PDF text" }]
    }))).rejects.toThrow(/expired or is being removed/);
    const retriedDeletes: string[] = [];
    const retry = await cleanup.prismaUploadCleanupDeps(async (key) => { retriedDeletes.push(key); });
    expect(await retry.removeIfPending(candidate, cutoff)).toBe(1);
    expect(retriedDeletes).toEqual([candidate.storageKey]);
    expect(await admin.uploadedFile.findUnique({ where: { id } })).toBeNull();
  });

  it("resumes after a crash following object deletion but before reservation release", async () => {
    const userId = `cleanup_restart_${randomUUID()}`;
    const id = await upload(userId, 5);
    // Persist the exact state left after claim commit and successful storage
    // deletion if the process dies before removing the database reservation.
    await admin.$executeRaw`UPDATE "UploadedFile" SET "cleanupStartedAt" = NOW() WHERE "id" = ${id}`;
    const remainingObjects = new Set<string>();
    const deleted: string[] = [];
    const restarted = await cleanup.prismaUploadCleanupDeps(async (key) => {
      remainingObjects.delete(key); // Storage remove is idempotent for absent objects.
      deleted.push(key);
    });
    const result = await cleanup.cleanupExpiredUploads({
      listExpired: async (cutoff, limit) => (await restarted.listExpired(cutoff, limit)).filter((u) => u.id === id),
      removeIfPending: restarted.removeIfPending
    });
    expect(result).toEqual({ examined: 1, removed: 1, retained: 0 });
    expect(deleted).toEqual([`${userId}/${id}.pdf`]);
    expect(await admin.uploadedFile.findUnique({ where: { id } })).toBeNull();
  });

  it("rechecks age and object identity before claiming a stale candidate", async () => {
    const userId = `cleanup_stale_${randomUUID()}`;
    const id = await upload(userId, 1);
    const deleted: string[] = [];
    const real = await cleanup.prismaUploadCleanupDeps(async (key) => { deleted.push(key); });
    const cutoff = new Date(Date.now() - cleanup.PENDING_UPLOAD_MAX_AGE_MS);
    const candidate = { id, userId, storageKey: `${userId}/${id}.pdf` };
    expect(await real.removeIfPending(candidate, cutoff)).toBe(0);
    expect(await real.removeIfPending({ ...candidate, storageKey: "stale/key.pdf" })).toBe(0);
    expect(deleted).toEqual([]);
    expect((await admin.uploadedFile.findUnique({ where: { id } }))?.cleanupStartedAt).toBeNull();
  });

  it("does not let the app role read other users' uploads directly", async () => {
    const carol = `cleanup_carol_${randomUUID()}`;
    await upload(carol, 5);
    const direct = await prisma.uploadedFile.findMany({ where: { userId: carol } });
    expect(direct).toHaveLength(0);
  });
});
