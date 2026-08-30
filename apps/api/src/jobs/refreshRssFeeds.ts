import { PrismaDocumentRepository } from "../routes/documents.js";
import { saveRssFeed } from "../routes/content.js";
import { PrismaSourceRepository } from "../routes/sources.js";
import { PrismaSettingsRepository } from "../routes/settings.js";
import { prisma } from "../prisma.js";
import { SupabaseMediaStorage } from "../media.js";
import { withRlsUser } from "../rls.js";
import { entitlementForUser, type ReadMateEntitlement } from "../entitlements.js";
import type { SourceSubscription } from "@prisma/client";

export type RssRefreshResult = {
  sourceCount: number;
  documentCount: number;
  errors: Array<{ sourceId: string; sourceName: string; message: string }>;
};

export async function refreshDueRssFeeds(input: { olderThanMinutes?: number; userId?: string } = {}): Promise<RssRefreshResult> {
  const cutoff = new Date(Date.now() - (input.olderThanMinutes ?? 60) * 60_000);
  const sources = await prisma.$queryRaw<SourceSubscription[]>`
    SELECT * FROM app.list_due_rss_sources(${cutoff}, ${input.userId ?? null}, 100)
  `;

  const documentRepository = new PrismaDocumentRepository();
  const sourceRepository = new PrismaSourceRepository();
  const settingsRepository = new PrismaSettingsRepository();
  const mediaStorage = new SupabaseMediaStorage();
  const result: RssRefreshResult = { sourceCount: 0, documentCount: 0, errors: [] };
  const settingsByUser = new Map<string, Awaited<ReturnType<PrismaSettingsRepository["getOrCreateSettings"]>>>();
  const entitlementsByUser = new Map<string, ReadMateEntitlement>();

  for (const source of sources) {
    if (!source.rssFeedUrl) continue;
    const rssFeedUrl = source.rssFeedUrl;
    try {
      await withRlsUser(source.userId, async () => {
        let settings = settingsByUser.get(source.userId);
        if (!settings) {
          settings = await settingsRepository.getOrCreateSettings(source.userId);
          settingsByUser.set(source.userId, settings);
        }
        let entitlement = entitlementsByUser.get(source.userId);
        if (!entitlement) {
          entitlement = await entitlementForUser(source.userId);
          entitlementsByUser.set(source.userId, entitlement);
        }
        const refreshed = await saveRssFeed({
          userId: source.userId,
          url: rssFeedUrl,
          subscriptionFeedUrl: rssFeedUrl,
          title: source.sourceName,
          provider: "google",
          voice: "en-US-Neural2-F",
          speed: 1,
          articlesPerFeed: settings.articlesPerFeed,
          documentRepository,
          sourceRepository,
          mediaStorage,
          fetcher: fetch,
          requireHttps: new URL(rssFeedUrl).protocol === "https:",
          entitlement
        });
        result.sourceCount += 1;
        result.documentCount += refreshed.documents.length;
      });
    } catch (error) {
      result.errors.push({
        sourceId: source.id,
        sourceName: source.sourceName,
        message: error instanceof Error ? error.message : "Unknown RSS refresh error."
      });
    }
  }

  return result;
}

if (/refreshRssFeeds\.(ts|js)$/.test(process.argv[1] ?? "")) {
  refreshDueRssFeeds()
    .then((result) => {
      console.log(JSON.stringify(result));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
