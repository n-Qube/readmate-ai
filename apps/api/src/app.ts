import { clerkMiddleware } from "@clerk/express";
import cors from "cors";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { requireClerkUser } from "./auth.js";
import { perUserRateLimit, RATE_LIMITS } from "./rateLimits.js";
import { createCorsOptions } from "./corsPolicy.js";
import { refreshDueRssFeeds } from "./jobs/refreshRssFeeds.js";
import { accountRouter } from "./routes/account.js";
import { contentRouter } from "./routes/content.js";
import { documentsRouter } from "./routes/documents.js";
import { entitlementsRouter } from "./routes/entitlements.js";
import { highlightsRouter } from "./routes/highlights.js";
import { historyRouter } from "./routes/history.js";
import { learningRouter } from "./routes/learning.js";
import { notesRouter } from "./routes/notes.js";
import { settingsRouter } from "./routes/settings.js";
import { sourcesRouter } from "./routes/sources.js";
import { ttsRouter } from "./routes/tts.js";
import { uploadsRouter } from "./routes/uploads.js";
import { webMcpRouter } from "./routes/webmcp.js";
import { UsageLimitError } from "./usageQuota.js";
import { assertProductionConfig } from "./productionConfig.js";
import { databaseUnavailableCode, isDatabaseUnavailableError } from "./databaseErrors.js";
import { PremiumRequiredError } from "./entitlements.js";
import { WebMcpActionIdempotencyError } from "./webmcp/actionIdempotency.js";
import {
  AccountDeletionFencedError,
  ACCOUNT_DELETION_FENCED_CODE,
  isAccountDeletionFencedError
} from "./webmcp/accountDeletionFence.js";

/**
 * The API serves JSON, audio, and two static HTML pages with inline styles, so
 * the policy can deny everything else, including framing.
 */
function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  );
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

