import { getAuth } from "@clerk/express";
import type { Request } from "express";
import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";

/**
 * Per-minute request ceilings. Durable cost control (TTS characters, AI input,
 * upload bytes) lives in the database usage buckets; these limits only stop
 * bursts and scraping. They are per instance, so the effective ceiling scales
 * with Cloud Run instances.
 */
export const RATE_LIMITS = {
  tts: 20,
  learning: 30,
  entitlements: 30,
  webmcp: 120,
  contentIngestion: 20,
  uploads: 10,
  sources: 30,
  account: 5,
  data: 240
} as const;

export function perUserRateLimit(limit: number, windowMs = 60_000): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: rateLimitKey,
    handler: (_req, res, _next, options) => {
      res.status(options.statusCode).json({
        error: "Too many requests. Please wait a moment and try again.",
        code: "RATE_LIMITED"
      });
    }
  });
}

/** Signed-in callers share one bucket across devices; others are keyed by client IP. */
export function rateLimitKey(req: Request): string {
  const userId = clerkUserId(req);
  if (userId) return `user:${userId}`;
  return `ip:${normalizeIp(req.ip)}`;
}

function clerkUserId(req: Request): string | null {
  try {
    return getAuth(req).userId ?? null;
  } catch {
    // clerkMiddleware is not installed when Clerk is unconfigured (local dev).
    return null;
  }
}

/** Group IPv6 clients by /64 so one host cannot rotate addresses to evade limits. */
export function normalizeIp(ip: string | undefined): string {
  if (!ip) return "unknown";
  const v4Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (v4Mapped) return v4Mapped[1];
  if (!ip.includes(":")) return ip;
  const [head] = ip.split("::");
  const groups = ip.includes("::")
    ? [...head.split(":").filter(Boolean), ...Array(8).fill("0")].slice(0, 4)
    : ip.split(":").slice(0, 4);
  return `${groups.join(":")}::/64`;
}
