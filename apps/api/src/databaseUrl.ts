const DEFAULT_CONNECTION_LIMIT = 2;
const DEFAULT_POOL_TIMEOUT_SECONDS = 30;

type DatabaseUrlOptions = {
  production?: boolean;
  connectionLimit?: number;
  poolTimeoutSeconds?: number;
};

/**
 * Keep each autoscaled API instance from reserving a full Prisma pool from the
 * shared Supabase pooler. Explicit URL parameters may choose a smaller pool,
 * but stale values cannot exceed the runtime safety cap.
 */
export function databaseUrlForRuntime(rawUrl: string | undefined, options: DatabaseUrlOptions = {}): string | undefined {
  if (!rawUrl || options.production === false) return rawUrl;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return rawUrl;

  const connectionLimit = positiveInteger(options.connectionLimit) ?? positiveIntegerFromEnv("DATABASE_CONNECTION_LIMIT") ?? DEFAULT_CONNECTION_LIMIT;
  const configuredConnectionLimit = positiveInteger(Number(url.searchParams.get("connection_limit")));
  if (!configuredConnectionLimit || configuredConnectionLimit > connectionLimit) {
    url.searchParams.set("connection_limit", String(connectionLimit));
  }

  const poolTimeoutSeconds = positiveInteger(options.poolTimeoutSeconds) ?? positiveIntegerFromEnv("DATABASE_POOL_TIMEOUT_SECONDS") ?? DEFAULT_POOL_TIMEOUT_SECONDS;
  const configuredPoolTimeout = positiveInteger(Number(url.searchParams.get("pool_timeout")));
  if (!configuredPoolTimeout || configuredPoolTimeout > poolTimeoutSeconds) {
    url.searchParams.set("pool_timeout", String(poolTimeoutSeconds));
  }
  if (url.port === "6543" && !url.searchParams.has("pgbouncer")) {
    url.searchParams.set("pgbouncer", "true");
  }

  return url.toString();
}

function positiveIntegerFromEnv(name: string): number | null {
  return positiveInteger(Number(process.env[name]));
}

function positiveInteger(value: number | undefined): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}
