import type { CustomerInfo, PurchasesOffering, PurchasesPackage } from "react-native-purchases";
import * as Linking from "expo-linking";
import Constants from "expo-constants";
import { Platform } from "react-native";
import {
  hasActiveStorePurchase,
  isRecommendedPackage,
  packageBillingLabel,
  storePackageDisplayName,
  subscriptionPeriodLabel,
  type PremiumOfferingDescriptor,
  type PremiumPackageDescriptor,
  type PremiumPurchaseResult
} from "@/purchases/premium-packages";
import { premiumPurchasesEnabled } from "@/purchases/purchases-availability";

const appleApiKey = process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY ?? "";
const googleApiKey = process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY ?? "";
export const premiumEntitlementId = process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID?.trim() || "premium";

let configured = false;
let configuredApiKey = "";
let purchasesOperationQueue: Promise<void> = Promise.resolve();

type PurchasesStatic = (typeof import("react-native-purchases"))["default"];

export async function initializePremiumPurchases(appUserId: string): Promise<void> {
  if (!premiumPurchasesEnabled) return;
  await withPremiumIdentity(appUserId, async () => undefined);
}

export async function clearPremiumPurchasesIdentity(): Promise<void> {
  await serializePurchasesOperation(async () => {
    if (!configured) return;
    const Purchases = (await import("react-native-purchases")).default;
    const currentAppUserId = await Purchases.getAppUserID();
    if (!currentAppUserId.startsWith("$RCAnonymousID:")) {
      await Purchases.logOut();
    }
  });
}

export async function getPremiumPurchaseState(appUserId: string, forceRefresh = false): Promise<PremiumPurchaseResult> {
  return withPremiumIdentity(appUserId, async (Purchases) => {
    if (forceRefresh) await Purchases.invalidateCustomerInfoCache();
    return purchaseResult(await Purchases.getCustomerInfo());
  });
}

async function ensurePremiumIdentity(Purchases: PurchasesStatic, appUserId: string): Promise<void> {
  if (!premiumPurchasesEnabled) throw new Error("Premium upgrades aren't available in this version of ReadMate yet.");
  const apiKey = apiKeyForPlatform();
  if (!apiKey) {
    throw new Error("Premium purchases are not configured in this build. Install the latest ReadMate build or contact support.");
  }

  if (!configured) {
    Purchases.configure({ apiKey, appUserID: appUserId });
    configured = true;
    configuredApiKey = apiKey;
    return;
  }
  if (configuredApiKey !== apiKey) {
    throw new Error("Premium purchases were initialized with an invalid store configuration. Restart ReadMate and try again.");
  }

  const currentAppUserId = await Purchases.getAppUserID();
  if (currentAppUserId !== appUserId) {
    await Purchases.logIn(appUserId);
  }
}

export async function loadPremiumOffering(appUserId: string): Promise<PremiumOfferingDescriptor> {
  return withPremiumIdentity(appUserId, async (Purchases) => {
    const offerings = await Purchases.getOfferings();
    const offering = offerings.current;
    if (!offering || offering.availablePackages.length === 0) {
      throw new Error("Premium plans are not available from the store right now. Please try again later.");
    }
    await Purchases.trackCustomPaywallImpression({ offering });
    return describeOffering(offering);
  });
}

export async function purchasePremiumPackage(appUserId: string, packageId: string): Promise<PremiumPurchaseResult> {
  return withPremiumIdentity(appUserId, async (Purchases) => {
    const offerings = await Purchases.getOfferings();
    const selectedPackage = offerings.current?.availablePackages.find((item) => item.identifier === packageId);
    if (!selectedPackage) {
      throw new Error("That Premium plan is no longer available. Refresh the plans and choose again.");
    }
    const { customerInfo } = await Purchases.purchasePackage(selectedPackage);
    return purchaseResult(customerInfo);
  });
}

export async function restorePremiumPurchases(appUserId: string): Promise<PremiumPurchaseResult> {
  return withPremiumIdentity(appUserId, async (Purchases) => purchaseResult(await Purchases.restorePurchases()));
}

export async function managePremiumSubscription(appUserId: string): Promise<void> {
  await withPremiumIdentity(appUserId, async (Purchases) => {
    const customerInfo = await Purchases.getCustomerInfo();
    if (customerInfo.managementURL && await Linking.canOpenURL(customerInfo.managementURL)) {
      await Linking.openURL(customerInfo.managementURL);
      return;
    }
    if (Platform.OS === "ios") {
      await Purchases.showManageSubscriptions();
      return;
    }
    const packageName = Constants.expoConfig?.android?.package ?? "ai.readmate.mobile";
    await Linking.openURL(`https://play.google.com/store/account/subscriptions?package=${encodeURIComponent(packageName)}`);
  });
}

export function isPurchaseCancelled(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { userCancelled?: boolean | null; code?: string };
  return candidate.userCancelled === true || candidate.code === "1" || candidate.code === "PURCHASE_CANCELLED_ERROR";
}

function apiKeyForPlatform(): string {
  return Platform.OS === "ios" ? appleApiKey.trim() : Platform.OS === "android" ? googleApiKey.trim() : "";
}

function describeOffering(offering: PurchasesOffering): PremiumOfferingDescriptor {
  return {
    id: offering.identifier,
    packages: offering.availablePackages.map(describePackage)
  };
}

function describePackage(item: PurchasesPackage): PremiumPackageDescriptor {
  const periodLabel = subscriptionPeriodLabel(item.packageType, item.product.subscriptionPeriod, item.product.productCategory);
  return {
    id: item.identifier,
    productIdentifier: item.product.identifier,
    displayName: storePackageDisplayName(item.packageType, item.product.title),
    description: item.product.description,
    priceString: item.product.priceString,
    periodLabel,
    billingLabel: packageBillingLabel(item.product.priceString, periodLabel),
    packageType: item.packageType,
    recommended: isRecommendedPackage(item.packageType)
  };
}

function purchaseResult(customerInfo: CustomerInfo): PremiumPurchaseResult {
  const isPremium = customerInfo.entitlements.active[premiumEntitlementId]?.isActive === true;
  return {
    isPremium,
    hasActiveStorePurchase: hasActiveStorePurchase(isPremium, customerInfo.activeSubscriptions.length, customerInfo.nonSubscriptionTransactions.length),
    managementUrl: customerInfo.managementURL
  };
}

async function withPremiumIdentity<T>(appUserId: string, operation: (Purchases: PurchasesStatic) => Promise<T>): Promise<T> {
  return serializePurchasesOperation(async () => {
    const Purchases = (await import("react-native-purchases")).default;
    await ensurePremiumIdentity(Purchases, appUserId);
    return operation(Purchases);
  });
}

function serializePurchasesOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = purchasesOperationQueue.then(operation, operation);
  purchasesOperationQueue = result.then(() => undefined, () => undefined);
  return result;
}
