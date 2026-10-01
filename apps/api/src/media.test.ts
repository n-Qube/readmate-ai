import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { cacheRemoteCoverImages, type MediaStorage } from "./media.js";

const publicLookup = async () => ["93.184.216.34"];
const uploadOnlyStorage: MediaStorage = {
  async uploadPublicObject(storageKey) {
    return { storageKey, publicUrl: `https://media.example/${storageKey}` };
  },
  async deletePublicObjects() {
    return;
  }
};

async function jpegResponse(): Promise<Response> {
  const bytes = await sharp({ create: { width: 16, height: 9, channels: 3, background: "#336699" } }).jpeg().toBuffer();
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/jpeg" } });
}

describe("cacheRemoteCoverImages for HTTPS-only feed syncs", () => {
  it("uses the article's HTTPS image instead of the generated cover", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jpegResponse());
    const result = await cacheRemoteCoverImages({
      imageUrl: "https://images.example.com/story.jpg",
      userId: "user_a",
      title: "Real artwork",
      fetcher,
      lookup: publicLookup,
      mediaStorage: uploadOnlyStorage,
      requireHttps: true
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.coverImageUrl).toContain("cover.webp");
    expect(result.thumbnailUrl).toContain("thumb.webp");
  });

  it("does not fetch a plain-HTTP image", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jpegResponse());
    const result = await cacheRemoteCoverImages({
      imageUrl: "http://images.example.com/story.jpg",
      userId: "user_a",
      title: "Insecure artwork",
      fetcher,
      lookup: publicLookup,
      mediaStorage: uploadOnlyStorage,
      requireHttps: true
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.coverImageUrl).toContain("cover.svg");
  });

  it("does not follow an HTTPS image redirect to HTTP", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => String(url).startsWith("https:")
      ? new Response(null, { status: 302, headers: { location: "http://images.example.com/story.jpg" } })
      : jpegResponse());
    const result = await cacheRemoteCoverImages({
      imageUrl: "https://images.example.com/story.jpg",
      userId: "user_a",
      title: "Downgraded artwork",
      fetcher,
      lookup: publicLookup,
      mediaStorage: uploadOnlyStorage,
      requireHttps: true
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.coverImageUrl).toContain("cover.svg");
  });
});

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
