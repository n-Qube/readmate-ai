import { useAuth, useReverification, useUser } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { ApiError, apiBaseUrl } from "@/api/client";
import { createSpeechAudioFile, getEntitlements } from "@/api/documents";
import { providerShortLabel } from "@/config/tts-providers";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import { NavBackButton, PageHeader, Screen, SectionCard, SectionHeading, colors } from "@/components/mobile-design";
import { SettingsPanel, type SettingsSection } from "@/components/settings-panel";
import { previewTextForVoice, type LocalLanguage } from "@/config/local-voices";
import { defaultSettings, useReadingLibrary } from "@/hooks/use-reading-library";
import { screenshotMode } from "@/utils/screenshot-mode";

export default function SettingsScreen() {
  const { isLoaded, isSignedIn, signOut, getToken, userId } = useAuth();
  const { user } = useUser();
  const { settings, saveSettings } = useReadingLibrary();
  const router = useRouter();
  const { section: requestedSection } = useLocalSearchParams<{ section?: string }>();
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState<string>();
  const previewPlayerRef = useRef<AudioPlayer | null>(null);
  const currentSettings = settings ?? defaultSettings();
  const section = normalizeSection(requestedSection);
  const entitlementQuery = useQuery({
    queryKey: ["entitlements"],
    queryFn: async () => getEntitlements(await getToken()),
    enabled: Boolean(isSignedIn)
  });
  const isPremium = entitlementQuery.data?.isPremium ?? false;
  const deleteAccountWithReverification = useReverification(async () => {
    const token = await getToken({ skipCache: true });
    if (!token) throw new Error("Sign in again before deleting your account.");
    const response = await fetch(`${apiBaseUrl}/api/account`, {
      method: "DELETE",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` }
    });
    if (response.status === 204) return { deleted: true };
    const body = await response.json().catch(() => ({})) as {
      error?: string;
      clerk_error?: unknown;
    };
    if (response.status === 403 && body.clerk_error) return body;
    throw new ApiError(body.error ?? `Account deletion failed with ${response.status}`, response.status);
  });

  useEffect(() => () => {
    previewPlayerRef.current?.pause();
    previewPlayerRef.current?.remove();
    previewPlayerRef.current = null;
  }, []);

  if (!screenshotMode && isLoaded && !isSignedIn) {
    return <Redirect href="/" />;
  }

  const closeSettings = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)");
  };
  const confirmAccountDeletion = () => {
    if (deletingAccount) return;
    const deletionMessage = isPremium
      ? "This permanently deletes your ReadMate account and synced data. It does not cancel an App Store or Google Play subscription; manage the subscription first if you want to stop renewal."
      : "This permanently deletes your ReadMate account, saved library, uploads, notes, highlights, progress, and synced settings.";
    Alert.alert(
      "Delete account?",
      deletionMessage,
      [
        { text: "Cancel", style: "cancel" },
        ...(isPremium
          ? [{ text: "Manage Premium", onPress: () => router.push({ pathname: "/premium", params: { source: "account" } }) }]
          : []),
        {
          text: "Delete account",
          style: "destructive",
          onPress: () => {
            void deleteAccount();
          }
        }
      ]
    );
  };
  const deleteAccount = async () => {
    setDeletingAccount(true);
    try {
      const result = await deleteAccountWithReverification();
      if (!result || !("deleted" in result)) return;
      await signOut();
      router.replace("/");
    } catch (error) {
      Alert.alert("Account deletion failed", error instanceof Error ? error.message : "Try again in a moment.");
    } finally {
      setDeletingAccount(false);
    }
  };
  const previewLocalVoice = async (targetLanguage: LocalLanguage, voice: string) => {
    if (previewingVoice) return;
    setPreviewingVoice(voice);
    try {
      previewPlayerRef.current?.pause();
      previewPlayerRef.current?.remove();
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, shouldPlayInBackground: false });
      const uri = await createSpeechAudioFile(await getToken(), {
        userId: userId ?? "voice-preview",
        cacheKey: `local-voice-preview-v2-${targetLanguage}-${voice}`,
        text: previewTextForVoice(voice),
        provider: "google",
        voice,
        speed: 1,
        targetLanguage
      });
      const player = createAudioPlayer({ uri, name: `${languageShortLabel(targetLanguage)} voice preview` });
      previewPlayerRef.current = player;
      player.play();
    } catch (error) {
      Alert.alert("Voice preview unavailable", error instanceof Error ? error.message : "Try again in a moment.");
    } finally {
      setPreviewingVoice(undefined);
    }
  };

  return (
    <Screen bottomNavigation="/(tabs)/more">
      <NavBackButton label="Close settings and go back" onPress={closeSettings} />
      <PageHeader
        eyebrow={section ? "Settings" : "Profile, voice, sync, billing"}
        title={section ? settingsSectionMeta[section].title : "Settings"}
        subtitle={section ? settingsSectionMeta[section].subtitle : "Choose a settings area to change without losing your place."}
      />

      {!section ? (
        <>
          <AccountCard user={user} plan={entitlementQuery.data?.plan} onPress={() => router.push("/settings?section=account")} />
          <View style={{ gap: 12 }}>
            <SectionLabel>Preferences</SectionLabel>
            {settingsSections.map((item) => (
              <SettingsCategoryCard key={item.section} {...item} onPress={() => router.push(`/settings?section=${item.section}`)} value={settingsCategoryValue(item.section, currentSettings)} />
            ))}
          </View>
        </>
      ) : section === "account" ? (
        <AccountCard user={user} plan={entitlementQuery.data?.plan} deletingAccount={deletingAccount} onManagePlan={() => router.push({ pathname: "/premium", params: { source: "account" } })} onSignOut={() => signOut()} onDelete={confirmAccountDeletion} />
      ) : (
        <SettingsPanel section={section} settings={currentSettings} saving={saveSettings.isPending} isPremium={isPremium} previewingVoice={previewingVoice} onPreviewVoice={(language, voice) => void previewLocalVoice(language, voice)} onPremiumFeaturePress={() => router.push({ pathname: "/premium", params: { source: "premium_audio" } })} onChange={(next) => saveSettings.mutate(next)} />
      )}
    </Screen>
  );
}

function AccountCard({ user, plan, deletingAccount = false, onPress, onManagePlan, onSignOut, onDelete }: { user: ReturnType<typeof useUser>["user"]; plan?: "free" | "premium"; deletingAccount?: boolean; onPress?: () => void; onManagePlan?: () => void; onSignOut?: () => void; onDelete?: () => void }) {
  const content = (
    <SectionCard elevated>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ width: 52, height: 52, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: colors.blue }}>
          <Text style={{ color: "#ffffff", fontSize: 18, fontWeight: "800" }}>{initials(user?.fullName ?? user?.firstName ?? user?.primaryEmailAddress?.emailAddress)}</Text>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <SectionHeading title={user?.fullName ?? "ReadMate user"} />
          <Text selectable numberOfLines={1} style={{ color: colors.muted, fontSize: 14 }}>{user?.primaryEmailAddress?.emailAddress ?? user?.fullName ?? "ReadMate user"}</Text>
        </View>
      </View>
      <Text selectable style={{ color: colors.blue, alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.blueChip, fontSize: 11, fontWeight: "700" }}>{plan === "premium" ? "ReadMate Premium" : plan === "free" ? "ReadMate Free" : "Checking plan..."}</Text>
      {onManagePlan ? <Pressable accessibilityRole="button" accessibilityLabel={plan === "premium" ? "Manage Premium" : "Upgrade to Premium"} onPress={onManagePlan} style={{ minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, backgroundColor: colors.player }}><AppIcon name="star.fill" size={17} color="#ffffff" /><Text style={{ color: "#ffffff", fontWeight: "900" }}>{plan === "premium" ? "Manage Premium" : "Upgrade to Premium"}</Text></Pressable> : null}
      {onSignOut ? <Pressable onPress={onSignOut} style={{ minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: colors.bgAlt }}><Text style={{ color: colors.ink, fontWeight: "900" }}>Sign out</Text></Pressable> : null}
      {onDelete ? <Pressable accessibilityRole="button" accessibilityLabel="Delete account" disabled={deletingAccount} onPress={onDelete} style={{ minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: "#fff1f2", borderWidth: 1, borderColor: "#fecdd3", opacity: deletingAccount ? 0.6 : 1 }}><Text style={{ color: "#be123c", fontWeight: "900" }}>{deletingAccount ? "Deleting account..." : "Delete account"}</Text></Pressable> : null}
      {onPress ? <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text style={{ color: colors.muted, fontSize: 13 }}>Account, plan, and security</Text><AppIcon name="chevron.right" size={18} color={colors.muted} /></View> : null}
    </SectionCard>
  );
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel="Open account settings" onPress={onPress}>{content}</Pressable> : content;
}

function SettingsCategoryCard({ title, subtitle, icon, onPress, value }: { title: string; subtitle: string; icon: AppIconName; onPress: () => void; value: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${title}`} onPress={onPress} style={{ minHeight: 76, flexDirection: "row", alignItems: "center", gap: 13, padding: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <View style={{ width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: colors.blueChip }}><AppIcon name={icon} size={20} color={colors.player} /></View>
      <View style={{ flex: 1, gap: 3 }}><Text style={{ color: colors.ink, fontSize: 16, fontWeight: "800" }}>{title}</Text><Text selectable numberOfLines={1} style={{ color: colors.muted, fontSize: 13 }}>{subtitle} · {value}</Text></View>
      <AppIcon name="chevron.right" size={19} color={colors.muted} />
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text selectable style={{ color: colors.claret, fontSize: 12, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" }}>{children}</Text>;
}

const settingsSections: Array<{ section: SettingsSection; title: string; subtitle: string; icon: AppIconName }> = [
  { section: "listening", title: "Voice & playback", subtitle: "Provider, speaker previews, and speed", icon: "headphones" },
  { section: "language", title: "Reading language", subtitle: "English, Twi, Ewe, and Ga", icon: "globe" },
  { section: "reading", title: "Reading display", subtitle: "Auto-scroll and highlighting", icon: "textformat" },
  { section: "study", title: "AI & study", subtitle: "Summaries, flashcards, citations", icon: "sparkles" },
  { section: "sync", title: "Sync & feeds", subtitle: "Chrome sync and RSS", icon: "cloud" }
];

const settingsSectionMeta: Record<SettingsSection | "account", { title: string; subtitle: string }> = {
  listening: { title: "Voice & playback", subtitle: "Make ReadMate sound the way you want." },
  language: { title: "Reading language", subtitle: "Choose the language used for translation and speech." },
  reading: { title: "Reading display", subtitle: "Tune highlighting and movement while you read." },
  study: { title: "AI & study", subtitle: "Choose what ReadMate prepares for learning." },
  sync: { title: "Sync & feeds", subtitle: "Keep your library and sources aligned across devices." },
  account: { title: "Account", subtitle: "Manage your profile, plan, and security." }
};

function normalizeSection(value?: string | string[]): SettingsSection | "account" | undefined {
  const section = Array.isArray(value) ? value[0] : value;
  if (section === "account") return "account";
  return settingsSections.some((item) => item.section === section) ? section as SettingsSection : undefined;
}

function settingsCategoryValue(section: SettingsSection, settings: ReturnType<typeof defaultSettings>): string {
  if (section === "listening") return `${providerShortLabel(settings.provider)} · ${settings.speed}x`;
  if (section === "language") return languageShortLabel(settings.targetLanguage);
  if (section === "reading") return settings.autoScroll ? "Auto-scroll on" : "Manual scroll";
  if (section === "study") return "Daily review";
  return `${settings.articlesPerFeed} articles/feed`;
}

function languageShortLabel(language: ReturnType<typeof defaultSettings>["targetLanguage"]): string {
  return language === "tw" ? "Twi" : language === "ee" ? "Ewe" : language === "gaa" ? "Ga" : "English";
}

function initials(value?: string | null): string {
  const text = value?.trim();
  if (!text) return "RM";
  const parts = text.includes("@") ? text.split("@")[0].split(/[._-]/) : text.split(/\s+/);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "RM";
}
