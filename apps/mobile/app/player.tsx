import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { getDocument } from "@/api/documents";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import { EditorialImage } from "@/components/editorial-image";
import { NavBackButton, Screen, colors, displayText, radius, useResponsiveLayout } from "@/components/mobile-design";
import { PlaybackBar } from "@/components/playback-bar";
import { useReadingLibrary } from "@/hooks/use-reading-library";
import { usePlaybackManager } from "@/playback/playback-manager";
import { screenshotMode } from "@/utils/screenshot-mode";
import { documentForListening } from "@/webmcp/imperative-handlers";
import { parsePlayerDeepLink, settingsForPlayerDeepLink } from "@/webmcp/player-deep-link";

export default function PlayerScreen() {
  const router = useRouter();
  const routeParams = useLocalSearchParams<{
    documentId?: string | string[];
    targetLanguage?: string | string[];
    startAt?: string | string[];
  }>();
  const { documentId, targetLanguage, startAt } = parsePlayerDeepLink(routeParams);
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const player = usePlaybackManager();
  const { isTablet, isLandscape } = useResponsiveLayout();
  const { documents, settings, settingsQuery, saveSettings } = useReadingLibrary();
  const [bookmarked, setBookmarked] = useState(false);
  const [preparedLanguageKey, setPreparedLanguageKey] = useState<string | undefined>(undefined);
  const [languagePreparationState, setLanguagePreparationState] = useState<"idle" | "saving" | "error">("idle");
  const [languagePreparationAttempt, setLanguagePreparationAttempt] = useState(0);
  const restoredDocumentKeyRef = useRef<string | undefined>(undefined);
  const preparingLanguageKeyRef = useRef<string | undefined>(undefined);
  const failedLanguageKeyRef = useRef<string | undefined>(undefined);
  const requestedLanguageKey = documentId && targetLanguage ? `${documentId}:${targetLanguage}` : undefined;
  const requestedLanguageKeyRef = useRef(requestedLanguageKey);
  requestedLanguageKeyRef.current = requestedLanguageKey;
  const documentQuery = useQuery({ queryKey: ["document", documentId], queryFn: async () => getDocument(String(documentId), await getToken()), enabled: Boolean(documentId) });
  const activeDocumentForRoute = !documentId || player.activeDocument?.id === documentId
    ? player.activeDocument
    : undefined;
  const document = activeDocumentForRoute ?? documentQuery.data;
  const isActive = Boolean(document && player.activeDocument?.id === document.id);
  const percent = Math.max(0, Math.min(100, isActive ? player.percent : document?.progress.percent ?? 0));
  const blockIndex = isActive ? player.activeBlockIndex : document?.progress.blockIndex ?? 0;
  const currentBlock = document?.blocks?.[blockIndex];
  const duration = isActive && player.duration > 0 ? player.duration : document?.estimatedListeningSeconds ?? 1680;
  const currentTime = isActive ? player.currentTime : duration * (percent / 100);
  const isPlaying = isActive && player.state === "playing";

  useEffect(() => {
    const requestedDocument = documentQuery.data;
    if (!documentId || !requestedDocument || requestedDocument.id !== documentId) return;

    const restoreKey = `${documentId}:${startAt}`;
    if (restoredDocumentKeyRef.current === restoreKey) return;
    restoredDocumentKeyRef.current = restoreKey;
    player.selectDocument(documentForListening(requestedDocument, startAt), {
      resetPlayback: startAt === "beginning"
    });
  }, [documentId, documentQuery.data, player, startAt]);

  useEffect(() => {
    if (!requestedLanguageKey || !settings || !targetLanguage) return;
    if (
      preparedLanguageKey === requestedLanguageKey ||
      preparingLanguageKeyRef.current === requestedLanguageKey ||
      failedLanguageKeyRef.current === requestedLanguageKey ||
      saveSettings.isPending
    ) return;

    const nextSettings = settingsForPlayerDeepLink(settings, targetLanguage);
    if (!nextSettings) {
      setPreparedLanguageKey(requestedLanguageKey);
      setLanguagePreparationState("idle");
      return;
    }

    preparingLanguageKeyRef.current = requestedLanguageKey;
    setLanguagePreparationState("saving");
    saveSettings.mutate(nextSettings, {
      onSuccess: () => {
        if (preparingLanguageKeyRef.current === requestedLanguageKey) {
          preparingLanguageKeyRef.current = undefined;
        }
        if (requestedLanguageKeyRef.current !== requestedLanguageKey) return;
        failedLanguageKeyRef.current = undefined;
        setPreparedLanguageKey(requestedLanguageKey);
        setLanguagePreparationState("idle");
      },
      onError: () => {
        if (preparingLanguageKeyRef.current === requestedLanguageKey) {
          preparingLanguageKeyRef.current = undefined;
        }
        if (requestedLanguageKeyRef.current !== requestedLanguageKey) return;
        failedLanguageKeyRef.current = requestedLanguageKey;
        setPreparedLanguageKey(undefined);
        setLanguagePreparationState("error");
      }
    });
  }, [languagePreparationAttempt, preparedLanguageKey, requestedLanguageKey, saveSettings, settings, targetLanguage]);

  const languagePreparationBlocked = Boolean(
    requestedLanguageKey && (
      preparedLanguageKey !== requestedLanguageKey ||
      languagePreparationState !== "idle"
    )
  );
  const languagePreparationFailed = Boolean(
    requestedLanguageKey && (languagePreparationState === "error" || settingsQuery.isError)
  );

  if (!screenshotMode && isLoaded && !isSignedIn) {
    return <Redirect href="/" />;
  }

  function toggle() {
    if (!languagePreparationBlocked && !saveSettings.isPending && document) void player.toggleDocument(document);
  }

  function chooseSpeed() {
    if (!settings) return;
    const options = [0.75, 1, 1.25, 1.5, 2];
    Alert.alert("Playback speed", "Choose how fast ReadMate should read.", [
      ...options.map((speed) => ({
        text: `${speed}×${speed === settings.speed ? " · Current" : ""}`,
        onPress: () => {
          const { userId: _userId, updatedAt: _updatedAt, ...editable } = settings;
          saveSettings.mutate({ ...editable, speed });
        }
      })),
      { text: "Cancel", style: "cancel" }
    ]);
  }

  function chooseQueue() {
    if (languagePreparationBlocked || saveSettings.isPending) return;
    const queue = documents.slice(0, 10);
    if (!queue.length) return;
    Alert.alert("Queue", "Choose an article to play next.", [
      ...queue.map((item) => ({
        text: item.title,
        onPress: () => {
          if (!languagePreparationBlocked && !saveSettings.isPending) void player.playDocument(item);
        }
      })),
      { text: "Cancel", style: "cancel" }
    ]);
  }

  return (
    <Screen bottomNavigation contentContainerStyle={{ gap: isTablet ? 24 : 20 }}>
      <View style={{ minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <NavBackButton label="Back to previous screen" />
        <Text selectable style={{ color: colors.ink, fontSize: 20, fontWeight: "700", ...displayText }}>Now Playing</Text>
        <HeaderButton label={bookmarked ? "Remove bookmark" : "Bookmark"} icon="bookmark" selected={bookmarked} onPress={() => setBookmarked((value) => !value)} />
      </View>

      <View style={{ flexDirection: isTablet ? "row" : "column", alignItems: "flex-start", gap: isTablet ? 28 : 20 }}>
        <View style={{ flex: 1, width: isTablet ? undefined : "100%", minWidth: 0, gap: 18 }}>
          <PlaybackBar
            document={document}
            variant="expanded"
            queue={documents}
            settings={settings}
            onSettingsChange={(next) => saveSettings.mutate(next)}
            settingsSaving={saveSettings.isPending}
            playbackDisabled={languagePreparationBlocked}
          />

          {requestedLanguageKey && languagePreparationBlocked && !languagePreparationFailed ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: colors.blueChip }}>
              <AppIcon name="waveform" size={18} color={colors.player} />
              <Text selectable style={{ flex: 1, color: colors.player, fontSize: 13, lineHeight: 18 }}>
                Preparing {languageName(targetLanguage)} playback. Play will be available when it is ready.
              </Text>
            </View>
          ) : null}

          {requestedLanguageKey && languagePreparationFailed ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: colors.redSoft }}>
              <Text selectable style={{ flex: 1, color: colors.red, fontSize: 13, lineHeight: 18 }}>
                ReadMate could not prepare {languageName(targetLanguage)} playback. No audio was started.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Retry ${languageName(targetLanguage)} playback setup`}
                onPress={() => {
                  failedLanguageKeyRef.current = undefined;
                  setLanguagePreparationState("idle");
                  setLanguagePreparationAttempt((attempt) => attempt + 1);
                  if (settingsQuery.isError) void settingsQuery.refetch();
                }}
                style={{ minHeight: 38, justifyContent: "center", paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.claret }}
              >
                <Text style={{ color: "#fffdf8", fontWeight: "800" }}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4 }}>
            <AppIcon name="speaker.wave.2.fill" size={18} color={colors.text} />
            <View style={{ flex: 1, height: 5, borderRadius: 999, backgroundColor: colors.bgAlt }}><View style={{ width: "72%", height: "100%", borderRadius: 999, backgroundColor: "#075c3a" }} /></View>
            <AppIcon name="speaker.wave.2.fill" size={24} color={colors.text} />
          </View>
        </View>

        <View style={{ flex: 1, width: isTablet ? undefined : "100%", minWidth: 0, gap: isTablet ? 24 : 20, paddingTop: isTablet && isLandscape ? 2 : 0 }}>
          <View style={{ gap: 12, paddingTop: 17, borderTopWidth: 1, borderTopColor: colors.rule }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text selectable style={{ color: colors.claret, fontSize: 17, fontWeight: "700", ...displayText }}>Chapters</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="See all queued articles"
                accessibilityState={{ disabled: languagePreparationBlocked || saveSettings.isPending }}
                disabled={languagePreparationBlocked || saveSettings.isPending}
                onPress={chooseQueue}
                style={{ opacity: languagePreparationBlocked || saveSettings.isPending ? 0.45 : 1 }}
              >
                <Text style={{ color: colors.player, fontSize: 14, fontWeight: "600" }}>See All</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <Text selectable numberOfLines={2} style={{ flex: 1, color: colors.ink, fontSize: 15, fontWeight: "700", ...displayText }}>{Math.max(1, blockIndex + 1)}. {chapterTitle(document?.blocks?.[blockIndex]?.text)}</Text>
              <Text selectable style={{ color: colors.muted, fontSize: 13 }}>{Math.max(1, Math.round(duration / Math.max(1, document?.blocks?.length ?? 1) / 60))} min</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 5 }}>
              {Array.from({ length: 6 }).map((_, index) => <View key={index} style={{ flex: 1, height: 5, borderRadius: 999, backgroundColor: index <= Math.min(5, Math.floor(percent / 17)) ? "#075c3a" : colors.bgAlt }} />)}
            </View>
          </View>

          <View style={{ gap: 10 }}>
            <Text selectable style={{ color: colors.claret, fontSize: 17, fontWeight: "700", ...displayText }}>Current Paragraph</Text>
            <Text selectable style={{ color: colors.text, fontSize: isTablet ? 18 : 17, lineHeight: isTablet ? 29 : 27, ...displayText }}>{currentBlock?.text ?? "Start an article from your library to follow the current paragraph as ReadMate reads it aloud."}</Text>
          </View>

          <View style={{ flexDirection: "row", flexWrap: isTablet ? "wrap" : "nowrap", gap: 8 }}>
            <QuickAction tablet={isTablet} label="Summary" icon="doc.text" onPress={() => document && router.push({ pathname: "/document/[id]", params: { id: document.id, mode: "summary" } })} />
            <QuickAction tablet={isTablet} label="Highlights" icon="pencil" onPress={() => document && router.push({ pathname: "/document/[id]", params: { id: document.id, mode: "highlights" } })} />
            <QuickAction tablet={isTablet} label="Ask AI" icon="quote.bubble" onPress={() => document && router.push({ pathname: "/document/[id]", params: { id: document.id, mode: "ask" } })} />
            <QuickAction tablet={isTablet} label="Study" icon="graduationcap" onPress={() => document && router.push({ pathname: "/document/[id]", params: { id: document.id, mode: "flashcards" } })} />
          </View>

          {player.error && isActive ? <Text selectable style={{ color: colors.red, fontSize: 13 }}>{player.error}</Text> : null}
        </View>
      </View>
    </Screen>
  );
}

function HeaderButton({ label, icon, selected, onPress }: { label: string; icon: "chevron.left" | "bookmark"; selected?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.lg, backgroundColor: selected ? colors.blueChip : colors.surface, borderWidth: 1, borderColor: colors.border }}><AppIcon name={icon} size={22} color={colors.player} /></Pressable>;
}

function RoundControl({ label, icon, disabled, onPress }: { label: string; icon: "arrow.counterclockwise" | "arrow.clockwise"; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{ width: 46, height: 46, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.42 : 1 }}><AppIcon name={icon} size={26} color="#075c3a" /></Pressable>;
}

function UtilityControl({ label, icon, onPress }: { label: string; icon: AppIconName; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ minWidth: 42, minHeight: 48, alignItems: "center", justifyContent: "center" }}><AppIcon name={icon} size={24} color="#075c3a" /></Pressable>;
}

function QuickAction({ label, icon, onPress, tablet }: { label: string; icon: AppIconName; onPress: () => void; tablet?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ flex: 1, minWidth: tablet ? "46%" : 0, minHeight: 76, alignItems: "center", justifyContent: "center", gap: 8, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}><AppIcon name={icon} size={25} color={colors.text} /><Text style={{ color: colors.ink, fontSize: 13 }}>{label}</Text></Pressable>;
}

function Progress({ percent }: { percent: number }) {
  return <View style={{ height: 5, borderRadius: 999, backgroundColor: colors.bgAlt }}><View style={{ width: `${percent}%`, height: "100%", borderRadius: 999, backgroundColor: "#075c3a" }} /></View>;
}

const timeStyle = { color: colors.muted, fontSize: 13, fontVariant: ["tabular-nums"] as const };

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function chapterTitle(value?: string): string {
  if (!value) return "Continue listening";
  return value.length > 48 ? `${value.slice(0, 47)}…` : value;
}

function languageName(language?: "en" | "tw" | "ee" | "gaa"): string {
  if (language === "tw") return "Twi";
  if (language === "ee") return "Ewe";
  if (language === "gaa") return "Ga";
  return "English";
}
