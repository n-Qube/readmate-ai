import { describe, expect, it } from "vitest";
import { assertProductionConfig } from "./productionConfig.js";

const productionEnv = {
  NODE_ENV: "production",
  CLERK_SECRET_KEY: "sk_live_placeholder",
  CLERK_PUBLISHABLE_KEY: "pk_live_placeholder",
  DATABASE_URL: "postgresql://database.invalid/readmate",
  SUPABASE_URL: "https://storage.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-placeholder",
  CRON_SECRET: "cron-placeholder",
  EXTENSION_ORIGIN: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
  WEB_APP_ORIGIN: "https://app.readmate.example",
  WEBMCP_AUDIT_DIGEST_KEY: "webmcp-audit-digest-key-placeholder"
};

describe("assertProductionConfig", () => {
  it("does nothing outside production", () => {
    expect(() => assertProductionConfig({ NODE_ENV: "test" })).not.toThrow();
  });

  it("accepts a live production configuration with billing disabled", () => {
    expect(() => assertProductionConfig(productionEnv)).not.toThrow();
  });

  it("rejects missing values and Clerk test credentials", () => {
    expect(() => assertProductionConfig({ ...productionEnv, CRON_SECRET: "" })).toThrow("CRON_SECRET");
    expect(() => assertProductionConfig({ ...productionEnv, CLERK_PUBLISHABLE_KEY: "pk_test_placeholder" })).toThrow("live publishable");
    expect(() => assertProductionConfig({ ...productionEnv, CLERK_SECRET_KEY: "sk_test_placeholder" })).toThrow("test secret");
    expect(() => assertProductionConfig({ ...productionEnv, WEBMCP_AUDIT_DIGEST_KEY: "" })).toThrow("WEBMCP_AUDIT_DIGEST_KEY");
  });

  it("allows RevenueCat to remain explicitly unconfigured", () => {
    expect(() => assertProductionConfig({
      ...productionEnv,
      REVENUECAT_SECRET_API_KEY: ""
    })).not.toThrow();
    expect(() => assertProductionConfig({
      ...productionEnv,
      REVENUECAT_SECRET_API_KEY: undefined
    })).not.toThrow();
  });

  it("rejects a public RevenueCat SDK key in the backend secret field", () => {
    expect(() => assertProductionConfig({
      ...productionEnv,
      REVENUECAT_SECRET_API_KEY: "appl_public_sdk_key"
    })).toThrow("backend RevenueCat secret");
    expect(() => assertProductionConfig({
      ...productionEnv,
      REVENUECAT_SECRET_API_KEY: "sk_server_only_key",
      REVENUECAT_ENTITLEMENT_ID: "premium"
    })).not.toThrow();
  });

  it("requires exact production browser origins", () => {
    expect(() => assertProductionConfig({
      ...productionEnv,
      EXTENSION_ORIGIN: "https://app.readmate.example"
    })).toThrow("chrome-extension");
    expect(() => assertProductionConfig({
      ...productionEnv,
      WEB_APP_ORIGIN: "http://app.readmate.example"
    })).toThrow("exact HTTPS origin");
    expect(() => assertProductionConfig({
      ...productionEnv,
      WEB_APP_ORIGIN: "https://app.readmate.example/path"
    })).toThrow("without credentials");
  });

  it("requires a sufficiently long stable WebMCP audit digest key", () => {
    expect(() => assertProductionConfig({
      ...productionEnv,
      WEBMCP_AUDIT_DIGEST_KEY: "too-short"
    })).toThrow("at least 32 characters");
  });
});
