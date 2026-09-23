import { useMemo, useState } from "react";
import { useUser } from "@clerk/expo";
import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from "react-native";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import { EditorialImage } from "@/components/editorial-image";
import { estimateListeningSeconds } from "@/components/content-card";
import { BrandLockup, EmptyCard, Screen, SettingsShortcut, colors, displayText, radius, useResponsiveLayout } from "@/components/mobile-design";
import { PlaybackBar } from "@/components/playback-bar";
import { useReadingLibrary } from "@/hooks/use-reading-library";
import { usePlaybackManager } from "@/playback/playback-manager";
import type { ReadingDocument, UserSettings } from "@/types";
import { getProfileFirstName } from "@/utils/profile-name";

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useUser();
  const { documents, documentsQuery, settings, saveSettings } = useReadingLibrary();
  const playback = usePlaybackManager();
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [playRequest, setPlayRequest] = useState(0);
  const { isTablet } = useResponsiveLayout();
  const activeDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) ?? documents[0],
    [documents, selectedDocumentId]
  );
  const recentDocuments = documents.slice(0, 3);
  const firstName = getProfileFirstName(user?.firstName, user?.fullName);
  const welcomeMessage = `${greetingForHour(new Date().getHours())}${firstName ? `, ${firstName}` : ""}.`;

  function playDocument(document: ReadingDocument) {
    playback.selectDocument(document);
    setSelectedDocumentId(document.id);
    setPlayRequest((current) => current + 1);
  }

  return (
    <Screen
      bottomNavigation="/(tabs)"
      contentContainerStyle={{ gap: isTablet ? 28 : 12 }}
      refreshControl={<RefreshControl refreshing={documentsQuery.isRefetching} onRefresh={() => void documentsQuery.refetch()} />}
    >
      <View style={{ gap: 12, paddingHorizontal: 4, paddingTop: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <BrandLockup large />
          <SettingsShortcut size={50} />
        </View>
        <Text selectable accessibilityRole="header" style={{ color: colors.ink, fontSize: 20, lineHeight: 26, fontWeight: "700", ...displayText }}>
          {welcomeMessage}
        </Text>
      </View>

      <View style={{ width: "100%", maxWidth: isTablet ? 650 : undefined, alignSelf: "center" }}>
        <PlaybackBar
          document={activeDocument}
          queue={documents}
          autoPlayKey={playRequest}
          onDocumentChange={(nextDocument) => setSelectedDocumentId(nextDocument.id)}
          settings={settings}
          onSettingsChange={(next) => saveSettings.mutate(next)}
          settingsSaving={saveSettings.isPending}
        />
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <HomeAction label="Add reading" icon="doc.text" onPress={() => router.push("/add-content")} />
        <HomeAction label="Open library" icon="books.vertical" onPress={() => router.push("/(tabs)/library")} />
      </View>

      <View style={{ gap: 2 }}>
        <Text selectable style={{ color: colors.claret, fontSize: 18, lineHeight: 24, fontWeight: "700", ...displayText }}>
          Continue reading
        </Text>
        {documentsQuery.isLoading ? <ActivityIndicator color={colors.player} style={{ paddingVertical: 28 }} /> : null}
        {recentDocuments.length === 0 && !documentsQuery.isLoading ? <EmptyState /> : null}
        {recentDocuments.map((document) => (
          <ContinueRow
            key={document.id}
            document={document}
            targetLanguage={settings?.targetLanguage ?? "en"}
            onOpen={() => router.push({ pathname: "/document/[id]", params: { id: document.id } })}
            onPlay={() => playDocument(document)}
          />
        ))}
      </View>
    </Screen>
  );
}

function HomeAction({ label, icon, onPress }: { label: string; icon: AppIconName; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: colors.rule,
        backgroundColor: pressed ? colors.surfaceSoft : colors.surface
      })}
    >
      <AppIcon name={icon} size={19} color={colors.claret} />
      <Text style={{ color: colors.claret, fontSize: 14, fontWeight: "800" }}>{label}</Text>
    </Pressable>
  );
}

function ContinueRow({
  document,
  targetLanguage,
  onOpen,
  onPlay
}: {
  document: ReadingDocument;
  targetLanguage: UserSettings["targetLanguage"];
  onOpen: () => void;
  onPlay: () => void;
}) {
  const duration = estimateListeningSeconds(document);
  const elapsed = Math.round(duration * (Math.min(100, Math.max(0, document.progress.percent)) / 100));
  return (
    <View style={{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 2, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${document.title}`} onPress={onOpen}>
        <EditorialImage document={document} style={{ width: 44, height: 44, borderRadius: radius.md }} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${document.title}`} onPress={onOpen} style={{ flex: 1, minWidth: 0, gap: 5 }}>
        <Text selectable numberOfLines={2} style={{ color: colors.ink, fontSize: 14, lineHeight: 17, fontWeight: "700", ...displayText }}>
          {document.title}
        </Text>
        <Text selectable numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>
          {languageLabel(targetLanguage)} · {formatTime(elapsed)} / {formatTime(duration)}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Play ${document.title}`}
        onPress={onPlay}
        style={({ pressed }) => ({ width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: pressed ? colors.bgAlt : colors.surfaceSoft })}
      >
        <AppIcon name="play.fill" size={16} color={colors.player} weight="bold" />
      </Pressable>
    </View>
  );
}

function EmptyState() {
  return <EmptyCard title="Nothing saved yet" body="Save an article from Chrome, add a website, connect a feed, or upload a PDF." />;
}

function languageLabel(targetLanguage: UserSettings["targetLanguage"]): string {
  if (targetLanguage === "tw") return "Twi";
  if (targetLanguage === "ee") return "Ewe";
  if (targetLanguage === "gaa") return "Ga";
  return "English";
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function greetingForHour(hour: number): "Good morning" | "Good afternoon" | "Good evening" {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
