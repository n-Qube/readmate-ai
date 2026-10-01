import { prisma } from "./prisma.js";

export const DEFAULT_TTS_DAILY_CHAR_LIMIT = 500_000;
export const DEFAULT_AI_DAILY_INPUT_CHAR_LIMIT = 250_000;

export class UsageLimitError extends Error {
  readonly statusCode = 429;
  readonly code = "DAILY_USAGE_LIMIT_REACHED";

  constructor(public readonly kind: string) {
    super("Daily usage limit reached.");
    this.name = "UsageLimitError";
  }
}

export async function consumeDailyUsage(userId: string, kind: string, quantity: number, limit: number): Promise<number> {
  const normalizedQuantity = normalizePositiveInteger(quantity, "quantity");
  const normalizedLimit = normalizePositiveInteger(limit, "limit");
  if (normalizedQuantity > normalizedLimit) throw new UsageLimitError(kind);
  const windowStart = startOfUtcDay(new Date());

  const rows = await prisma.$queryRaw<Array<{ quantity: bigint }>>`
    INSERT INTO "UsageBucket" ("userId", "kind", "windowStart", "quantity", "updatedAt")
    VALUES (${userId}, ${kind}, ${windowStart}, ${BigInt(normalizedQuantity)}, CURRENT_TIMESTAMP)
    ON CONFLICT ("userId", "kind", "windowStart") DO UPDATE
      SET "quantity" = "UsageBucket"."quantity" + EXCLUDED."quantity",
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "UsageBucket"."quantity" + EXCLUDED."quantity" <= ${BigInt(normalizedLimit)}
    RETURNING "quantity"
  `;
  if (!rows[0]) throw new UsageLimitError(kind);
  return Number(rows[0].quantity);
}

/**
 * Credit back usage for work the provider did not deliver (for example, an AI
 * request that failed and was answered from the saved text). Never below zero.
 */
export async function releaseDailyUsage(userId: string, kind: string, quantity: number): Promise<void> {
  const normalizedQuantity = normalizePositiveInteger(quantity, "quantity");
  const windowStart = startOfUtcDay(new Date());
  await prisma.$executeRaw`
    UPDATE "UsageBucket"
    SET "quantity" = GREATEST(0, "quantity" - ${BigInt(normalizedQuantity)}),
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "userId" = ${userId} AND "kind" = ${kind} AND "windowStart" = ${windowStart}
  `;
}

export function usageLimitFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function normalizePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Usage ${label} must be a positive safe integer.`);
  return value;
}

export const __usageQuotaInternals = { startOfUtcDay, normalizePositiveInteger };
