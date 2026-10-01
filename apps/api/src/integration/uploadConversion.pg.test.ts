/**
 * RM-02 real-database acceptance: PDF conversion is idempotent per upload.
 *
 * Runs only when READMATE_PG_TEST_URL (the readmate_api role, not a superuser)
 * and READMATE_PG_ADMIN_URL (for fixtures) point at a throwaway database with
 * every migration applied. Skipped in the normal unit suite.
 */
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const appUrl = process.env.READMATE_PG_TEST_URL;
const adminUrl = process.env.READMATE_PG_ADMIN_URL;

describe.skipIf(!appUrl || !adminUrl)("RM-02 upload conversion against PostgreSQL (app role)", () => {
  let admin: PrismaClient;
  let repository: import("../routes/uploads.js").PrismaUploadRepository;
  let withRlsUser: typeof import("../rls.js").withRlsUser;
  let prisma: typeof import("../prisma.js").prisma;

  beforeAll(async () => {
    process.env.DATABASE_URL = appUrl;
    admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    ({ withRlsUser } = await import("../rls.js"));
    ({ prisma } = await import("../prisma.js"));
    const { PrismaUploadRepository } = await import("../routes/uploads.js");
    repository = new PrismaUploadRepository();
    const role = await admin.$queryRaw<Array<{ current_user: string }>>`SELECT current_user`;
    expect(role[0]?.current_user).toBe("postgres");
    const appRole = await prisma.$queryRaw<Array<{ current_user: string; rolbypassrls: boolean }>>`
      SELECT current_user, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`;
    expect(appRole[0]).toMatchObject({ current_user: "readmate_api", rolbypassrls: false });
  });

  afterAll(async () => {
    await admin?.$disconnect();
    await prisma?.$disconnect();
  });

  const input = (title = "Lecture notes") => ({
    title,
    sourceType: "pdf" as const,
    category: "Documents",
    sourceLabel: "PDF upload",
    provider: "google" as const,
    voice: "en-US-Neural2-F",
    speed: 1,
    progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 },
    blocks: [{ orderIndex: 0, blockType: "page" as const, text: "Page 1 readable text for the conversion test.", sourcePageNumber: 1 }]
  });

  async function newUpload(userId: string) {
    return withRlsUser(userId, () => repository.createUpload(userId, { filename: "notes.pdf", mimeType: "application/pdf", byteSize: 2048 }, `${userId}/uploads/${randomUUID()}.pdf`));
  }

  async function documentCount(userId: string) {
    return (await admin.readingDocument.count({ where: { userId } }));
  }

  it("binds exactly one document when conversions race (8 concurrent requests)", async () => {
    const userId = `user_race_${randomUUID()}`;
    const upload = await newUpload(userId);

    const results = await Promise.all(Array.from({ length: 8 }, () =>
      withRlsUser(userId, () => repository.createBoundDocument(userId, upload.id, input()))
    ));

    const ids = new Set(results.map((result) => result.document.id));
    expect(ids.size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(await documentCount(userId)).toBe(1);
    const bound = await admin.uploadedFile.findUnique({ where: { id: upload.id }, select: { documentId: true } });
    expect(bound?.documentId).toBe([...ids][0]);
  });

  it("returns the canonical document on a sequential retry without creating another", async () => {
    const userId = `user_retry_${randomUUID()}`;
    const upload = await newUpload(userId);
    const first = await withRlsUser(userId, () => repository.createBoundDocument(userId, upload.id, input()));
    const retry = await withRlsUser(userId, () => repository.createBoundDocument(userId, upload.id, input("Renamed")));

    expect(first.created).toBe(true);
    expect(retry).toMatchObject({ created: false, document: { id: first.document.id, title: "Lecture notes" } });
    expect(await documentCount(userId)).toBe(1);
  });

  it("cannot bind or create documents through another user's upload", async () => {
    const owner = `user_owner_${randomUUID()}`;
    const intruder = `user_intruder_${randomUUID()}`;
    const upload = await newUpload(owner);

    await expect(withRlsUser(intruder, () => repository.createBoundDocument(intruder, upload.id, input()))).rejects.toThrow();
    expect(await documentCount(intruder)).toBe(0);
    const bound = await admin.uploadedFile.findUnique({ where: { id: upload.id }, select: { documentId: true } });
    expect(bound?.documentId).toBeNull();
  });

  it("hides another user's upload and documents under RLS", async () => {
    const owner = `user_rls_${randomUUID()}`;
    const other = `user_rls_other_${randomUUID()}`;
    const upload = await newUpload(owner);
    await withRlsUser(owner, () => repository.createBoundDocument(owner, upload.id, input()));

    const visibleUploads = await withRlsUser(other, () => prisma.uploadedFile.findMany({ where: { id: upload.id } }));
    const visibleDocuments = await withRlsUser(other, () => prisma.readingDocument.findMany({ where: { userId: owner } }));
    expect(visibleUploads).toHaveLength(0);
    expect(visibleDocuments).toHaveLength(0);
  });

  it("creates nothing for an account behind the deletion fence", async () => {
    const userId = `user_fenced_${randomUUID()}`;
    const upload = await newUpload(userId);
    const userHash = createHash("sha256").update(userId, "utf8").digest("hex");
    await admin.$executeRaw`INSERT INTO "AccountDeletionFence" ("userHash") VALUES (${userHash})`;

    await expect(withRlsUser(userId, () => repository.createBoundDocument(userId, upload.id, input()))).rejects.toThrow(/ACCOUNT_DELETION_IN_PROGRESS/);
    expect(await documentCount(userId)).toBe(0);
    const bound = await admin.uploadedFile.findUnique({ where: { id: upload.id }, select: { documentId: true } });
    expect(bound?.documentId).toBeNull();
  });
});
