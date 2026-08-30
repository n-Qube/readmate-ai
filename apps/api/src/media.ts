import sharp from "sharp";
import { getMediaBucket, getSupabaseAdminClient, toPlainUint8Array } from "./storage.js";
import { safeRemoteFetch, type HostLookup } from "./safeRemoteFetch.js";

export type MediaUploadResult = {
  storageKey: string;
  publicUrl: string;
};

export type MediaStorage = {
  uploadPublicObject(storageKey: string, bytes: Uint8Array, mimeType: string): Promise<MediaUploadResult>;
  deletePublicObjects?(storageKeys: string[]): Promise<void>;
};

export class SupabaseMediaStorage implements MediaStorage {
  async uploadPublicObject(storageKey: string, bytes: Uint8Array, mimeType: string): Promise<MediaUploadResult> {
    const bucket = getMediaBucket();
    const client = getSupabaseAdminClient();
    const { error } = await client.storage.from(bucket).upload(storageKey, toPlainUint8Array(bytes), {
      contentType: mimeType,
      upsert: true
    });
    if (error) throw new Error(`Unable to cache media asset: ${error.message}`);
    const expiresIn = Number(process.env.SUPABASE_MEDIA_SIGNED_URL_TTL_SECONDS ?? 86_400);
    const { data, error: signedUrlError } = await client.storage
      .from(bucket)
      .createSignedUrl(storageKey, Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 86_400);
    if (signedUrlError || !data?.signedUrl) {
      const uploadError = new Error(`Unable to create signed media URL: ${signedUrlError?.message ?? "missing signed URL"}`);
      try {
        await this.deletePublicObjects([storageKey]);
      } catch (cleanupError) {
        throw new CachedMediaCleanupError([storageKey], uploadError, cleanupError);
      }
      throw uploadError;
    }
    return { storageKey, publicUrl: data.signedUrl };
  }

  async deletePublicObjects(storageKeys: string[]): Promise<void> {
    if (!storageKeys.length) return;
    const bucket = getMediaBucket();
    const client = getSupabaseAdminClient();
    const { error } = await client.storage.from(bucket).remove(storageKeys);
    if (error) throw new Error(`Unable to remove cached media assets: ${error.message}`);
  }
}

export type CachedCoverImages = {
  thumbnailUrl?: string;
  coverImageUrl?: string;
  storageKeys?: string[];
};

export class CachedMediaCleanupError extends Error {
  readonly name = "CachedMediaCleanupError";

  constructor(
    public readonly storageKeys: string[],
    public readonly uploadError: unknown,
    public readonly cleanupError: unknown
  ) {
    super("Cached cover upload failed and its partial upload could not be removed.", {
      cause: { uploadError, cleanupError }
    });
  }
}

export async function cacheRemoteCoverImages(input: {
  imageUrl?: string;
  userId: string;
  title: string;
  sourceName?: string;
  category?: string;
  fetcher: typeof fetch;
  lookup?: HostLookup;
  mediaStorage: MediaStorage;
  storageKeySuffix?: string;
  requireCleanup?: boolean;
}): Promise<CachedCoverImages> {
  const baseKey = mediaBaseKey(input.userId, input.title, input.storageKeySuffix);
  if (input.imageUrl) {
    try {
      const downloaded = await downloadImage(input.imageUrl, input.fetcher, input.lookup);
      if (downloaded) {
        const cover = await sharp(downloaded)
          .rotate()
          .resize(1200, 675, { fit: "cover", position: "attention" })
          .webp({ quality: 82 })
          .toBuffer();
        const thumb = await sharp(downloaded)
          .rotate()
          .resize(480, 270, { fit: "cover", position: "attention" })
          .webp({ quality: 78 })
          .toBuffer();
        return await uploadCoverPair({
          mediaStorage: input.mediaStorage,
          cover: { storageKey: `${baseKey}/cover.webp`, bytes: cover, mimeType: "image/webp" },
          thumbnail: { storageKey: `${baseKey}/thumb.webp`, bytes: thumb, mimeType: "image/webp" }
        });
      }
    } catch (error) {
      if (input.requireCleanup && error instanceof CachedMediaCleanupError) throw error;
      console.warn("ReadMate media caching failed; falling back to generated cover.", error);
    }
  }

  try {
    return await createBrandedCoverImages({
      mediaStorage: input.mediaStorage,
      baseKey,
      title: input.title,
      sourceName: input.sourceName,
      category: input.category
    });
  } catch (error) {
    if (input.requireCleanup && error instanceof CachedMediaCleanupError) throw error;
    console.warn("ReadMate fallback cover generation failed; continuing without cached media.", error);
    return input.imageUrl ? { coverImageUrl: input.imageUrl, thumbnailUrl: input.imageUrl } : {};
  }
}

