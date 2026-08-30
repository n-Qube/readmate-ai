import { describe, expect, it, vi } from "vitest";
import { cacheRemoteCoverImages, type MediaStorage } from "./media.js";

describe("cacheRemoteCoverImages", () => {
  it("does not invoke the fetcher for a loopback image URL", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const mediaStorage: MediaStorage = {
      async uploadPublicObject(storageKey) {
        return { storageKey, publicUrl: `https://media.example/${storageKey}` };
      },
      async deletePublicObjects() {
        return;
      }
    };

    const result = await cacheRemoteCoverImages({
      imageUrl: "http://127.0.0.1:8080/internal.png",
      userId: "user_a",
      title: "Blocked image",
      sourceName: "Example",
      category: "News",
      fetcher,
      mediaStorage
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.coverImageUrl).toContain("cover.svg");
    expect(result.thumbnailUrl).toContain("thumb.svg");
  });

  it("returns exact action-scoped storage keys for later compensation", async () => {
    const mediaStorage: MediaStorage = {
      async uploadPublicObject(storageKey) {
        return { storageKey, publicUrl: `https://media.example/${storageKey}` };
      },
      async deletePublicObjects() {
        return;
      }
    };

    const result = await cacheRemoteCoverImages({
      userId: "user_a",
      title: "Scoped cover",
      sourceName: "Example",
      category: "News",
      fetcher: vi.fn<typeof fetch>(),
      mediaStorage,
      storageKeySuffix: "rss-action-123",
      requireCleanup: true
    });

    expect(result.storageKeys).toEqual([
      "user_a/documents/scoped-cover-rss-action-123/cover.svg",
      "user_a/documents/scoped-cover-rss-action-123/thumb.svg"
    ]);
  });

  it("removes a successful half of a failed cover pair", async () => {
    const deletePublicObjects = vi.fn(async () => undefined);
    const mediaStorage: MediaStorage = {
      async uploadPublicObject(storageKey) {
        if (storageKey.endsWith("thumb.svg")) throw new Error("thumbnail upload failed");
        return { storageKey, publicUrl: `https://media.example/${storageKey}` };
      },
      deletePublicObjects
    };

    const result = await cacheRemoteCoverImages({
      userId: "user_a",
      title: "Partial cover",
      sourceName: "Example",
      category: "News",
      fetcher: vi.fn<typeof fetch>(),
      mediaStorage,
      storageKeySuffix: "rss-action-456",
      requireCleanup: true
    });

    expect(result).toEqual({});
    expect(deletePublicObjects).toHaveBeenCalledWith([
      "user_a/documents/partial-cover-rss-action-456/cover.svg"
    ]);
  });
});
