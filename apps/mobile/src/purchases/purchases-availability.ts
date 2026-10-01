/**
 * Store purchases are opt-in per build. Off by default so a release never
 * shows an upgrade path the store cannot fulfil (App Review guideline 2.1).
 * Keep this a literal process.env reference so Expo inlines it at build time.
 */
export const premiumPurchasesEnabled = process.env.EXPO_PUBLIC_PREMIUM_PURCHASES_ENABLED === "true";

/** Offer an upgrade only to Free accounts, and only when the store can sell Premium. */
export function canOfferPremiumUpgrade(isPremium: boolean, purchasesEnabled = premiumPurchasesEnabled): boolean {
  return purchasesEnabled && !isPremium;
}
