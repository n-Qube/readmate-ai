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
    const real = await cleanup.prismaUploadCleanupDeps();
    const result = await cleanup.cleanupExpiredUploads({
      listExpired: async (cutoff, limit) => (await real.listExpired(cutoff, limit)).filter((u) => [alice, bob].includes(u.userId)),
      deleteObject: async (key) => { deletedObjects.push(key); },
      deleteRecordIfPending: real.deleteRecordIfPending
    });

    expect(result).toMatchObject({ examined: 2, removed: 2, retained: 0 });
    const remaining = await admin.uploadedFile.findMany({ where: { userId: { in: [alice, bob] } }, select: { id: true } });
    expect(remaining.map((u) => u.id).sort()).toEqual([fresh, converted].sort());
    expect(deletedObjects.sort()).toEqual([`${alice}/${oldAlice}.pdf`, `${bob}/${oldBob}.pdf`].sort());
  });

  it("does not let the app role read other users' uploads directly", async () => {
    const carol = `cleanup_carol_${randomUUID()}`;
    await upload(carol, 5);
    const direct = await prisma.uploadedFile.findMany({ where: { userId: carol } });
    expect(direct).toHaveLength(0);
  });
});
