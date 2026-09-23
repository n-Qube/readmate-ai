import { useAuth } from "@clerk/expo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Redirect, useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, Text, View } from "react-native";
import { getEntitlements, refreshEntitlements } from "@/api/documents";
import { AppIcon } from "@/components/app-icon";
import { ActionButton, NavBackButton, PageHeader, Screen, SectionCard, colors, displayText, radius } from "@/components/mobile-design";
import type { PremiumPackageDescriptor } from "@/purchases/premium-packages";
import {
  getPremiumPurchaseState,
  isPurchaseCancelled,
  loadPremiumOffering,
  managePremiumSubscription,
  purchasePremiumPackage,
  restorePremiumPurchases
} from "@/purchases/premium-purchases";
import { screenshotMode } from "@/utils/screenshot-mode";

type PremiumSource = "premium_audio" | "large_documents" | "account" | "more";

export default function PremiumScreen() {
  const { isLoaded, isSignedIn, getToken, userId } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { source: sourceParam } = useLocalSearchParams<{ source?: string }>();
  const source = normalizeSource(sourceParam);
  const [selectedPackageId, setSelectedPackageId] = useState<string>();
  const [activity, setActivity] = useState<"purchase" | "restore" | "manage">();
  const [actionError, setActionError] = useState<string>();
  const [activationPending, setActivationPending] = useState(false);
  const entitlementQuery = useQuery({
    queryKey: ["entitlements"],
    queryFn: async () => getEntitlements(await getToken()),
    enabled: screenshotMode || Boolean(isSignedIn)
  });
  const isPremium = entitlementQuery.data?.isPremium === true;
  const storeStateQuery = useQuery({
    queryKey: ["premium-purchase-state", userId],
    queryFn: () => getPremiumPurchaseState(userId!, true),
    enabled: Boolean(userId) && entitlementQuery.isSuccess && !isPremium,
    retry: false
  });
  const activationNeedsSync = activationPending || storeStateQuery.data?.hasActiveStorePurchase === true;
  const offeringQuery = useQuery({
    queryKey: ["premium-offering", userId],
    queryFn: () => loadPremiumOffering(userId!),
    enabled: Boolean(userId) && entitlementQuery.isSuccess && !isPremium && storeStateQuery.isSuccess && !activationNeedsSync,
    retry: false
  });
  const packages = offeringQuery.data?.packages ?? [];
  const selectedPackage = useMemo(
    () => packages.find((item) => item.id === selectedPackageId) ?? packages.find((item) => item.recommended) ?? packages[0],
    [packages, selectedPackageId]
  );

  useEffect(() => {
    if (selectedPackageId || packages.length === 0) return;
    setSelectedPackageId((packages.find((item) => item.recommended) ?? packages[0]).id);
  }, [packages, selectedPackageId]);

  if (!screenshotMode && !isLoaded) {
    return (
      <Screen contentContainerStyle={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
        <ActivityIndicator color={colors.player} />
        <Text selectable style={{ color: colors.muted, fontSize: 13 }}>Checking your ReadMate account...</Text>
      </Screen>
    );
  }

  if (!screenshotMode && isLoaded && !isSignedIn) {
    return <Redirect href="/" />;
  }

  const syncPremiumAccess = async () => {
    const token = await getToken({ skipCache: true });
    if (!token) throw new Error("Sign in again before updating your Premium access.");
    const entitlement = await refreshEntitlements(token);
    queryClient.setQueryData(["entitlements"], entitlement);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["entitlements"] }),
      queryClient.invalidateQueries({ queryKey: ["settings"] }),
      queryClient.invalidateQueries({ queryKey: ["tts-voices"] })
    ]);
    return entitlement;
  };

  const purchase = async () => {
    if (!userId || !selectedPackage || activity) return;
    setActivity("purchase");
    setActionError(undefined);
    try {
      const storeResult = await purchasePremiumPackage(userId, selectedPackage.id);
      queryClient.setQueryData(["premium-purchase-state", userId], storeResult);
      setActivationPending(true);
      const entitlement = await syncPremiumAccess();
      if (!entitlement.isPremium) {
        throw new Error("Your purchase was received, but Premium is still syncing. Wait a moment, then check activation.");
      }
      setActivationPending(false);
      Alert.alert("Premium is active", "Premium audio and larger document limits are now unlocked.", [
        { text: "Continue", onPress: () => router.back() }
      ]);
    } catch (error) {
      if (!isPurchaseCancelled(error)) setActionError(errorMessage(error));
    } finally {
      setActivity(undefined);
    }
  };

  const restore = async () => {
    if (!userId || activity) return;
    setActivity("restore");
    setActionError(undefined);
    try {
      const storeResult = await restorePremiumPurchases(userId);
      queryClient.setQueryData(["premium-purchase-state", userId], storeResult);
      if (!storeResult.hasActiveStorePurchase) {
        setActionError("No active ReadMate Premium purchase was found for this store account.");
        return;
      }
      setActivationPending(true);
      const entitlement = await syncPremiumAccess();
      if (!entitlement.isPremium) {
        throw new Error("Your purchase was found, but Premium is still syncing. Wait a moment, then check activation.");
      }
      setActivationPending(false);
      Alert.alert("Purchases restored", "ReadMate Premium is active on this account.");
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setActivity(undefined);
    }
  };

  const checkActivation = async () => {
    if (!userId || activity) return;
    setActivity("restore");
    setActionError(undefined);
    try {
      const storeResult = await getPremiumPurchaseState(userId, true);
      queryClient.setQueryData(["premium-purchase-state", userId], storeResult);
      const entitlement = await syncPremiumAccess();
      if (!entitlement.isPremium) {
        setActionError("Your store purchase is still syncing. Wait a moment, then check activation again.");
        return;
      }
      setActivationPending(false);
      Alert.alert("Premium is active", "Premium audio and larger document limits are now unlocked.");
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setActivity(undefined);
    }
  };

  const manage = async () => {
    if (!userId || activity) return;
    setActivity("manage");
    setActionError(undefined);
    try {
      await managePremiumSubscription(userId);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setActivity(undefined);
    }
  };

  return (
    <Screen contentContainerStyle={{ gap: 18 }}>
      <NavBackButton label="Close Premium" />
      <PageHeader
        eyebrow="ReadMate Premium"
        title={isPremium ? "Your Premium access is active" : "Listen naturally. Read bigger documents."}
        subtitle={premiumSubtitle(source, isPremium)}
      />

      <View style={{ gap: 14, padding: 18, borderRadius: radius.xxl, borderCurve: "continuous", backgroundColor: colors.player, boxShadow: "0 16px 34px -24px rgba(31, 42, 36, 0.70)" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 46, height: 46, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: "rgba(255, 253, 248, 0.12)" }}>
            <AppIcon name="star.fill" size={23} color="#fffdf8" weight="semibold" />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text selectable style={{ color: "#fffdf8", fontSize: 24, fontWeight: "700", ...displayText }}>Premium</Text>
            <Text selectable style={{ color: "rgba(255,253,248,0.72)", fontSize: 13 }}>One membership across your signed-in devices</Text>
          </View>
        </View>
        <PremiumFeature icon="waveform" title="Natural premium audio" body="Studio-quality Gemini 3.8 Flash voices for English listening." />
        <PremiumFeature icon="doc.text" title="Larger documents" body="Upload longer PDFs and documents within your Premium limits." />
        <PremiumFeature icon="headphones" title="More daily listening" body="Higher text-to-speech usage for serious reading sessions." />
      </View>

      {isPremium ? (
        <SectionCard elevated>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
            <AppIcon name="checkmark.circle.fill" size={24} color={colors.green} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text selectable style={{ color: colors.ink, fontSize: 17, fontWeight: "800" }}>ReadMate Premium is active</Text>
              <Text selectable style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>Manage renewal and billing in the store where you subscribed.</Text>
            </View>
          </View>
          <ActionButton label={activity === "manage" ? "Opening subscriptions..." : "Manage subscription"} disabled={Boolean(activity)} onPress={() => void manage()} />
        </SectionCard>
      ) : entitlementQuery.isError ? (
        <SectionCard>
          <Text selectable style={{ color: colors.ink, fontSize: 17, fontWeight: "800" }}>Premium service is temporarily unavailable</Text>
          <Text selectable style={{ color: colors.red, fontSize: 13, lineHeight: 19 }}>{errorMessage(entitlementQuery.error)}</Text>
          <ActionButton label="Try again" tone="soft" onPress={() => void entitlementQuery.refetch()} />
        </SectionCard>
      ) : activationNeedsSync ? (
        <SectionCard elevated>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
            <AppIcon name="checkmark.circle.fill" size={24} color={colors.green} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text selectable style={{ color: colors.ink, fontSize: 17, fontWeight: "800" }}>Your purchase was received</Text>
              <Text selectable style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>ReadMate is waiting for the store subscription to reach the secure entitlement service. You will not be asked to buy again.</Text>
            </View>
          </View>
          <ActionButton label={activity === "restore" ? "Checking activation..." : "Check activation"} disabled={Boolean(activity)} onPress={() => void checkActivation()} />
        </SectionCard>
      ) : offeringQuery.isLoading || entitlementQuery.isLoading || storeStateQuery.isLoading ? (
        <SectionCard>
          <View style={{ minHeight: 100, alignItems: "center", justifyContent: "center", gap: 10 }}>
            <ActivityIndicator color={colors.player} />
            <Text selectable style={{ color: colors.muted, fontSize: 13 }}>Loading plans from your app store...</Text>
          </View>
        </SectionCard>
      ) : storeStateQuery.error || offeringQuery.error ? (
        <SectionCard>
          <Text selectable style={{ color: colors.ink, fontSize: 17, fontWeight: "800" }}>Plans are temporarily unavailable</Text>
          <Text selectable style={{ color: colors.red, fontSize: 13, lineHeight: 19 }}>{errorMessage(storeStateQuery.error ?? offeringQuery.error)}</Text>
          <ActionButton label="Try again" tone="soft" onPress={() => void (storeStateQuery.isError ? storeStateQuery.refetch() : offeringQuery.refetch())} />
        </SectionCard>
      ) : (
        <View style={{ gap: 10 }}>
          <Text selectable style={{ color: colors.claret, fontSize: 12, fontWeight: "900", letterSpacing: 0.7, textTransform: "uppercase" }}>Choose your plan</Text>
          {packages.map((item) => (
            <PremiumPlanCard key={item.id} item={item} selected={selectedPackage?.id === item.id} onPress={() => setSelectedPackageId(item.id)} />
          ))}
          <ActionButton
            label={activity === "purchase" ? "Confirming with the store..." : selectedPackage ? `Continue with ${selectedPackage.displayName}` : "Choose a plan"}
            disabled={!selectedPackage || Boolean(activity)}
            onPress={() => void purchase()}
          />
        </View>
      )}

      {actionError ? (
        <View style={{ gap: 8, padding: 13, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.redSoft }}>
          <Text selectable style={{ color: colors.red, fontSize: 13, lineHeight: 19, fontWeight: "700" }}>{actionError}</Text>
          {!isPremium && activationNeedsSync
            ? <ActionButton label={activity === "restore" ? "Checking activation..." : "Check activation"} tone="soft" disabled={Boolean(activity)} onPress={() => void checkActivation()} />
            : !isPremium
              ? <ActionButton label="Restore Purchases" tone="soft" disabled={Boolean(activity)} onPress={() => void restore()} />
              : null}
        </View>
      ) : null}

      {!isPremium && !activationNeedsSync ? (
        <Pressable accessibilityRole="button" disabled={Boolean(activity)} onPress={() => void restore()} style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.player, fontSize: 14, fontWeight: "800" }}>{activity === "restore" ? "Checking purchases..." : "Restore Purchases"}</Text>
        </Pressable>
      ) : null}

      <View style={{ gap: 10, alignItems: "center", paddingHorizontal: 8 }}>
        <Text selectable style={{ color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center" }}>
          The store shows the final localized price and billing period before you confirm. Subscriptions renew automatically until canceled in your App Store or Google Play settings.
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
          <Link href={{ pathname: "/about", params: { section: "privacy" } }} asChild>
            <Pressable><Text style={{ color: colors.player, fontSize: 12, fontWeight: "800" }}>Privacy Policy</Text></Pressable>
          </Link>
          <Pressable onPress={() => void Linking.openURL(termsUrl())}>
            <Text style={{ color: colors.player, fontSize: 12, fontWeight: "800" }}>Terms of Use</Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

function PremiumFeature({ icon, title, body }: { icon: "waveform" | "doc.text" | "headphones"; title: string; body: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
      <AppIcon name="checkmark.circle.fill" size={19} color="#a6c69a" />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <AppIcon name={icon} size={16} color="#fffdf8" />
          <Text selectable style={{ color: "#fffdf8", fontSize: 14, fontWeight: "800" }}>{title}</Text>
        </View>
        <Text selectable style={{ color: "rgba(255,253,248,0.68)", fontSize: 12, lineHeight: 17 }}>{body}</Text>
      </View>
    </View>
  );
}

function PremiumPlanCard({ item, selected, onPress }: { item: PremiumPackageDescriptor; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${item.displayName}, ${item.billingLabel}`}
      onPress={onPress}
      style={{ gap: 7, padding: 15, borderRadius: radius.xl, borderCurve: "continuous", backgroundColor: selected ? colors.greenSoft : colors.surface, borderWidth: 2, borderColor: selected ? colors.green : colors.border }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ width: 23, height: 23, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, borderWidth: 2, borderColor: selected ? colors.green : colors.faint, backgroundColor: selected ? colors.green : "transparent" }}>
          {selected ? <AppIcon name="checkmark" size={14} color="#ffffff" weight="bold" /> : null}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text selectable style={{ color: colors.ink, fontSize: 17, fontWeight: "800" }}>{item.displayName}</Text>
            {item.recommended ? <Text selectable style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, overflow: "hidden", backgroundColor: colors.claretSoft, color: colors.claret, fontSize: 10, fontWeight: "900", textTransform: "uppercase" }}>Recommended</Text> : null}
          </View>
          {item.description ? <Text selectable numberOfLines={2} style={{ color: colors.muted, fontSize: 12, lineHeight: 17 }}>{item.description}</Text> : null}
        </View>
        <Text selectable numberOfLines={2} style={{ maxWidth: 118, color: colors.ink, fontSize: 14, lineHeight: 18, textAlign: "right", fontWeight: "900", fontVariant: ["tabular-nums"] }}>{item.billingLabel}</Text>
      </View>
    </Pressable>
  );
}

function normalizeSource(value?: string): PremiumSource {
  return value === "premium_audio" || value === "large_documents" || value === "account" || value === "more" ? value : "more";
}

function premiumSubtitle(source: PremiumSource, active: boolean): string {
  if (active) return "Premium audio, larger documents, and higher listening limits are available on this account.";
  if (source === "premium_audio") return "Upgrade to unlock Gemini Flash studio-quality voices. Gemini Lite, Google, Twi, Ewe, and Ga audio remain available on Free.";
  if (source === "large_documents") return "Upgrade when a document is larger than the Free upload or PDF page limits.";
  return "Choose a plan from your app store. Prices below come directly from the store for your region.";
}

function termsUrl(): string {
  return Platform.OS === "ios"
    ? "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
    : "https://play.google.com/about/play-terms/";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Premium is temporarily unavailable. Please try again.";
}
