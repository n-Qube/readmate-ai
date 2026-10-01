import "./loadEnv.js";
import { createApp } from "./app.js";
import { startRssRefreshWorker } from "./jobs/rssRefreshWorker.js";
import { startUploadCleanupWorker } from "./jobs/uploadCleanup.js";
import { assertProductionDatabaseRole } from "./databasePreflight.js";

const port = Number(process.env.PORT ?? 8787);

async function main(): Promise<void> {
  await assertProductionDatabaseRole();
  createApp().listen(port, () => {
    console.log(`ReadMate AI API listening on http://localhost:${port}`);
    startRssRefreshWorker();
    startUploadCleanupWorker();
  });
}

main().catch((error) => {
  console.error("ReadMate API failed its startup preflight.", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