export async function createPdfFirstPageCoverImages(input: {
  mediaStorage: MediaStorage;
  userId: string;
  title: string;
  pageCount: number;
  firstPageText?: string;
}): Promise<CachedCoverImages> {
  try {
    return await createBrandedCoverImages({
      mediaStorage: input.mediaStorage,
      baseKey: mediaBaseKey(input.userId, input.title),
      title: input.title,
      sourceName: `${input.pageCount} page${input.pageCount === 1 ? "" : "s"}`,
      category: "PDF",
      body: undefined
    });
  } catch (error) {
    console.warn("ReadMate PDF cover generation failed; continuing without cached media.", error);
    return {};
  }
}

async function createBrandedCoverImages(input: {
  mediaStorage: MediaStorage;
  baseKey: string;
  title: string;
  sourceName?: string;
  category?: string;
  body?: string;
}): Promise<CachedCoverImages> {
  const cover = svgCover({
    width: 1200,
    height: 675,
    title: input.title,
    sourceName: input.sourceName,
    category: input.category,
    body: input.body
  });
  const thumb = svgCover({
    width: 480,
    height: 270,
    title: input.title,
    sourceName: input.sourceName,
    category: input.category,
    body: input.body
  });
  return uploadCoverPair({
    mediaStorage: input.mediaStorage,
    cover: { storageKey: `${input.baseKey}/cover.svg`, bytes: Buffer.from(cover), mimeType: "image/svg+xml" },
    thumbnail: { storageKey: `${input.baseKey}/thumb.svg`, bytes: Buffer.from(thumb), mimeType: "image/svg+xml" }
  });
}

async function uploadCoverPair(input: {
  mediaStorage: MediaStorage;
  cover: { storageKey: string; bytes: Uint8Array; mimeType: string };
  thumbnail: { storageKey: string; bytes: Uint8Array; mimeType: string };
}): Promise<CachedCoverImages> {
  const uploads = await Promise.allSettled([
    input.mediaStorage.uploadPublicObject(input.cover.storageKey, input.cover.bytes, input.cover.mimeType),
    input.mediaStorage.uploadPublicObject(input.thumbnail.storageKey, input.thumbnail.bytes, input.thumbnail.mimeType)
  ]);
  const uploadedKeys = uploads.flatMap((result) => result.status === "fulfilled" ? [result.value.storageKey] : []);
  const rejected = uploads.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (rejected.length) {
    const residualKeys = rejected.flatMap((result) =>
      result.reason instanceof CachedMediaCleanupError ? result.reason.storageKeys : []
    );
    const cleanupKeys = [...new Set([...uploadedKeys, ...residualKeys])];
    if (cleanupKeys.length && input.mediaStorage.deletePublicObjects) {
      try {
        await input.mediaStorage.deletePublicObjects(cleanupKeys);
      } catch (cleanupError) {
        throw new CachedMediaCleanupError(cleanupKeys, rejected[0]?.reason, cleanupError);
      }
    }
    const firstError = rejected[0]?.reason;
    if (firstError instanceof CachedMediaCleanupError && cleanupKeys.length && input.mediaStorage.deletePublicObjects) {
      throw firstError.uploadError;
    }
    throw firstError;
  }
  const [coverResult, thumbResult] = uploads.map((result) => (result as PromiseFulfilledResult<MediaUploadResult>).value);
  return {
    coverImageUrl: coverResult.publicUrl,
    thumbnailUrl: thumbResult.publicUrl,
    storageKeys: [coverResult.storageKey, thumbResult.storageKey]
  };
}

