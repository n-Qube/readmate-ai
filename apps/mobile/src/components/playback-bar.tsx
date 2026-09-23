import * as Haptics from "expo-haptics";
import { documentBlockCount } from "@/utils/document-blocks";
import { estimateListeningSeconds } from "@/components/content-card";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Alert, Platform, Pressable, Text, View, type TextStyle } from "react-native";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import { EditorialImage } from "@/components/editorial-image";
import { colors, displayText, radius } from "@/components/mobile-design";
import {
  AI_AUDIO_DISCLOSURE_ACCESSIBILITY_LABEL,
  AI_AUDIO_DISCLOSURE_DETAIL,
  AI_AUDIO_DISCLOSURE_TITLE,
  compactAiAudioDisclosure,
  shouldShowAiAudioDisclosure
} from "@/playback/ai-audio-disclosure";
import { usePlaybackManager, type PlaybackState } from "@/playback/playback-manager";
import type { ReadingDocument, UserSettings } from "@/types";
import { screenshotMode } from "@/utils/screenshot-mode";
import { voiceForPlayerLanguage } from "@/webmcp/player-deep-link";

type PlaybackBarProps = {
  document?: ReadingDocument;
  queue?: ReadingDocument[];
  autoPlayKey?: number;
  onActiveBlockChange?: (blockIndex: number) => void;
  onDocumentChange?: (document: ReadingDocument) => void;
  settings?: Omit<UserSettings, "userId" | "updatedAt">;
  onSettingsChange?: (settings: Omit<UserSettings, "userId" | "updatedAt">) => void;
  settingsSaving?: boolean;
  playbackDisabled?: boolean;
  variant?: "featured" | "compact" | "expanded";
};

const languageOptions: Array<{ code: UserSettings["targetLanguage"]; label: string; icon: AppIconName }> = [
  { code: "en", label: "English", icon: "globe" },
  { code: "tw", label: "Twi", icon: "quote.bubble" },
  { code: "ee", label: "Ewe", icon: "waveform" },
  { code: "gaa", label: "Ga", icon: "star.fill" }
];

