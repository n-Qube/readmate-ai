import { describe, expect, it } from "vitest";
import { cleanupExpiredUploads, type ExpiredUpload } from "./uploadCleanup.js";

function deps(expired: ExpiredUpload[], options: { failDeleteFor?: string; boundIds?: string[] } = {}) {
  const deletedObjects: string[] = [];
  const deletedRecords: string[] = [];
  return {
    deletedObjects,
    deletedRecords,
    listExpired: async () => expired,
    deleteObject: async (key: string) => {
      if (key === options.failDeleteFor) throw new Error("storage timeout");
      deletedObjects.push(key);
    },
    deleteRecordIfPending: async (_userId: string, id: string) => {
      if (options.boundIds?.includes(id)) return 0;
      deletedRecords.push(id);
      return 1;
    }
  };
}

const uploads: ExpiredUpload[] = [
  { id: "u1", userId: "alice", storageKey: "alice/a.pdf" },
  { id: "u2", userId: "bob", storageKey: "bob/b.pdf" }
];

describe("cleanupExpiredUploads", () => {
  it("removes abandoned uploads for every user without them signing in", async () => {
    const d = deps(uploads);
    expect(await cleanupExpiredUploads(d)).toEqual({ examined: 2, removed: 2, retained: 0 });
    expect(d.deletedObjects).toEqual(["alice/a.pdf", "bob/b.pdf"]);
    expect(d.deletedRecords).toEqual(["u1", "u2"]);
  });

  it("keeps the reservation when the storage delete fails, for a later retry", async () => {
    const d = deps(uploads, { failDeleteFor: "alice/a.pdf" });
    expect(await cleanupExpiredUploads(d)).toEqual({ examined: 2, removed: 1, retained: 1 });
    expect(d.deletedRecords).toEqual(["u2"]);
  });

  it("does not count an upload that was converted in the meantime", async () => {
    const d = deps(uploads, { boundIds: ["u2"] });
    expect(await cleanupExpiredUploads(d)).toEqual({ examined: 2, removed: 1, retained: 0 });
  });
});
