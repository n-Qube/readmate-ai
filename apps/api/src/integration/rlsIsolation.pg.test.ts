/**
 * RM-04 real-database acceptance: per-user isolation and account deletion.
 *
 * Runs as the readmate_api role (no superuser, no BYPASSRLS) against a
 * throwaway database with every migration applied. Fixtures are written by the
 * admin connection so the app role is only ever the subject under test.
 * Skipped unless READMATE_PG_TEST_URL and READMATE_PG_ADMIN_URL are set.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const appUrl = process.env.READMATE_PG_TEST_URL;
const adminUrl = process.env.READMATE_PG_ADMIN_URL;

const removedObjects: Array<{ bucket: string; keys: string[] }> = [];
const mediaObjects = new Map<string, string[]>();

vi.mock("../storage.js", () => ({
  getUploadBucket: () => "readmate-uploads",
  getMediaBucket: () => "readmate-media",
  getSupabaseAdminClient: () => ({
    storage: {
      from: (bucket: string) => ({
        list: async (prefix: string) => ({
          data: (mediaObjects.get(prefix) ?? []).map((name) => ({ name, id: name, metadata: {} })),
          error: null
        }),
        remove: async (keys: string[]) => {
          removedObjects.push({ bucket, keys });
          return { data: [], error: null };
        }
      })
    }
  })
}));

/** Every table that holds user data, with how the app role reaches its rows. */
const USER_TABLES = [
  "ReadingDocument", "ReadingBlock", "ReadingSession", "Note", "Highlight", "UserSettings",
  "UploadedFile", "UsageBucket", "SourceSubscription", "LearningFlashcard", "LearningQuizQuestion",
  "LearningQuizAttempt", "WebMcpAuditEvent", "WebMcpStudyPackEffect"
] as const;
type UserTable = (typeof USER_TABLES)[number];

