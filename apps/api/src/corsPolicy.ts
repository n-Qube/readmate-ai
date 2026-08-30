import type { CorsOptions } from "cors";

const ALLOWED_ORIGIN_PROTOCOLS = new Set(["https:", "http:", "chrome-extension:"]);

export function createCorsOptions(rawOrigins = configuredCorsOrigins(), nodeEnv = process.env.NODE_ENV): CorsOptions {
  const allowedOrigins = parseCorsOrigins(rawOrigins);
  if (nodeEnv === "production" && allowedOrigins.length === 0) {
    throw new Error("EXTENSION_ORIGIN and WEB_APP_ORIGIN must define the explicit production CORS allowlist.");
  }
  if (allowedOrigins.length === 0) return { origin: true };

  const allowed = new Set(allowedOrigins);
  return {
    origin(origin, callback) {
      if (!origin || allowed.has(normalizeOrigin(origin))) {
        callback(null, true);
        return;
      }
      callback(null, false);
    }
  };
}

export function configuredCorsOrigins(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const origins = [env.EXTENSION_ORIGIN, env.WEB_APP_ORIGIN]
    .map((origin) => origin?.trim())
    .filter((origin): origin is string => Boolean(origin));
  return origins.length ? origins.join(",") : undefined;
}

export function parseCorsOrigins(rawOrigins: string | undefined): string[] {
  if (!rawOrigins?.trim()) return [];
  const normalized = rawOrigins.split(",").map((origin) => normalizeOrigin(origin.trim())).filter(Boolean);
  for (const origin of normalized) {
    const parsed = new URL(origin);
    if (
      !ALLOWED_ORIGIN_PROTOCOLS.has(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname && parsed.pathname !== "/")
    ) {
      throw new Error(`Invalid CORS origin: ${origin}`);
    }
  }
  return [...new Set(normalized)];
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/$/, "");
}
