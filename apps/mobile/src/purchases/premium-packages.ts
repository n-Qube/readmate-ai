export type PremiumPackageDescriptor = {
  id: string;
  productIdentifier: string;
  displayName: string;
  description: string;
  priceString: string;
  periodLabel: string;
  billingLabel: string;
  packageType: string;
  recommended: boolean;
};

export type PremiumOfferingDescriptor = {
  id: string;
  packages: PremiumPackageDescriptor[];
};

export type PremiumPurchaseResult = {
  isPremium: boolean;
  hasActiveStorePurchase: boolean;
  managementUrl: string | null;
};

export function storePackageDisplayName(packageType: string, storeTitle: string): string {
  const localizedStoreTitle = storeTitle.trim();
  if (localizedStoreTitle) return localizedStoreTitle;

  const knownNames: Record<string, string> = {
    ANNUAL: "Annual",
    SIX_MONTH: "Six months",
    THREE_MONTH: "Three months",
    TWO_MONTH: "Two months",
    MONTHLY: "Monthly",
    WEEKLY: "Weekly",
    LIFETIME: "Lifetime"
  };
  return knownNames[packageType] ?? "Premium";
}

export function subscriptionPeriodLabel(packageType: string, subscriptionPeriod: string | null, productCategory?: string | null): string {
  if (packageType === "LIFETIME" || productCategory === "NON_SUBSCRIPTION") return "one-time purchase";

  const knownPeriods: Record<string, string> = {
    ANNUAL: "year",
    SIX_MONTH: "6 months",
    THREE_MONTH: "3 months",
    TWO_MONTH: "2 months",
    MONTHLY: "month",
    WEEKLY: "week"
  };
  if (knownPeriods[packageType]) return knownPeriods[packageType];

  const parsed = /^P(\d+)([DWMY])$/.exec(subscriptionPeriod ?? "");
  if (!parsed) return "billing period";
  const value = Number(parsed[1]);
  const unit = { D: "day", W: "week", M: "month", Y: "year" }[parsed[2]] ?? "period";
  return value === 1 ? unit : `${value} ${unit}s`;
}

export function packageBillingLabel(priceString: string, periodLabel: string): string {
  return periodLabel === "one-time purchase" ? `${priceString} one time` : `${priceString} / ${periodLabel}`;
}

export function isRecommendedPackage(packageType: string): boolean {
  return packageType === "ANNUAL";
}

export function hasActiveStorePurchase(isPremium: boolean, activeSubscriptionCount: number, nonSubscriptionTransactionCount: number): boolean {
  return isPremium || activeSubscriptionCount > 0 || nonSubscriptionTransactionCount > 0;
}