export function createApp() {
  assertProductionConfig();
  const app = express();
  // Cloud Run fronts the service with exactly one Google proxy hop. Trusting it
  // makes req.ip the real client address for rate limiting.
  if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
  const clerkConfigured = Boolean(process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY);
  const allowAnonymousTts = process.env.ALLOW_ANONYMOUS_TTS === "true";
  if (process.env.NODE_ENV === "production" && allowAnonymousTts) {
    throw new Error("ALLOW_ANONYMOUS_TTS cannot be enabled in production because paid usage must be attributable.");
  }

  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(cors(createCorsOptions()));
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => {
    res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ReadMate AI</title>
    <style>
      body { margin: 0; font: 16px/1.6 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; background: #f6f8fb; }
      main { max-width: 760px; margin: 0 auto; padding: 64px 24px; }
      h1 { margin: 0 0 16px; font-size: 42px; line-height: 1.1; }
      p { margin: 0 0 16px; }
      a { color: #1f5eff; }
    </style>
  </head>
  <body>
    <main>
      <h1>ReadMate AI</h1>
      <p>ReadMate AI helps you save webpages and PDFs, listen with text-to-speech, and continue reading across mobile and desktop.</p>
      <p>For privacy details, read the <a href="/privacy">ReadMate AI Privacy Policy</a>.</p>
      <p>Contact: <a href="mailto:nii.nortey@gmail.com">nii.nortey@gmail.com</a></p>
    </main>
  </body>
</html>`);
  });

  app.get("/privacy", (_req, res) => {
    res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ReadMate AI Privacy Policy</title>
    <style>
      body { margin: 0; font: 16px/1.6 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; background: #fff; }
      main { max-width: 820px; margin: 0 auto; padding: 48px 24px; }
      h1 { margin: 0 0 8px; font-size: 36px; line-height: 1.15; }
      h2 { margin: 32px 0 8px; font-size: 22px; }
      p, li { color: #374151; }
      a { color: #1f5eff; }
    </style>
  </head>
  <body>
    <main>
      <h1>ReadMate AI Privacy Policy</h1>
      <p>Last updated: August 29, 2026</p>
      <p>ReadMate AI helps users save webpages, upload documents, read articles, and listen with text-to-speech. This policy explains what information the app handles and why.</p>

      <h2>Information We Process</h2>
      <ul>
        <li>Account identifiers needed for sign-in and syncing across devices.</li>
        <li>Saved reading items, uploaded documents, document metadata, playback progress, notes, highlights, and preferences.</li>
        <li>Selected or saved text that you request to convert into audio.</li>
      </ul>

      <h2>How We Use Information</h2>
      <p>We use this information to provide app functionality, sync your reading library, generate text-to-speech audio, and maintain the service.</p>

      <h2>Browser-Agent Tools</h2>
      <p>On supported ReadMate web pages, a browser agent may invoke ReadMate tools only for the signed-in user on the active page. Actions that save content, subscribe to a feed, or generate study material remain visible and require user review and submission.</p>
      <p>ReadMate does not expose browser-agent tools on account-deletion, payment, password, or provider-secret pages. These tools do not export a user’s library to another website, enable cross-site tracking, manage payments, or reveal provider credentials.</p>

      <h2>Service Providers</h2>
      <p>ReadMate AI uses service providers for authentication, database and file storage, hosting, AI study features, text-to-speech generation, and Premium subscription verification. Selected text is sent to the text-to-speech provider only when you request audio playback. RevenueCat receives your ReadMate account identifier and store subscription status so Premium access can be verified and restored; ReadMate does not receive your card or bank details.</p>

      <h2>What We Do Not Do</h2>
      <p>ReadMate AI does not continuously record your screen, collect passwords, read hidden form fields, capture sensitive pages by default, sell saved reading content, or use it for targeted advertising.</p>

      <h2>Data Retention and Deletion</h2>
      <p>Saved reading items, uploaded documents, notes, highlights, playback progress, and preferences are retained so they can sync across devices.</p>
      <p>You can delete your ReadMate AI account in the app from Settings. Account deletion permanently removes your account, saved reading items, uploaded documents, document metadata, notes, highlights, playback progress, preferences, and account-linked app records unless retention is required for legal, security, or abuse-prevention reasons.</p>
      <p>Deleting your ReadMate AI account does not cancel an App Store or Google Play subscription. Manage the subscription in the store first if you want to stop renewal.</p>
      <p>You can also delete individual saved reading items and related app content in the app without deleting your account.</p>

      <h2>Contact</h2>
      <p>For privacy questions or deletion requests, contact <a href="mailto:nii.nortey@gmail.com">nii.nortey@gmail.com</a>.</p>
    </main>
  </body>
</html>`);
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.post("/api/cron/rss-refresh", async (req, res, next) => {
    try {
      const expectedSecret = process.env.CRON_SECRET?.trim();
      const providedSecret = String(req.header("x-cron-secret") ?? "").trim();
      if (!expectedSecret || providedSecret !== expectedSecret) {
        res.status(401).json({ error: "Unauthorized RSS refresh request." });
        return;
      }
      res.json(await refreshDueRssFeeds());
    } catch (error) {
      next(error);
    }
  });
  if (clerkConfigured) {
    app.use(clerkMiddleware());
  }

  app.use(
    "/api/account",
    perUserRateLimit(RATE_LIMITS.account),
    ...(clerkConfigured
      ? requireClerkUser()
      : [(_req: Request, res: Response) => res.status(503).json({ error: "Clerk is not configured for account deletion." })]),
    accountRouter()
  );
  app.use(
    "/api/tts",
    perUserRateLimit(RATE_LIMITS.tts),
    ...(allowAnonymousTts
      ? []
      : clerkConfigured
        ? requireClerkUser()
        : [
            (_req: Request, res: Response) =>
              res.status(503).json({
                error:
                  "Clerk is not configured. Set CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY, or set ALLOW_ANONYMOUS_TTS=true for local testing."
              })
          ]),
    ttsRouter()
  );
  app.use(
    "/api/history",
    perUserRateLimit(RATE_LIMITS.data),
    ...(clerkConfigured
      ? requireClerkUser()
      : [(_req: Request, res: Response) => res.status(503).json({ error: "Clerk is not configured for synced history." })]),
    historyRouter()
  );
  app.use(
    "/api/documents",
    perUserRateLimit(RATE_LIMITS.data),
    ...(clerkConfigured
      ? requireClerkUser()
      : [(_req: Request, res: Response) => res.status(503).json({ error: "Clerk is not configured for document sync." })]),
    documentsRouter()
  );
  app.use(
    "/api/library",
    perUserRateLimit(RATE_LIMITS.data),
    ...(clerkConfigured
      ? requireClerkUser()
      : [(_req: Request, res: Response) => res.status(503).json({ error: "Clerk is not configured for library sync." })]),
    documentsRouter()
  );
  app.use(
    "/library",
    perUserRateLimit(RATE_LIMITS.data),
    ...(clerkConfigured
      ? requireClerkUser()
      : [(_req: Request, res: Response) => res.status(503).json({ error: "Clerk is not configured for library sync." })]),
    documentsRouter()
  );
  app.use(
    "/api/content",
    perUserRateLimit(RATE_LIMITS.contentIngestion),
    ...(clerkConfigured
      ? requireClerkUser()
      : [(_req: Request, res: Response) => res.status(503).json({ error: "Clerk is not configured for content sync." })]),
    contentRouter()
  );
  app.use(
    "/api/uploads",
    perUserRateLimit(RATE_LIMITS.uploads),
    ...(clerkConfigured
      ? requireClerkUser()
      : [(_req: Request, res: Response) => res.status(503).json({ error: "Clerk is not configured for authenticated uploads." })]),
    uploadsRouter()
  );
  app.use(
    "/api/sources",
    perUserRateLimit(RATE_LIMITS.sources),
    ...(clerkConfigured
      ? requireClerkUser()
      : [(_req: Request, res: Response) => res.status(503).json({ error: "Clerk is not configured for source sync." })]),
    sourcesRouter()
  );
  app.use(
    "/api/learning",
    perUserRateLimit(RATE_LIMITS.learning),
    ...(clerkConfigured
      ? requireClerkUser()
      : [(_req: Request, res: Response) => res.status(503).json({ error: "Clerk is not configured for learning sync." })]),
    learningRouter()
  );
  app.use(
    "/api/notes",
    perUserRateLimit(RATE_LIMITS.data),
    ...(clerkConfigured
      ? requireClerkUser()
      : [(_req: Request, res: Response) => res.status(503).json({ error: "Clerk is not configured for notes sync." })]),
    notesRouter()
  );
  app.use(
    "/api/highlights",
    perUserRateLimit(RATE_LIMITS.data),
    ...(clerkConfigured
      ? requireClerkUser()
      : [(_req: Request, res: Response) => res.status(503).json({ error: "Clerk is not configured for highlights sync." })]),
    highlightsRouter()
  );
  app.use(
    "/api/settings",
    perUserRateLimit(RATE_LIMITS.data),
    ...(clerkConfigured
      ? requireClerkUser()
      : [(_req: Request, res: Response) => res.status(503).json({ error: "Clerk is not configured for synced settings." })]),
    settingsRouter()
  );
  app.use(
    "/api/entitlements",
    perUserRateLimit(RATE_LIMITS.entitlements),
    ...(clerkConfigured
      ? requireClerkUser()
      : [(_req: Request, res: Response) => res.status(503).json({ error: "Clerk is not configured for account entitlements." })]),
    entitlementsRouter()
  );
  app.use(
    "/api/webmcp",
    perUserRateLimit(RATE_LIMITS.webmcp),
    ...(clerkConfigured
      ? requireClerkUser()
      : [(_req: Request, res: Response) => res.status(503).json({ error: "Clerk is not configured for WebMCP audit events." })]),
    webMcpRouter()
  );
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof WebMcpActionIdempotencyError) {
      if (error.retryAfterSeconds !== undefined) {
        res.setHeader("Retry-After", String(error.retryAfterSeconds));
      }
      res.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    if (isAccountDeletionFencedError(error)) {
      const fencedError = error instanceof AccountDeletionFencedError ? error : new AccountDeletionFencedError();
      res.status(fencedError.statusCode).json({
        error: fencedError.message,
        code: ACCOUNT_DELETION_FENCED_CODE
      });
      return;
    }
    if (error instanceof PremiumRequiredError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code, feature: error.feature });
      return;
    }
    if (error instanceof UsageLimitError) {
      res.status(error.statusCode).json({ error: "Daily usage limit reached.", code: error.code });
      return;
    }
    if (isDatabaseUnavailableError(error)) {
      console.error(JSON.stringify({ event: "database_temporarily_unavailable", code: databaseUnavailableCode(error) }));
      res.setHeader("Retry-After", "2");
      res.status(503).json({ error: "ReadMate is temporarily busy. Please retry." });
      return;
    }
    const code = (error as { code?: unknown } | null)?.code;
    console.error(JSON.stringify({
      event: "request_failed",
      name: error instanceof Error ? error.name : "UnknownError",
      // Prisma error codes (for example P2028) identify the failure without user data.
      code: typeof code === "string" && /^P\d{4}$/.test(code) ? code : undefined
    }));
    res.status(500).json({ error: "Unexpected server error." });
  });

  return app;
}
