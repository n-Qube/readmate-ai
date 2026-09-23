import { useAuth, useUser } from "@clerk/expo";
import { canOfferPremiumUpgrade } from "@/purchases/purchases-availability";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { Pressable, Text, View } from "react-native";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import { BrandLockup, BrandMark, Screen, colors, displayText, radius } from "@/components/mobile-design";
import type { SettingsSection } from "@/components/settings-panel";
import { screenshotMode } from "@/utils/screenshot-mode";
import { getEntitlements } from "@/api/documents";

type MoreItem = { title: string; icon: AppIconName; href?: "/add-content" | "/listening-history" | "/about"; onPress?: () => void };

export default function MoreScreen() {
  const { user } = useUser();
  const { getToken, isSignedIn } = useAuth();
  const router = useRouter();
  const displayName = user?.fullName ?? user?.firstName ?? (screenshotMode ? "Daniel" : "ReadMate reader");
  const entitlementQuery = useQuery({
    queryKey: ["entitlements"],
    queryFn: async () => getEntitlements(await getToken()),
    enabled: screenshotMode || Boolean(isSignedIn)
  });
  const isPremium = entitlementQuery.data?.isPremium === true;

  const groups: Array<{ title: string; items: MoreItem[] }> = [
    {
      title: "Content",
      items: [
        { title: "Add content", icon: "plus", href: "/add-content" },
        { title: "Listening history", icon: "arrow.counterclockwise", href: "/listening-history" },
        { title: "Downloads", icon: "arrow.down.to.line" }
      ]
    },
    {
      title: "Preferences",
      items: [
        { title: "Voice & playback", icon: "headphones", onPress: () => openSettingsSection(router, "listening") },
        { title: "Reading language", icon: "globe", onPress: () => openSettingsSection(router, "language") },
        { title: "Reading display", icon: "textformat", onPress: () => openSettingsSection(router, "reading") }
      ]
    },
    {
      title: "ReadMate",
      items: [
        ...(isPremium || canOfferPremiumUpgrade(isPremium)
          ? [{ title: isPremium ? "Manage Premium" : "Upgrade to Premium", icon: "star.fill" as const, onPress: () => router.push({ pathname: "/premium", params: { source: "more" } }) }]
          : []),
        { title: "About ReadMate", icon: "info.circle", href: "/about" },
        { title: "Help & feedback", icon: "questionmark.circle", onPress: () => void Linking.openURL("mailto:support@readmate.ai?subject=ReadMate%20feedback") },
        { title: "Privacy", icon: "checkmark.circle.fill", onPress: () => router.push({ pathname: "/about", params: { section: "privacy" } }) }
      ]
    }
  ];

  return (
    <Screen bottomNavigation="/(tabs)/more" contentContainerStyle={{ gap: 22 }}>
      <View style={{ gap: 20 }}>
        <BrandLockup large />
        <View style={{ gap: 7 }}>
          <Text selectable style={{ color: colors.ink, fontSize: 31, lineHeight: 36, fontWeight: "700", ...displayText }}>More</Text>
          <Text selectable style={{ color: colors.text, fontSize: 16, lineHeight: 23 }}>Your reading, listening, and account tools.</Text>
        </View>

        <Pressable onPress={() => openSettingsSection(router, "account")} style={{ minHeight: 66, flexDirection: "row", alignItems: "center", gap: 14, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: colors.rule }}>
            <View style={{ width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center", backgroundColor: "#075c3a" }}>
              <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "800" }}>{initials(displayName)}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text selectable style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>{displayName}</Text>
              <Text selectable style={{ color: "#075c3a", fontSize: 14, fontWeight: "600" }}>{isPremium ? "ReadMate Premium" : entitlementQuery.data ? "ReadMate Free" : "Checking plan..."}</Text>
            </View>
            <AppIcon name="chevron.right" size={22} color={colors.muted} />
        </Pressable>
      </View>

      {groups.map((group) => (
        <View key={group.title} style={{ gap: 5 }}>
          <SectionLabel>{group.title}</SectionLabel>
          <View>
            {group.items.map((item, index) => <MoreRow key={item.title} item={item} last={index === group.items.length - 1} />)}
          </View>
        </View>
      ))}

      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.rule }}>
        <BrandMark size={62} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text selectable style={{ color: colors.ink, fontSize: 17, fontWeight: "700", ...displayText }}>About ReadMate</Text>
          <Text selectable style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>Turn anything worth reading into something worth listening to.</Text>
          <Text selectable style={{ color: colors.muted, fontSize: 12 }}>Version 1.0.2</Text>
          <View style={{ flexDirection: "row", gap: 14 }}>
            <Pressable onPress={() => router.push({ pathname: "/about", params: { section: "privacy" } })}><Text style={{ color: colors.player, fontSize: 12, fontWeight: "700" }}>Privacy Policy</Text></Pressable>
            <Pressable onPress={() => void Linking.openURL("mailto:support@readmate.ai?subject=ReadMate%20support")}><Text style={{ color: colors.player, fontSize: 12, fontWeight: "700" }}>Contact support</Text></Pressable>
          </View>
        </View>
      </View>
    </Screen>
  );
}

function MoreRow({ item, last }: { item: MoreItem; last: boolean }) {
  const content = (
    <View style={{ minHeight: 64, flexDirection: "row", alignItems: "center", gap: 14, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.rule }}>
      <View style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.lg, backgroundColor: colors.blueChip }}>
        <AppIcon name={item.icon} size={22} color={colors.player} />
      </View>
      <Text style={{ flex: 1, color: colors.ink, fontSize: 16, fontWeight: "500" }}>{item.title}</Text>
      <AppIcon name="chevron.right" size={20} color={colors.muted} />
    </View>
  );

  if (item.href) return <Link href={item.href} asChild><Pressable>{content}</Pressable></Link>;
  return <Pressable accessibilityRole="button" onPress={item.onPress}>{content}</Pressable>;
}

function SectionLabel({ children }: { children: string }) {
  return <Text selectable style={{ color: colors.claret, fontSize: 14, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5 }}>{children}</Text>;
}

function initials(value: string): string {
  return value.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "RM";
}

function openSettingsSection(router: ReturnType<typeof useRouter>, section: SettingsSection | "account") {
  router.push(`/settings?section=${section}`);
}