describe.skipIf(!appUrl || !adminUrl)("RM-04 isolation and account deletion against PostgreSQL (app role)", () => {
  let admin: PrismaClient;
  let prisma: typeof import("../prisma.js").prisma;
  let withRlsUser: typeof import("../rls.js").withRlsUser;
  let alice: string;
  let bob: string;
  let seeded: Record<string, { documentId: string; storageKey: string }>;

  beforeAll(async () => {
    process.env.DATABASE_URL = appUrl;
    admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    ({ withRlsUser } = await import("../rls.js"));
    ({ prisma } = await import("../prisma.js"));
    alice = `user_alice_${randomUUID()}`;
    bob = `user_bob_${randomUUID()}`;
    seeded = { [alice]: await seedUser(alice), [bob]: await seedUser(bob) };
  });

  afterAll(async () => {
    await admin?.$disconnect();
    await prisma?.$disconnect();
  });

  async function seedUser(userId: string) {
    const storageKey = `${userId}/uploads/${randomUUID()}.pdf`;
    const document = await admin.readingDocument.create({
      data: {
        userId, title: `Private notes of ${userId}`, sourceType: "pdf",
        blocks: { create: [{ orderIndex: 0, text: "Secret paragraph." }] }
      }
    });
    const highlight = await admin.highlight.create({ data: { userId, documentId: document.id, blockIndex: 0, highlightText: "Secret" } });
    await admin.note.create({ data: { userId, documentId: document.id, highlightId: highlight.id, noteText: "Private note" } });
    await admin.readingSession.create({ data: { userId, documentId: document.id } });
    await admin.learningFlashcard.create({ data: { userId, documentId: document.id, question: "Q?", answer: "A" } });
    await admin.learningQuizQuestion.create({ data: { userId, documentId: document.id, question: "Q?", questionType: "mcq", correctAnswer: "A", explanation: "E" } });
    await admin.learningQuizAttempt.create({ data: { userId, documentId: document.id, answers: "[]", score: 1, total: 1 } });
    await admin.userSettings.create({ data: { userId } });
    await admin.uploadedFile.create({ data: { userId, documentId: document.id, filename: "notes.pdf", mimeType: "application/pdf", byteSize: 2048, storageKey } });
    await admin.usageBucket.create({ data: { userId, kind: "tts_chars", windowStart: new Date("2026-10-01T00:00:00Z"), quantity: 100n } });
    await admin.sourceSubscription.create({ data: { userId, sourceName: "Example feed", rssFeedUrl: "https://example.com/feed.xml" } });
    await admin.webMcpAuditEvent.create({ data: { userId, toolName: "readmate_search_library", actionClass: "read", status: "succeeded" } });
    await admin.webMcpStudyPackEffect.create({ data: { userId, requestId: randomUUID(), actionDigest: "a".repeat(64), documentId: document.id, status: "succeeded" } });
    mediaObjects.set(userId, [`cover-${document.id}.png`]);
    return { documentId: document.id, storageKey };
  }

  /** Rows a user owns in each table, counted by the admin connection. */
  async function ownedRows(userId: string): Promise<Record<UserTable, number>> {
    const counts = {} as Record<UserTable, number>;
    for (const table of USER_TABLES) {
      const rows = table === "ReadingBlock"
        ? await admin.$queryRawUnsafe<Array<{ n: number }>>(
          `SELECT count(*)::int AS n FROM "ReadingBlock" b JOIN "ReadingDocument" d ON d."id" = b."documentId" WHERE d."userId" = $1`, userId)
        : await admin.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "${table}" WHERE "userId" = $1`, userId);
      counts[table] = rows[0]?.n ?? 0;
    }
    return counts;
  }

  /** Rows the app role can see in each table, inside one RLS-scoped transaction. */
  async function visibleRows(userId: string | null): Promise<Record<UserTable, number>> {
    const { withRlsTransaction } = await import("../prisma.js");
    const count = async () => withRlsTransaction(async (tx) => {
      const counts = {} as Record<UserTable, number>;
      for (const table of USER_TABLES) {
        const rows = await tx.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "${table}"`);
        counts[table] = rows[0]?.n ?? 0;
      }
      return counts;
    });
    return userId ? withRlsUser(userId, count) : count();
  }

  it("runs as a role that cannot bypass row-level security or own the tables", async () => {
    const role = await prisma.$queryRaw<Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>>`
      SELECT current_user, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`;
    expect(role[0]).toMatchObject({ current_user: "readmate_api", rolsuper: false, rolbypassrls: false });

    const tables = await admin.$queryRaw<Array<{ relname: string; rls: boolean; owner: string }>>`
      SELECT c.relname, c.relrowsecurity AS rls, pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY(${[...USER_TABLES]})`;
    expect(tables.map((t) => t.relname).sort()).toEqual([...USER_TABLES].sort());
    for (const table of tables) {
      expect({ table: table.relname, rls: table.rls }).toEqual({ table: table.relname, rls: true });
      expect(table.owner).not.toBe("readmate_api");
    }
  });

  it("shows nothing at all when no user is set", async () => {
    const visible = await visibleRows(null);
    for (const table of USER_TABLES) expect({ table, rows: visible[table] }).toEqual({ table, rows: 0 });
  });

  it("ignores the retired service-mode switch", async () => {
    const { withRlsTransaction } = await import("../prisma.js");
    const rows = await withRlsTransaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_service', 'true', true)`;
      return tx.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM "ReadingDocument"`;
    });
    expect(rows[0]?.n).toBe(0);
  });

  it("shows each user exactly their own rows in every table", async () => {
    for (const userId of [alice, bob]) {
      const owned = await ownedRows(userId);
      const visible = await visibleRows(userId);
      for (const table of USER_TABLES) {
        expect(owned[table], `${table} fixture`).toBeGreaterThan(0);
        expect({ table, rows: visible[table] }).toEqual({ table, rows: owned[table] });
      }
    }
  });

  it("cannot read, change or delete another user's rows by id", async () => {
    const target = seeded[alice].documentId;
    const result = await withRlsUser(bob, async () => ({
      read: await prisma.readingDocument.findUnique({ where: { id: target } }),
      blocks: await prisma.readingBlock.count({ where: { documentId: target } }),
      notes: await prisma.note.count({ where: { documentId: target } }),
      updated: (await prisma.readingDocument.updateMany({ where: { id: target }, data: { title: "Hijacked" } })).count,
      settings: (await prisma.userSettings.updateMany({ where: { userId: alice }, data: { voice: "hijacked" } })).count,
      uploads: (await prisma.uploadedFile.deleteMany({ where: { userId: alice } })).count,
      deleted: (await prisma.readingDocument.deleteMany({ where: { id: target } })).count
    }));
    expect(result).toEqual({ read: null, blocks: 0, notes: 0, updated: 0, settings: 0, uploads: 0, deleted: 0 });
    const untouched = await admin.readingDocument.findUnique({ where: { id: target }, select: { title: true } });
    expect(untouched?.title).toBe(`Private notes of ${alice}`);
    expect((await admin.userSettings.findUnique({ where: { userId: alice } }))?.voice).not.toBe("hijacked");
  });

  it("cannot write rows owned by another user", async () => {
    const attempts: Array<[string, () => Promise<unknown>]> = [
      ["ReadingDocument", () => prisma.readingDocument.create({ data: { userId: alice, title: "Planted", sourceType: "pdf" } })],
      ["ReadingBlock", () => prisma.readingBlock.create({ data: { documentId: seeded[alice].documentId, orderIndex: 99, text: "Planted" } })],
      ["UserSettings", () => prisma.userSettings.create({ data: { userId: `${alice}_second` } })],
      ["UploadedFile", () => prisma.uploadedFile.create({ data: { userId: alice, filename: "x.pdf", mimeType: "application/pdf", byteSize: 1, storageKey: `${alice}/x.pdf` } })],
      ["SourceSubscription", () => prisma.sourceSubscription.create({ data: { userId: alice, sourceName: "Planted" } })],
      ["UsageBucket", () => prisma.usageBucket.create({ data: { userId: alice, kind: "tts_chars", windowStart: new Date(), quantity: 0n } })]
    ];
    for (const [table, attempt] of attempts) {
      await expect(withRlsUser(bob, attempt), table).rejects.toThrow();
    }
    // Moving your own row to another user is a write into their data too.
    const own = seeded[bob].documentId;
    await expect(withRlsUser(bob, () => prisma.readingDocument.update({ where: { id: own }, data: { userId: alice } }))).rejects.toThrow();
    expect((await admin.readingDocument.findUnique({ where: { id: own } }))?.userId).toBe(bob);
  });

  it("deleting an account removes all of that user's data and files, and nothing else", async () => {
    const bobBefore = await ownedRows(bob);
    const { PrismaAccountDeletionRepository } = await import("../routes/account.js");
    removedObjects.length = 0;

    const summary = await withRlsUser(alice, () => new PrismaAccountDeletionRepository().deleteAccountData(alice));

    expect(summary).toEqual({ documents: 1, settings: 1, sources: 1, uploads: 1 });
    const aliceAfter = await ownedRows(alice);
    for (const table of USER_TABLES) expect({ table, rows: aliceAfter[table] }).toEqual({ table, rows: 0 });
    expect(await ownedRows(bob)).toEqual(bobBefore);

    const removedKeys = removedObjects.flatMap((entry) => entry.keys.map((key) => `${entry.bucket}:${key}`));
    expect(removedKeys.sort()).toEqual([
      `readmate-media:${alice}/cover-${seeded[alice].documentId}.png`,
      `readmate-uploads:${seeded[alice].storageKey}`
    ].sort());
  });

  it("blocks new data for a deleted account and can safely be repeated", async () => {
    await expect(withRlsUser(alice, () => prisma.readingDocument.create({ data: { userId: alice, title: "After deletion", sourceType: "pdf" } })))
      .rejects.toThrow(/ACCOUNT_DELETION_IN_PROGRESS/);
    await expect(withRlsUser(alice, () => prisma.userSettings.create({ data: { userId: alice } })))
      .rejects.toThrow(/ACCOUNT_DELETION_IN_PROGRESS/);

    const { PrismaAccountDeletionRepository } = await import("../routes/account.js");
    const again = await withRlsUser(alice, () => new PrismaAccountDeletionRepository().deleteAccountData(alice));
    expect(again).toEqual({ documents: 0, settings: 0, sources: 0, uploads: 0 });
    expect(await admin.readingDocument.count({ where: { userId: bob } })).toBe(1);
  });
});
