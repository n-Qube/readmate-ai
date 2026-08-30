import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import {
  __entitlementInternals,
  entitlementForPlan,
  entitlementForRequest,
  entitlementForUser,
  invalidateEntitlementCache,
  PremiumRequiredError,
  requireDocumentWithinPlan,
  requirePremiumAudio
} from "./entitlements.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.READMATE_PREMIUM_USER_IDS;
  delete process.env.REVENUECAT_SECRET_API_KEY;
  delete process.env.REVENUECAT_ENTITLEMENT_ID;
  __entitlementInternals.resetRevenueCatCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
  __entitlementInternals.resetRevenueCatCacheForTests();
});

describe("ReadMate entitlements", () => {
  it("defaults unknown accounts to the Free plan when RevenueCat is unconfigured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const entitlement = await entitlementForRequest({} as Request, "user_free");

    expect(entitlement).toMatchObject({ plan: "free", isPremium: false, features: { largeDocuments: false, premiumAudio: false } });
    expect(entitlement.limits.maxUploadBytes).toBe(10 * 1024 * 1024);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("supports manually granted Premium access without contacting RevenueCat", async () => {
    process.env.READMATE_PREMIUM_USER_IDS = "user_one,user_premium";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect((await entitlementForRequest({} as Request, "user_premium")).plan).toBe("premium");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("applies manual Premium grants to scheduled work without an HTTP request", async () => {
    process.env.READMATE_PREMIUM_USER_IDS = "scheduled_reader";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect((await entitlementForUser("scheduled_reader")).plan).toBe("premium");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("grants Premium only when the configured RevenueCat entitlement is active", async () => {
    process.env.REVENUECAT_SECRET_API_KEY = "sk_server_only_test_key";
    process.env.REVENUECAT_ENTITLEMENT_ID = "readmate_premium";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      subscriber: {
        entitlements: {
          readmate_premium: { expires_date: "2999-01-01T00:00:00Z" }
        }
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const entitlement = await entitlementForRequest({} as Request, "user/revenuecat");

    expect(entitlement.plan).toBe("premium");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.revenuecat.com/v1/subscribers/user%2Frevenuecat",
      expect.objectContaining({
        headers: {
          Accept: "application/json",
          Authorization: "Bearer sk_server_only_test_key"
        },
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("keeps expired RevenueCat subscribers on the Free plan", async () => {
    process.env.REVENUECAT_SECRET_API_KEY = "sk_server_only_test_key";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      subscriber: {
        entitlements: {
          premium: { expires_date: "2000-01-01T00:00:00Z" }
        }
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    expect((await entitlementForRequest({} as Request, "user_expired")).plan).toBe("free");
  });

  it("keeps RevenueCat subscribers Premium during an active billing grace period", async () => {
    process.env.REVENUECAT_SECRET_API_KEY = "sk_server_only_test_key";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      subscriber: {
        entitlements: {
          premium: {
            expires_date: "2000-01-01T00:00:00Z",
            grace_period_expires_date: "2999-01-01T00:00:00Z"
          }
        }
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    expect((await entitlementForRequest({} as Request, "user_grace_period")).plan).toBe("premium");
  });

  it("fails closed when RevenueCat returns an error", async () => {
    process.env.REVENUECAT_SECRET_API_KEY = "sk_server_only_test_key";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("provider unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect((await entitlementForRequest({} as Request, "user_provider_error")).plan).toBe("free");
  });

  it("invalidates the short subscriber cache after a purchase or restore", async () => {
    process.env.REVENUECAT_SECRET_API_KEY = "sk_server_only_test_key";
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        subscriber: { entitlements: { premium: { expires_date: "2999-01-01T00:00:00Z" } } }
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        subscriber: { entitlements: { premium: { expires_date: "2000-01-01T00:00:00Z" } } }
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    expect((await entitlementForRequest({} as Request, "user_cached")).plan).toBe("premium");
    expect((await entitlementForRequest({} as Request, "user_cached")).plan).toBe("premium");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    invalidateEntitlementCache("user_cached");
    expect((await entitlementForRequest({} as Request, "user_cached")).plan).toBe("free");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gates Cartesia and large documents for Free accounts", () => {
    const free = entitlementForPlan("free");
    expect(() => requirePremiumAudio(free)).toThrow(PremiumRequiredError);
    expect(() => requireDocumentWithinPlan(free, { byteSize: free.limits.maxUploadBytes + 1 })).toThrow(PremiumRequiredError);
  });

  it("allows Premium accounts within the absolute product limits", () => {
    const premium = entitlementForPlan("premium");
    expect(() => requirePremiumAudio(premium)).not.toThrow();
    expect(() => requireDocumentWithinPlan(premium, { byteSize: 20 * 1024 * 1024, pageCount: 500 })).not.toThrow();
  });
});
