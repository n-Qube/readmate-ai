import { describe, expect, it } from "vitest";
import { hasActiveStorePurchase, packageBillingLabel, storePackageDisplayName, subscriptionPeriodLabel } from "./premium-packages";

describe("Premium package labels", () => {
  it("uses the store price without inventing a currency or amount", () => {
    expect(packageBillingLabel("GH₵120.00", "year")).toBe("GH₵120.00 / year");
  });

  it("uses known RevenueCat package periods", () => {
    expect(subscriptionPeriodLabel("MONTHLY", "P1M")).toBe("month");
    expect(subscriptionPeriodLabel("ANNUAL", "P1Y")).toBe("year");
  });

  it("keeps localized store titles and uses ISO periods for custom packages", () => {
    expect(storePackageDisplayName("MONTHLY", "Mensuel")).toBe("Mensuel");
    expect(storePackageDisplayName("CUSTOM", "Student plan")).toBe("Student plan");
    expect(subscriptionPeriodLabel("CUSTOM", "P3M")).toBe("3 months");
  });

  it("labels non-subscription products as one-time purchases", () => {
    expect(subscriptionPeriodLabel("CUSTOM", null, "NON_SUBSCRIPTION")).toBe("one-time purchase");
  });

  it("keeps a successful store purchase in activation recovery even before the entitlement propagates", () => {
    expect(hasActiveStorePurchase(false, 1, 0)).toBe(true);
    expect(hasActiveStorePurchase(false, 0, 1)).toBe(true);
    expect(hasActiveStorePurchase(false, 0, 0)).toBe(false);
  });
});