export function PlaybackBar({
  document,
  queue = [],
  autoPlayKey = 0,
  onActiveBlockChange,
  onDocumentChange,
  settings,
  onSettingsChange,
  settingsSaving = false,
  playbackDisabled = false,
  variant = "featured"
}: PlaybackBarProps) {
  const router = useRouter();
  const playback = usePlaybackManager();
  // PlaybackManager owns the single global selection. A screen-provided
  // document is only the fallback before anything has been opened globally.
  const activeDocument = playback.activeDocument ?? document;
  const isActiveDocument = Boolean(activeDocument && playback.activeDocument?.id === activeDocument.id);
  const activeDocumentId = activeDocument?.id ?? document?.id;
  const queueIndex = queue.findIndex((item) => item.id === activeDocumentId);
  const previousDocument = queueIndex > 0 ? queue[queueIndex - 1] : undefined;
  const nextDocument = queueIndex >= 0 && queueIndex < queue.length - 1 ? queue[queueIndex + 1] : undefined;
  const activeBlockIndex = isActiveDocument ? playback.activeBlockIndex : normalizedBlockIndex(document);
  const blockCount = documentBlockCount(activeDocument);
  const playbackBlocked = playbackDisabled || settingsSaving;
  const canPlay = blockCount > 0 && !playbackBlocked;
  const currentState = isActiveDocument ? playback.state : "ready";
  const percent = isActiveDocument ? playback.percent : document?.progress.percent ?? playback.percent;
  const totalDuration = isActiveDocument ? playback.duration : estimateDuration(activeDocument);
  const currentTime = isActiveDocument ? playback.currentTime : Math.round(totalDuration * (percent / 100));
  const remaining = Math.max(0, totalDuration - currentTime);
  const clampedPercent = Math.max(0, Math.min(100, percent));
  const isCompleted = clampedPercent >= 100 && !["playing", "loading", "buffering"].includes(currentState);
  const showAiAudioDisclosure = shouldShowAiAudioDisclosure(variant, Boolean(activeDocument));
  const outputRouteLabel = playback.outputState.connected
    ? playback.outputState.deviceName ?? (playback.outputState.platform === "chromecast" ? "Chromecast" : "AirPlay")
    : Platform.OS === "android" ? "Chromecast" : "AirPlay";

  useEffect(() => {
    if (isActiveDocument) onActiveBlockChange?.(playback.activeBlockIndex);
  }, [isActiveDocument, playback.activeBlockIndex, onActiveBlockChange]);

  useEffect(() => {
    if (!activeDocument || autoPlayKey === 0 || playbackBlocked) return;
    void playback.playDocument(activeDocument);
  }, [autoPlayKey, activeDocument?.id, playbackBlocked]);

  function toggle() {
    if (!activeDocument || playbackBlocked) return;
    void tactile("medium");
    if (isCompleted) void playback.playDocument(activeDocument, 0);
    else void playback.toggleDocument(activeDocument);
  }

  function jumpToDocument(next: ReadingDocument | undefined) {
    if (!next || playbackBlocked) return;
    onDocumentChange?.(next);
    void playback.playDocument(next);
  }

  function changeLanguage(targetLanguage: UserSettings["targetLanguage"]) {
    if (playbackBlocked || !settings || !onSettingsChange || targetLanguage === settings.targetLanguage) return;
    void tactile("light");
    const voice = voiceForPlayerLanguage(settings.provider, settings.voice, targetLanguage);
    onSettingsChange({ ...settings, targetLanguage, voice });
  }

  function openPlayer() {
    router.push({ pathname: "/player", params: activeDocument?.id ? { documentId: activeDocument.id } : {} });
  }

  function chooseOutput() {
    if (!activeDocument || playbackBlocked) return;
    void tactile("light");
    void playback.showOutputPicker(activeDocument).catch((caught) => {
      Alert.alert("Could not connect", caught instanceof Error ? caught.message : "ReadMate could not open the output picker.");
    });
  }

  function chooseSpeed() {
    if (!settings || !onSettingsChange) return;
    const options = [0.75, 1, 1.25, 1.5, 2];
    Alert.alert("Playback speed", "Choose how fast ReadMate should read.", [
      ...options.map((speed) => ({ text: `${speed}×${speed === settings.speed ? " · Current" : ""}`, onPress: () => onSettingsChange({ ...settings, speed }) })),
      { text: "Cancel", style: "cancel" }
    ]);
  }

  function chooseSection() {
    if (playbackBlocked || !activeDocument?.blocks.length || !isActiveDocument) return;
    const sections = activeDocument.blocks.slice(0, 12);
    Alert.alert("Jump to section", "Choose a section to continue from.", [
      ...sections.map((block, index) => ({ text: `${index + 1}. ${shortSectionTitle(block.text)}`, onPress: () => void playback.skipToBlock(index) })),
      { text: "Cancel", style: "cancel" }
    ]);
  }

  if (variant === "compact") {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: radius.xl, borderCurve: "continuous", backgroundColor: colors.player, boxShadow: "0 16px 34px -24px rgba(18,38,28,0.82)" }}>
        <Pressable accessibilityRole="button" accessibilityLabel={showAiAudioDisclosure ? `Open full player. ${AI_AUDIO_DISCLOSURE_ACCESSIBILITY_LABEL}` : "Open full player"} onPress={openPlayer} style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <EditorialImage document={activeDocument} style={{ width: 62, height: 62, borderRadius: radius.md }} />
          <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
            <Text
              selectable
              accessibilityLabel={showAiAudioDisclosure ? `${AI_AUDIO_DISCLOSURE_ACCESSIBILITY_LABEL} ${isCompleted ? "Completed" : stateLabel(currentState)}.` : undefined}
              numberOfLines={1}
              style={{ color: "#d9c2c6", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}
            >
              {showAiAudioDisclosure
                ? compactAiAudioDisclosure(isCompleted ? "Completed" : stateLabel(currentState))
                : isCompleted ? "Completed" : stateLabel(currentState)}
            </Text>
            <Text selectable numberOfLines={2} style={{ color: "#fffdf8", fontSize: 15, lineHeight: 18, fontWeight: "700", ...displayText }}>{activeDocument?.title ?? "Choose something to read"}</Text>
            <Progress percent={clampedPercent} dark />
          </View>
        </Pressable>
        <Pressable
          disabled={!canPlay || ["loading", "buffering"].includes(currentState)}
          accessibilityRole="button"
          accessibilityLabel={isCompleted ? "Replay" : playButtonLabel(currentState)}
          onPress={toggle}
          style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: "#fffdf8" }}
        >
          <AppIcon name={playIcon(currentState, isCompleted)} size={20} color={colors.player} weight="bold" />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Open full player" onPress={openPlayer} style={{ width: 28, height: 48, alignItems: "center", justifyContent: "center" }}>
          <AppIcon name="chevron.right" size={18} color="#d5ddd6" />
        </Pressable>
      </View>
    );
  }

  if (variant === "featured") {
    const targetLanguage = settings?.targetLanguage ?? "en";
    const activeLanguage = languageOptions.find((language) => language.code === targetLanguage) ?? languageOptions[0];
    const statusText = featuredStatusLabel(currentState, activeLanguage.label, settingsSaving, playback.outputState.connected, playback.outputState.deviceName);
    return (
      <View style={{ gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open full player"
          onPress={openPlayer}
          style={{ height: 266, overflow: "hidden", borderRadius: radius.xxl, borderCurve: "continuous", backgroundColor: colors.player }}
        >
          <EditorialImage
            document={activeDocument}
            style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, width: "100%", height: "100%" }}
          />
          <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(9,13,10,0.58)" }} />
          <View style={{ flex: 1, justifyContent: "space-between", padding: 20 }}>
            <View style={{ alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.claret }}>
              <Text selectable numberOfLines={1} style={{ color: "#fffdf8", fontSize: 11, lineHeight: 14, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" }}>
                {activeDocument?.category || activeDocument?.sourceType || "Saved reading"}
              </Text>
            </View>
            <View style={{ width: "90%", gap: 10 }}>
              <Text selectable numberOfLines={4} style={{ color: "#fffdf8", fontSize: 31, lineHeight: 34, fontWeight: "700", ...displayText }}>
                {activeDocument?.title ?? "Choose something to read"}
              </Text>
              <Text selectable numberOfLines={2} style={{ color: "rgba(255,253,248,0.88)", fontSize: 14, lineHeight: 20 }}>
                {activeDocument?.description ?? `Listen to this saved reading from ${activeDocument?.sourceLabel ?? "your library"}.`}
              </Text>
            </View>
          </View>
        </Pressable>

        {settings && onSettingsChange ? (
          <View style={{ flexDirection: "row", gap: 4, padding: 4, borderRadius: radius.xl, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, boxShadow: "0 12px 30px -26px rgba(33,35,30,0.72)" }}>
            {languageOptions.map((language) => {
              const selected = settings.targetLanguage === language.code;
              return (
                <Pressable
                  key={language.code}
                  disabled={playbackBlocked}
                  accessibilityRole="button"
                  accessibilityLabel={`Listen in ${language.label}`}
                  accessibilityState={{ selected, disabled: playbackBlocked }}
                  onPress={() => changeLanguage(language.code)}
                  style={({ pressed }) => ({
                    flex: 1,
                    minHeight: 54,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 3,
                    borderRadius: radius.lg,
                    backgroundColor: selected ? colors.player : pressed ? colors.surfaceSoft : "transparent",
                    opacity: playbackBlocked ? 0.55 : 1
                  })}
                >
                  <AppIcon name={language.icon} size={18} color={selected ? "#fffdf8" : colors.player} weight={selected ? "bold" : "regular"} />
                  <Text style={{ color: selected ? "#fffdf8" : colors.player, fontSize: 11, fontWeight: selected ? "900" : "700" }}>{language.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {showAiAudioDisclosure ? <AiAudioDisclosure tone="light" /> : null}

        <View style={{ gap: 5, paddingHorizontal: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 }}>
            <AppIcon
              name={currentState === "error" ? "exclamationmark.triangle" : playback.outputState.connected ? "airplayaudio" : "checkmark.circle.fill"}
              size={20}
              color={currentState === "error" ? colors.red : colors.green}
            />
            <Text selectable numberOfLines={1} style={{ flexShrink: 1, color: colors.player, fontSize: 15, lineHeight: 19, fontWeight: "800" }}>
              {statusText}
            </Text>
            <Pressable disabled={playbackBlocked} accessibilityRole="button" accessibilityLabel={`Choose ${outputRouteLabel} output`} accessibilityState={{ disabled: playbackBlocked }} onPress={chooseOutput} style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.surfaceSoft, opacity: playbackBlocked ? 0.45 : 1 }}>
              <AppIcon name="airplayaudio" size={17} color={playback.outputState.connected ? colors.green : colors.player} />
            </Pressable>
          </View>

          <Progress percent={clampedPercent} dark={false} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text selectable style={{ color: colors.muted, fontSize: 11, fontVariant: ["tabular-nums"] }}>{formatTime(currentTime)}</Text>
            <Text selectable style={{ color: colors.muted, fontSize: 11, fontVariant: ["tabular-nums"] }}>{formatTime(totalDuration)}</Text>
          </View>

          <View style={{ alignItems: "center" }}>
            <Pressable
              disabled={!canPlay || ["loading", "buffering"].includes(currentState)}
              accessibilityRole="button"
              accessibilityLabel={isCompleted ? "Replay" : playButtonLabel(currentState)}
              onPress={toggle}
              style={({ pressed }) => ({
                width: 62,
                height: 62,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.pill,
                backgroundColor: colors.player,
                opacity: !canPlay || ["loading", "buffering"].includes(currentState) ? 0.55 : pressed ? 0.86 : 1,
                boxShadow: "0 16px 34px -20px rgba(31,42,36,0.8)"
              })}
            >
              <AppIcon name={playIcon(currentState, isCompleted)} size={26} color="#fffdf8" weight="bold" />
            </Pressable>
          </View>
        </View>

        {!screenshotMode && playback.error && isActiveDocument ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: colors.redSoft }}>
            <Text selectable style={{ flex: 1, color: colors.red, fontSize: 13, lineHeight: 18 }}>{playback.error}</Text>
            <Pressable disabled={playbackBlocked} accessibilityLabel="Retry playback" onPress={toggle} style={{ minHeight: 38, justifyContent: "center", paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.claret, opacity: playbackBlocked ? 0.45 : 1 }}>
              <Text style={{ color: "#fffdf8", fontWeight: "800" }}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ gap: 16, padding: 16, borderRadius: radius.xxl, borderCurve: "continuous", backgroundColor: colors.player, boxShadow: "0 20px 42px -30px rgba(18,38,28,0.82)" }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Open full player" onPress={openPlayer} style={{ flexDirection: "row", gap: 14 }}>
        <EditorialImage document={activeDocument} style={{ width: 106, height: 106, borderRadius: radius.lg }} />
        <View style={{ flex: 1, justifyContent: "space-between", paddingVertical: 2 }}>
          <View style={{ gap: 5 }}>
            <Text selectable style={{ color: "#d9c2c6", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>{isCompleted ? "Completed" : stateLabel(currentState)}</Text>
            <Text selectable numberOfLines={3} style={{ color: "#fffdf8", fontSize: 20, lineHeight: 25, fontWeight: "700", ...displayText }}>{activeDocument?.title ?? "Choose something to read"}</Text>
          </View>
          <View style={{ gap: 5 }}>
            <Text selectable numberOfLines={1} style={{ color: "#afbbb2", fontSize: 12 }}>{activeDocument?.sourceLabel ?? "ReadMate"} · {formatDuration(remaining)} left</Text>
            <Progress percent={clampedPercent} dark />
          </View>
        </View>
      </Pressable>

      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text selectable style={timeStyle}>{formatTime(currentTime)}</Text>
        <Text selectable style={timeStyle}>-{formatTime(remaining)}</Text>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-around", gap: 8 }}>
        <PlayerButton label="Back 10 seconds" icon="arrow.counterclockwise" disabled={!isActiveDocument || playbackBlocked} onPress={() => void playback.seekBy(-10)} />
        <Pressable
          disabled={!canPlay || ["loading", "buffering"].includes(currentState)}
          accessibilityLabel={isCompleted ? "Replay" : playButtonLabel(currentState)}
          onPress={toggle}
          style={{ width: 66, height: 66, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: "#fffdf8", opacity: !canPlay || ["loading", "buffering"].includes(currentState) ? 0.55 : 1, boxShadow: "0 12px 28px -16px rgba(0,0,0,0.8)" }}
        >
          <AppIcon name={playIcon(currentState, isCompleted)} size={28} color={colors.player} weight="bold" />
        </Pressable>
        <PlayerButton label="Forward 10 seconds" icon="arrow.clockwise" disabled={!isActiveDocument || playbackBlocked} onPress={() => void playback.seekBy(10)} />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <PlayerUtility label="Previous section" icon="backward.end.fill" disabled={playbackBlocked || !isActiveDocument || activeBlockIndex <= 0} onPress={() => void playback.skipToBlock(activeBlockIndex - 1)} />
        <PlayerUtility label={`Section ${Math.min(blockCount, activeBlockIndex + 1)} of ${blockCount}`} icon="list.bullet" disabled={playbackBlocked || !isActiveDocument || !blockCount} onPress={chooseSection} />
        <PlayerUtility label={`${settings?.speed ?? activeDocument?.speed ?? 1}×`} icon="waveform" disabled={playbackBlocked || !settings || !onSettingsChange} onPress={chooseSpeed} />
        <PlayerUtility label={outputRouteLabel} icon="airplayaudio" disabled={playbackBlocked} onPress={chooseOutput} />
      </View>

      {showAiAudioDisclosure ? <AiAudioDisclosure /> : null}

      {playback.outputState.connected ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.08)" }}>
          <AppIcon name="airplayaudio" size={18} color="#d8eadc" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text selectable numberOfLines={1} style={{ color: "#fffdf8", fontSize: 12, fontWeight: "800" }}>
              Playing on {playback.outputState.deviceName ?? "connected device"}
            </Text>
            <Text selectable numberOfLines={2} style={{ color: "#afbbb2", fontSize: 10, lineHeight: 14 }}>
              {playback.outputState.isScreen ? "Cover artwork and article details are shown on the connected screen." : "Audio is playing through the connected speaker."}
            </Text>
          </View>
        </View>
      ) : null}

      {settings && onSettingsChange ? (
        <View style={{ gap: 9, paddingTop: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <Text selectable style={{ color: "#cbd4cc", fontSize: 12, fontWeight: "700" }}>{settingsSaving ? "Translating audio…" : "Listen in"}</Text>
            {settingsSaving ? <AppIcon name="waveform" size={16} color="#d8eadc" /> : null}
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {languageOptions.map((language) => {
              const selected = settings.targetLanguage === language.code;
              return (
                <Pressable
                  key={language.code}
                  disabled={playbackBlocked}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: playbackBlocked }}
                  onPress={() => changeLanguage(language.code)}
                  style={{ flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: selected ? "#fffdf8" : "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: selected ? "#fffdf8" : "rgba(255,255,255,0.10)", opacity: playbackBlocked ? 0.55 : 1 }}
                >
                  <Text style={{ color: selected ? colors.player : "#d5ddd6", fontSize: 12, fontWeight: "800" }}>{language.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {!screenshotMode && playback.error && isActiveDocument ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: "rgba(173,81,77,0.18)" }}>
          <Text selectable style={{ flex: 1, color: "#ffd6d2", fontSize: 13, lineHeight: 18 }}>{playback.error}</Text>
          <Pressable disabled={playbackBlocked} accessibilityLabel="Retry playback" onPress={toggle} style={{ minHeight: 38, justifyContent: "center", paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.12)", opacity: playbackBlocked ? 0.45 : 1 }}>
            <Text style={{ color: "#fffdf8", fontWeight: "800" }}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {queue.length > 1 ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <QueueButton label="Previous article" disabled={playbackBlocked || !previousDocument} onPress={() => jumpToDocument(previousDocument)} icon="chevron.left" />
          <Text selectable style={{ color: "#aeb9ad", fontSize: 11, fontWeight: "700" }}>Queue {queueIndex >= 0 ? queueIndex + 1 : 1} of {queue.length}</Text>
          <QueueButton label="Next article" disabled={playbackBlocked || !nextDocument} onPress={() => jumpToDocument(nextDocument)} icon="chevron.right" />
        </View>
      ) : null}
    </View>
  );
}

function AiAudioDisclosure({ tone = "dark" }: { tone?: "light" | "dark" }) {
  const light = tone === "light";
  return (
    <View
      accessible
      accessibilityLabel={AI_AUDIO_DISCLOSURE_ACCESSIBILITY_LABEL}
      accessibilityRole="text"
      style={{ flexDirection: "row", alignItems: "flex-start", gap: 9, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md, backgroundColor: light ? colors.purpleSoft : "rgba(255,255,255,0.08)" }}
    >
      <AppIcon name="sparkles" size={18} color={light ? colors.purple : "#d8eadc"} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text selectable style={{ color: light ? colors.ink : "#fffdf8", fontSize: 12, fontWeight: "800" }}>{AI_AUDIO_DISCLOSURE_TITLE}</Text>
        <Text selectable style={{ color: light ? colors.muted : "#afbbb2", fontSize: 10, lineHeight: 14 }}>{AI_AUDIO_DISCLOSURE_DETAIL}</Text>
      </View>
    </View>
  );
}

function FeaturedControl({ label, icon, disabled, onPress }: { label: string; icon: AppIconName; disabled?: boolean; onPress?: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={!onPress || disabled} onPress={onPress} style={{ minWidth: 42, minHeight: 52, alignItems: "center", justifyContent: "center", gap: 3, opacity: disabled ? 0.35 : 1 }}>
      <AppIcon name={icon} size={21} color={colors.blue} />
      {label.includes("×") ? <Text selectable style={{ color: colors.blue, fontSize: 10, fontWeight: "800" }}>{label}</Text> : null}
    </Pressable>
  );
}

function Progress({ percent, dark }: { percent: number; dark: boolean }) {
  return (
    <View style={{ height: 4, overflow: "hidden", borderRadius: 999, backgroundColor: dark ? "rgba(255,253,248,0.16)" : colors.surfaceSoft }}>
      <View style={{ width: `${percent}%`, height: "100%", borderRadius: 999, backgroundColor: dark ? "#d8eadc" : colors.green }} />
    </View>
  );
}

function PlayerButton({ label, icon, disabled, onPress }: { label: string; icon: AppIconName; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={() => { void tactile("light"); onPress(); }} style={{ width: 52, height: 52, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.08)", opacity: disabled ? 0.35 : 1 }}>
      <AppIcon name={icon} size={25} color="#fffdf8" weight="semibold" />
    </Pressable>
  );
}

function PlayerUtility({ label, icon, disabled, onPress }: { label: string; icon: AppIconName; disabled?: boolean; onPress?: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={!onPress || disabled} onPress={onPress} style={{ minWidth: 48, minHeight: 44, gap: 4, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.35 : 1 }}>
      <AppIcon name={icon} size={19} color="#d5ddd6" />
      <Text numberOfLines={1} style={{ color: "#afbbb2", fontSize: 9, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

function QueueButton({ label, disabled, onPress, icon }: { label: string; disabled?: boolean; onPress: () => void; icon: AppIconName }) {
  return (
    <Pressable accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.08)", opacity: disabled ? 0.35 : 1 }}>
      <AppIcon name={icon} size={18} color="#fffdf8" />
    </Pressable>
  );
}

const timeStyle: TextStyle = { color: "#aeb9ad", fontSize: 11, fontVariant: ["tabular-nums"] };

function normalizedBlockIndex(document?: ReadingDocument): number {
  if (!document?.blocks.length) return 0;
  return Math.min(document.blocks.length - 1, Math.max(0, document.progress.blockIndex));
}

function playButtonLabel(state: PlaybackState): string {
  if (state === "loading" || state === "buffering") return "Loading";
  if (state === "playing") return "Pause";
  return "Play";
}

function playIcon(state: PlaybackState, completed: boolean): AppIconName {
  if (completed) return "arrow.counterclockwise";
  if (state === "playing") return "pause.fill";
  return "play.fill";
}

function stateLabel(state: PlaybackState): string {
  if (state === "loading") return "Preparing audio";
  if (state === "buffering") return "Translating and buffering";
  if (state === "playing") return "Continue listening";
  if (state === "paused") return "Paused";
  if (state === "completed") return "Completed";
  if (state === "error") return "Playback needs attention";
  return "Continue listening";
}

function featuredStatusLabel(
  state: PlaybackState,
  language: string,
  saving: boolean,
  connected: boolean,
  deviceName?: string
): string {
  if (connected) return `Playing on ${deviceName || "connected device"}.`;
  if (saving || state === "loading" || state === "buffering") return `Preparing ${language} audio…`;
  if (state === "playing") return `${language} audio playing.`;
  if (state === "paused") return `${language} audio paused.`;
  if (state === "completed") return `${language} reading finished.`;
  if (state === "error") return `${language} audio needs attention.`;
  return `${language} audio ready.`;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sec`;
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function estimateDuration(document?: ReadingDocument): number {
  return document ? estimateListeningSeconds(document) : 0;
}

function shortSectionTitle(value: string): string {
  const title = value.replace(/\s+/g, " ").trim();
  return title.length > 42 ? `${title.slice(0, 41)}…` : title || "Untitled section";
}

async function tactile(weight: "light" | "medium") {
  if (process.env.EXPO_OS !== "ios") return;
  await Haptics.impactAsync(weight === "medium" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}