async function downloadImage(imageUrl: string, fetcher: typeof fetch, lookup?: HostLookup): Promise<Uint8Array | null> {
  try {
    const result = await safeRemoteFetch(imageUrl, {
      fetcher,
      lookup,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ReadMateAI/1.0; +https://readmate.ai)",
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8"
      },
      maxBytes: 8 * 1024 * 1024
    });
    const contentType = result.response.headers.get("content-type") ?? "";
    if (!result.response.ok || !/^image\//i.test(contentType)) return null;
    if (!result.body.byteLength) return null;
    return result.body;
  } catch {
    return null;
  }
}

function mediaBaseKey(userId: string, title: string, storageKeySuffix?: string): string {
  const safeSuffix = storageKeySuffix?.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  return `${userId}/documents/${slugify(title)}${safeSuffix ? `-${safeSuffix}` : ""}`;
}

function svgCover(input: { width: number; height: number; title: string; sourceName?: string; category?: string; body?: string }): string {
  const palette = paletteForCategory(input.category);
  const title = wrapText(input.title, input.width > 500 ? 34 : 24).slice(0, 4);
  const body = input.body ? wrapText(input.body, input.width > 500 ? 70 : 42).slice(0, 3) : [];
  const titleSize = input.width > 500 ? 58 : 30;
  const bodySize = input.width > 500 ? 28 : 15;
  const labelSize = input.width > 500 ? 24 : 13;
  const titleY = input.width > 500 ? 205 : 82;
  const bodyY = titleY + title.length * (titleSize + 12) + 36;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}">
  <rect width="100%" height="100%" fill="${palette.bg}"/>
  <rect x="${input.width * 0.07}" y="${input.height * 0.11}" width="${input.width * 0.86}" height="${input.height * 0.78}" rx="28" fill="${palette.panel}" opacity="0.96"/>
  <text x="${input.width * 0.12}" y="${input.height * 0.2}" fill="${palette.accent}" font-family="Arial, Helvetica, sans-serif" font-size="${labelSize}" font-weight="700">${escapeXml(input.category ?? "ReadMate")}</text>
  ${input.sourceName ? `<text x="${input.width * 0.12}" y="${input.height * 0.27}" fill="${palette.muted}" font-family="Arial, Helvetica, sans-serif" font-size="${labelSize}">${escapeXml(input.sourceName)}</text>` : ""}
  ${title.map((line, index) => `<text x="${input.width * 0.12}" y="${titleY + index * (titleSize + 12)}" fill="${palette.text}" font-family="Arial, Helvetica, sans-serif" font-size="${titleSize}" font-weight="800">${escapeXml(line)}</text>`).join("")}
  ${body.map((line, index) => `<text x="${input.width * 0.12}" y="${bodyY + index * (bodySize + 8)}" fill="${palette.muted}" font-family="Arial, Helvetica, sans-serif" font-size="${bodySize}">${escapeXml(line)}</text>`).join("")}
</svg>`;
}

function wrapText(value: string, maxLineLength: number): string[] {
  const words = value.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxLineLength && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ["ReadMate AI"];
}

function paletteForCategory(category?: string) {
  switch ((category ?? "").toLowerCase()) {
    case "technology":
      return { bg: "#0b3b4a", panel: "#f8fafc", text: "#102a43", muted: "#486581", accent: "#0e7490" };
    case "business":
      return { bg: "#334155", panel: "#f8fafc", text: "#111827", muted: "#64748b", accent: "#0f766e" };
    case "politics":
      return { bg: "#4c1d1d", panel: "#fff7ed", text: "#1f2937", muted: "#6b7280", accent: "#b45309" };
    case "pdf":
    case "documents":
      return { bg: "#172554", panel: "#eff6ff", text: "#0f172a", muted: "#475569", accent: "#2563eb" };
    default:
      return { bg: "#12343b", panel: "#f8fafc", text: "#102a43", muted: "#627d98", accent: "#0f766e" };
  }
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "readmate-document";
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
