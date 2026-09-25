import { describe, expect, it } from "vitest";
import { canOfferPremiumUpgrade } from "./purchases-availability";

describe("canOfferPremiumUpgrade", () => {
  it("offers upgrades only to Free accounts in builds that can sell Premium", () => {
    expect(canOfferPremiumUpgrade(false, true)).toBe(true);
    expect(canOfferPremiumUpgrade(true, true)).toBe(false);
    expect(canOfferPremiumUpgrade(false, false)).toBe(false);
  });
});
