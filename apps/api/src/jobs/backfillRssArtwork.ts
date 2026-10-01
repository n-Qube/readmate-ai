/**
 * One-off repair for RSS items imported before the artwork and title fixes:
 * items saved with the generated SVG cover (HTTPS syncs dropped the image URL)
 * and titles cut at the first apostrophe.
 *
 *   tsx src/jobs/backfillRssArtwork.ts --user <clerk user id> [--execute] [--limit 100] [--titles]
 *
 * --titles checks every RSS item's title and leaves covers that are already real.
 *
 * Dry run by default. Titles change only when the stored title is a cut-off
 * prefix of the page's real headline, so edited titles are never overwritten.
 */
import { prisma } from "../prisma.js";
import { withRlsUser } from "../rls.js";
import { cacheRemoteCoverImages, SupabaseMediaStorage } from "../media.js";
import { safeRemoteFetch } from "../safeRemoteFetch.js";
import { __contentInternals } from "../routes/content.js";

const { extractMetadata } = __contentInternals;

type Options = { userId: string; execute: boolean; limit: number; titlesOnly: boolean };

function parseArgs(argv: string[]): Options {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const userId = value("--user");
  if (!userId) throw new Error("--user <clerk user id> is required.");
  return { userId, execute: argv.includes("--execute"), limit: Number(value("--limit") ?? 100), titlesOnly: argv.includes("--titles") };
}

export function repairedTitle(stored: string, extracted: string | undefined): string | undefined {
  const next = extracted?.replace(/\s+/g, " ").trim();
  if (!next || next.length <= stored.trim().length) return undefined;
  return next.toLowerCase().startsWith(stored.trim().toLowerCase()) ? next : undefined;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const mediaStorage = new SupabaseMediaStorage();
  await withRlsUser(options.userId, async () => {
    const documents = await prisma.readingDocument.findMany({
      where: options.titlesOnly
        ? { userId: options.userId, sourceType: "rss" }
        : { userId: options.userId, sourceType: "rss", coverImageUrl: { contains: "cover.svg" } },
      select: { id: true, title: true, sourceUrl: true, sourceLabel: true, category: true, coverImageUrl: true },
      orderBy: { createdAt: "desc" },
      take: options.limit
    });
    console.log(`${documents.length} RSS item(s)${options.titlesOnly ? "" : " with a generated cover"}. ${options.execute ? "EXECUTING" : "Dry run"}.`);

    let updated = 0;
    for (const document of documents) {
      if (!document.sourceUrl?.startsWith("https://")) {
        console.log(`skip ${document.id}: no HTTPS source URL`);
        continue;
      }
      try {
        const page = await safeRemoteFetch(document.sourceUrl, {
          fetcher: fetch,
          allowedProtocols: ["https:"],
          maxBytes: 3 * 1024 * 1024,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; ReadMateAI/1.0; +https://readmate.ai)" }
        });
        if (!page.response.ok) throw new Error(`page returned ${page.response.status}`);
        const metadata = extractMetadata(new TextDecoder().decode(page.body), page.url);
        const title = repairedTitle(document.title, metadata.title);
        const finalTitle = title ?? document.title;
        if (options.titlesOnly && !document.coverImageUrl?.includes("cover.svg")) {
          if (!title) continue;
          if (options.execute) await prisma.readingDocument.update({ where: { id: document.id }, data: { title } });
          updated += options.execute ? 1 : 0;
          console.log(`${options.execute ? "updated" : "would update"} ${document.id}: title "${document.title}" -> "${title}"`);
          continue;
        }
        if (!metadata.thumbnailUrl?.startsWith("https://")) {
          console.log(`skip ${document.id}: no HTTPS image${title ? ` (title would be "${title}")` : ""}`);
          continue;
        }
        if (!options.execute) {
          console.log(`would update ${document.id}: cover from ${new URL(metadata.thumbnailUrl).host}${title ? `, title "${document.title}" -> "${title}"` : ""}`);
          continue;
        }
        const covers = await cacheRemoteCoverImages({
          imageUrl: metadata.thumbnailUrl,
          userId: options.userId,
          title: finalTitle,
          sourceName: document.sourceLabel ?? undefined,
          category: document.category ?? undefined,
          fetcher: fetch,
          mediaStorage,
          storageKeySuffix: `backfill-${document.id}`,
          requireHttps: true
        });
        if (!covers.coverImageUrl || covers.coverImageUrl.includes("cover.svg")) {
          console.log(`skip ${document.id}: image could not be cached`);
          continue;
        }
        await prisma.readingDocument.update({
          where: { id: document.id },
          data: { title: finalTitle, coverImageUrl: covers.coverImageUrl, thumbnailUrl: covers.thumbnailUrl }
        });
        updated += 1;
        console.log(`updated ${document.id}${title ? `: "${title}"` : ""}`);
      } catch (error) {
        console.log(`skip ${document.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log(`${options.execute ? "Updated" : "Would update"} ${options.execute ? updated : "the items above"}.`);
  });
  await prisma.$disconnect();
}

if (process.argv[1]?.endsWith("backfillRssArtwork.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
