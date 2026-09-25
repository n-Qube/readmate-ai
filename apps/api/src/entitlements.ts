import { getAuth } from "@clerk/express";
import type { Request } from "express";
import { createHash } from "node:crypto";
import { fetchWithTimeout } from "./fetchWithTimeout.js";

export type ReadMatePlan = "free" | "premium";
export type MaybePromise<T> = T | Promise<T>;

export type ReadMateEntitlement = {
  plan: ReadMatePlan;
  isPremium: boolean;
  features: {
    largeDocuments: boolean;
    premiumAudio: boolean;
  };
  limits: {
    maxUploadBytes: number;
    maxDocumentCharacters: number;
    maxPdfPages: number;
    dailyTtsCharacters: number;
  };
};

export class PremiumRequiredError extends Error {
  readonly statusCode = 403;
  readonly code = "PREMIUM_REQUIRED";

  constructor(
    public readonly feature: "large_documents" | "premium_audio",
    message: string
  ) {
    super(message);
    this.name = "PremiumRequiredError";
  }
}

const REVENUECAT_DEFAULT_ENTITLEMENT_ID = "premium";
const REVENUECAT_CACHE_TTL_MS = 60_000;
const REVENUECAT_ERROR_CACHE_TTL_MS = 5_000;
const REVENUECAT_REQUEST_TIMEOUT_MS = 5_000;

type RevenueCatConfig = {
  secretApiKey: string;
  entitlementId: string;
  fingerprint: string;
};

type RevenueCatCacheEntry = {
  plan: ReadMatePlan;
  expiresAt: number;
  configFingerprint: string;
  generation: number;
};

type RevenueCatPendingEntry = {
  promise: Promise<ReadMatePlan>;
  configFingerprint: string;
  generation: number;
};

type RevenueCatLookupOptions = {
  fetcher?: typeof fetch;
  now?: () => number;
};

const revenueCatCache = new Map<string, RevenueCatCacheEntry>();
const revenueCatPending = new Map<string, RevenueCatPendingEntry>();
const revenueCatGenerations = new Map<string, number>();

/** Resolve Premium from trusted server-side grants, then RevenueCat's subscriber record. */
export async function entitlementForRequest(req: Request, userId: string): Promise<ReadMateEntitlement> {
  if (hasTrustedPremiumClaim(req)) return entitlementForPlan("premium");
  return entitlementForUser(userId);
}

/** Resolve an account outside an HTTP request, such as a scheduled RSS refresh. */
export async function entitlementForUser(userId: string): Promise<ReadMateEntitlement> {
  if (hasManualPremiumOverride(userId)) return entitlementForPlan("premium");
  return entitlementForPlan(await revenueCatPlanForUser(userId));
}

/** Force the next lookup for this authenticated Clerk user to contact RevenueCat. */
export function invalidateEntitlementCache(userId: string): void {
  revenueCatCache.delete(userId);
  revenueCatPending.delete(userId);
  revenueCatGenerations.set(userId, currentGeneration(userId) + 1);
}

export function entitlementForPlan(plan: ReadMatePlan): ReadMateEntitlement {
  const isPremium = plan === "premium";
  return {
    plan,
    isPremium,
    features: {
      largeDocuments: isPremium,
      premiumAudio: isPremium
    },
    limits: {
      maxUploadBytes: limitFromEnv(isPremium ? "PREMIUM_MAX_UPLOAD_BYTES" : "FREE_MAX_UPLOAD_BYTES", isPremium ? 50 * 1024 * 1024 : 10 * 1024 * 1024),
      maxDocumentCharacters: limitFromEnv(isPremium ? "PREMIUM_MAX_DOCUMENT_CHARACTERS" : "FREE_MAX_DOCUMENT_CHARACTERS", isPremium ? 10_000_000 : 100_000),
      maxPdfPages: limitFromEnv(isPremium ? "PREMIUM_MAX_PDF_PAGES" : "FREE_MAX_PDF_PAGES", isPremium ? 2_000 : 50),
      dailyTtsCharacters: limitFromEnv(isPremium ? "PREMIUM_TTS_DAILY_CHAR_LIMIT" : "FREE_TTS_DAILY_CHAR_LIMIT", isPremium ? 500_000 : 25_000)
    }
  };
}

export function requirePremiumAudio(entitlement: ReadMateEntitlement): void {
  if (!entitlement.features.premiumAudio) {
    throw new PremiumRequiredError("premium_audio", "Gemini Flash natural voices require ReadMate Premium.");
  }
}

export function requireDocumentWithinPlan(
  entitlement: ReadMateEntitlement,
  input: { byteSize?: number; textCharacters?: number; pageCount?: number }
): void {
  const exceeds =
    (input.byteSize !== undefined && input.byteSize > entitlement.limits.maxUploadBytes) ||
    (input.textCharacters !== undefined && input.textCharacters > entitlement.limits.maxDocumentCharacters) ||
    (input.pageCount !== undefined && input.pageCount > entitlement.limits.maxPdfPages);
  if (!exceeds) return;
  if (entitlement.isPremium) throw new Error("Document exceeds the maximum supported size.");
  throw new PremiumRequiredError(
    "large_documents",
    `This document exceeds the Free plan limit of ${formatBytes(entitlement.limits.maxUploadBytes)}, ${entitlement.limits.maxPdfPages} PDF pages, or ${formatCount(entitlement.limits.maxDocumentCharacters)} text characters.`
  );
}

