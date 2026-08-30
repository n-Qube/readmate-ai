import type { PremiumOfferingDescriptor, PremiumPurchaseResult } from "@/purchases/premium-packages";

export const premiumEntitlementId = process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID?.trim() || "premium";

export async function initializePremiumPurchases(_appUserId: string): Promise<void> {
  // StoreKit and Google Play Billing are only available in native app builds.
}

export async function clearPremiumPurchasesIdentity(): Promise<void> {
  // There is no store identity to clear on web.
}

export async function getPremiumPurchaseState(_appUserId: string, _forceRefresh = false): Promise<PremiumPurchaseResult> {
  throw nativeOnlyError();
}

export async function loadPremiumOffering(_appUserId: string): Promise<PremiumOfferingDescriptor> {
  throw nativeOnlyError();
}

export async function purchasePremiumPackage(_appUserId: string, _packageId: string): Promise<PremiumPurchaseResult> {
  throw nativeOnlyError();
}

export async function restorePremiumPurchases(_appUserId: string): Promise<PremiumPurchaseResult> {
  throw nativeOnlyError();
}

export async function managePremiumSubscription(_appUserId: string): Promise<void> {
  throw nativeOnlyError();
}

export function isPurchaseCancelled(_error: unknown): boolean {
  return false;
}

function nativeOnlyError(): Error {
  return new Error("Premium upgrades are available in the ReadMate app for iPhone and Android.");
}
