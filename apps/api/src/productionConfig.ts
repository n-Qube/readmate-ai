const requiredProductionVariables = [
  "CLERK_SECRET_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "EXTENSION_ORIGIN",
  "WEB_APP_ORIGIN",
  "WEBMCP_AUDIT_DIGEST_KEY"
] as const;

export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const missing = requiredProductionVariables.filter((name) => !env[name]?.trim());
  if (missing.length) {
    throw new Error(`Missing required production configuration: ${missing.join(", ")}.`);
  }
  if (!env.CLERK_PUBLISHABLE_KEY?.startsWith("pk_live_")) {
    throw new Error("Production must use a Clerk live publishable key.");
  }
  if (env.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
    throw new Error("Production cannot use a Clerk test secret key.");
  }
  if (!env.SUPABASE_URL?.startsWith("https://")) {
    throw new Error("Production SUPABASE_URL must use HTTPS.");
  }
  if (env.REVENUECAT_SECRET_API_KEY?.trim() && !env.REVENUECAT_SECRET_API_KEY.startsWith("sk_")) {
    throw new Error("REVENUECAT_SECRET_API_KEY must be a backend RevenueCat secret API key.");
  }
  if (env.REVENUECAT_ENTITLEMENT_ID?.trim() && !/^[A-Za-z0-9._-]{1,100}$/.test(env.REVENUECAT_ENTITLEMENT_ID.trim())) {
    throw new Error("REVENUECAT_ENTITLEMENT_ID is invalid.");
  }
  if (!/^chrome-extension:\/\/[a-p]{32}$/.test(env.EXTENSION_ORIGIN?.trim() ?? "")) {
    throw new Error("EXTENSION_ORIGIN must be one exact production chrome-extension:// origin.");
  }
  assertExactHttpsOrigin("WEB_APP_ORIGIN", env.WEB_APP_ORIGIN);
  if ((env.WEBMCP_AUDIT_DIGEST_KEY?.trim().length ?? 0) < 32) {
    throw new Error("WEBMCP_AUDIT_DIGEST_KEY must contain at least 32 characters.");
  }
}

function assertExactHttpsOrigin(name: string, value: string | undefined): void {
  let parsed: URL;
  try {
    parsed = new URL(value ?? "");
  } catch {
    throw new Error(`${name} must be an exact HTTPS origin.`);
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname && parsed.pathname !== "/")
  ) {
    throw new Error(`${name} must be an exact HTTPS origin without credentials, a path, query, or fragment.`);
  }
}
