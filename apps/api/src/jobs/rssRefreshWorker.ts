import { refreshDueRssFeeds } from "./refreshRssFeeds.js";

let running = false;
let timer: NodeJS.Timeout | null = null;

export function startRssRefreshWorker(): void {
  if (process.env.ENABLE_RSS_REFRESH_WORKER !== "true" || timer) return;

  const intervalMinutes = clampIntervalMinutes(Number(process.env.RSS_REFRESH_INTERVAL_MINUTES ?? 30));
  const intervalMs = intervalMinutes * 60_000;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await refreshDueRssFeeds({ olderThanMinutes: intervalMinutes });
      console.log(
        JSON.stringify({
          event: "rss_refresh_worker_run",
          intervalMinutes,
          sourceCount: result.sourceCount,
          documentCount: result.documentCount,
          errorCount: result.errors.length
        })
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "rss_refresh_worker_error",
          message: error instanceof Error ? error.message : "Unknown RSS refresh worker error."
        })
      );
    } finally {
      running = false;
    }
  };

  timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 10_000).unref?.();
  console.log(`ReadMate RSS refresh worker enabled every ${intervalMinutes} minutes.`);
}

function clampIntervalMinutes(value: number): number {
  if (!Number.isFinite(value)) return 30;
  return Math.min(24 * 60, Math.max(5, Math.round(value)));
}