function hasManualPremiumOverride(userId: string): boolean {
  const premiumIds = new Set((process.env.READMATE_PREMIUM_USER_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  return premiumIds.has(userId);
}

function hasTrustedPremiumClaim(req: Request): boolean {
  try {
    const auth = getAuth(req) as unknown as { sessionClaims?: Record<string, unknown> };
    const claims = auth.sessionClaims;
    const candidates = [
      claims?.plan,
      claims?.subscription,
      claims?.tier,
      nestedValue(claims?.metadata, "plan"),
      nestedValue(claims?.publicMetadata, "plan")
    ];
    if (candidates.some((value) => typeof value === "string" && /^(premium|plus|pro)$/i.test(value.trim()))) return true;
  } catch {
    // Tests and internal jobs may not have Clerk request metadata. Default free.
  }
  return false;
}

async function revenueCatPlanForUser(userId: string, options: RevenueCatLookupOptions = {}): Promise<ReadMatePlan> {
  const config = revenueCatConfig();
  if (!config || !userId.trim()) return "free";

  const now = options.now ?? Date.now;
  const currentTime = now();
  const generation = currentGeneration(userId);
  const cached = revenueCatCache.get(userId);
  if (
    cached &&
    cached.expiresAt > currentTime &&
    cached.configFingerprint === config.fingerprint &&
    cached.generation === generation
  ) {
    return cached.plan;
  }

  const pending = revenueCatPending.get(userId);
  if (pending && pending.configFingerprint === config.fingerprint && pending.generation === generation) {
    return pending.promise;
  }

  const lookup = fetchRevenueCatPlan(userId, config, options.fetcher ?? globalThis.fetch, currentTime)
    .then((plan) => {
      cacheRevenueCatPlan(userId, plan, currentTime + REVENUECAT_CACHE_TTL_MS, config.fingerprint, generation);
      return plan;
    })
    .catch((error: unknown) => {
      cacheRevenueCatPlan(userId, "free", currentTime + REVENUECAT_ERROR_CACHE_TTL_MS, config.fingerprint, generation);
      console.warn(JSON.stringify({
        event: "revenuecat_entitlement_check_failed",
        status: error instanceof RevenueCatHttpError ? error.status : undefined
      }));
      return "free" as const;
    })
    .finally(() => {
      const active = revenueCatPending.get(userId);
      if (active?.promise === lookup) revenueCatPending.delete(userId);
    });

  revenueCatPending.set(userId, { promise: lookup, configFingerprint: config.fingerprint, generation });
  return lookup;
}

async function fetchRevenueCatPlan(
  userId: string,
  config: RevenueCatConfig,
  fetcher: typeof fetch,
  now: number
): Promise<ReadMatePlan> {
  const response = await fetchWithTimeout(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.secretApiKey}`
      }
    },
    { fetcher, timeoutMs: REVENUECAT_REQUEST_TIMEOUT_MS }
  );
  if (!response.ok) throw new RevenueCatHttpError(response.status);

  const payload = await response.json() as unknown;
  return hasActiveRevenueCatEntitlement(payload, config.entitlementId, now) ? "premium" : "free";
}

function hasActiveRevenueCatEntitlement(payload: unknown, entitlementId: string, now: number): boolean {
  const root = objectValue(payload);
  const subscriber = objectValue(root?.subscriber);
  const entitlements = objectValue(subscriber?.entitlements);
  const entitlement = objectValue(entitlements?.[entitlementId]);
  if (!entitlement) return false;

  const expiresDate = entitlement.expires_date;
  if (expiresDate === null) return true;
  const activeUntil = [expiresDate, entitlement.grace_period_expires_date]
    .filter((value): value is string => typeof value === "string")
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  return activeUntil.some((expiresAt) => expiresAt > now);
}

function revenueCatConfig(): RevenueCatConfig | null {
  const secretApiKey = process.env.REVENUECAT_SECRET_API_KEY?.trim();
  if (!secretApiKey || !secretApiKey.startsWith("sk_")) return null;
  const entitlementId = process.env.REVENUECAT_ENTITLEMENT_ID?.trim() || REVENUECAT_DEFAULT_ENTITLEMENT_ID;
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(entitlementId)) return null;
  return {
    secretApiKey,
    entitlementId,
    fingerprint: createHash("sha256").update(`${secretApiKey}\0${entitlementId}`).digest("base64url")
  };
}

function cacheRevenueCatPlan(
  userId: string,
  plan: ReadMatePlan,
  expiresAt: number,
  configFingerprint: string,
  generation: number
): void {
  if (currentGeneration(userId) !== generation) return;
  revenueCatCache.set(userId, { plan, expiresAt, configFingerprint, generation });
}

function currentGeneration(userId: string): number {
  return revenueCatGenerations.get(userId) ?? 0;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

class RevenueCatHttpError extends Error {
  constructor(public readonly status: number) {
    super("RevenueCat subscriber verification failed.");
    this.name = "RevenueCatHttpError";
  }
}

function nestedValue(value: unknown, key: string): unknown {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined;
}

export const __entitlementInternals = {
  hasActiveRevenueCatEntitlement,
  invalidateEntitlementCache,
  revenueCatPlanForUser,
  resetRevenueCatCacheForTests() {
    revenueCatCache.clear();
    revenueCatPending.clear();
    revenueCatGenerations.clear();
  }
};

function limitFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function formatBytes(value: number): string {
  return `${Math.round(value / (1024 * 1024))} MB`;
}

function formatCount(value: number): string {
  return value >= 1_000_000 ? `${value / 1_000_000} million` : value >= 1_000 ? `${Math.round(value / 1_000)} thousand` : String(value);
}
