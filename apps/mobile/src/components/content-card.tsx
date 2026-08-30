import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { AppIcon } from "@/components/app-icon";
import { EditorialImage } from "@/components/editorial-image";
import { colors, displayText, radius } from "@/components/mobile-design";
import type { ReadingDocument } from "@/types";

type ContentCardProps = {
  document: ReadingDocument;
  onPlay?: (document: ReadingDocument) => void;
  onDelete?: (document: ReadingDocument) => void;
  deleteLabel?: string;
  showStudyAction?: boolean;
  compact?: boolean;
};

export function ContentCard({ document, onPlay, onDelete, deleteLabel = "Delete", showStudyAction = false, compact = false }: ContentCardProps) {
  const updated = document.lastReadAt ?? document.updatedAt;
  const remainingSeconds = secondsRemaining(document);

  if (compact) {
    return (
      <Link href={{ pathname: "/document/[id]", params: { id: document.id } }} asChild>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${document.title}`} style={{ minHeight: 118, flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <EditorialImage document={document} style={{ width: 112, height: 104, borderRadius: radius.lg }} />
          <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
            <Text selectable numberOfLines={2} style={{ color: colors.ink, fontSize: 17, lineHeight: 21, fontWeight: "700", ...displayText }}>{document.title}</Text>
            <Text selectable numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>{document.sourceLabel ?? document.sourceType} · {progressSummary(document.progress.percent, remainingSeconds)}</Text>
            <ProgressBar percent={document.progress.percent} />
          </View>
          <AppIcon name="chevron.right" size={20} color={colors.muted} />
        </Pressable>
      </Link>
    );
  }

  return (
    <View style={{ gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <EditorialImage document={document} style={{ width: 104, height: 88, borderRadius: radius.md }} />
        <View style={{ flex: 1, gap: 9 }}>
          <View style={{ gap: 5 }}>
            <Text selectable numberOfLines={2} style={{ fontSize: 18, lineHeight: 23, fontWeight: "800", color: colors.ink }}>
              {document.title}
            </Text>
            <Text selectable numberOfLines={1} style={{ color: colors.muted, fontSize: 12, fontWeight: "600" }}>
              {document.sourceLabel ?? document.sourceType} · {new Date(updated).toLocaleDateString()}
              {document.pageCount ? ` · ${document.pageCount} pages` : ""}
            </Text>
          </View>
          <ProgressBar percent={document.progress.percent} />
          <Text selectable numberOfLines={1} style={{ color: colors.faint, fontSize: 12 }}>
            {progressSummary(document.progress.percent, remainingSeconds)} · {voiceLabel(document.voice)} · {document.speed}x
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable onPress={() => onPlay?.(document)} style={{ flex: 1, minHeight: 44, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.player }}>
          <AppIcon name="play.fill" size={14} color="#ffffff" />
          <Text style={{ color: "#ffffff", fontSize: 13, fontWeight: "700" }}>{playActionLabel(document.progress.percent)}</Text>
        </Pressable>
        <Link href={{ pathname: "/document/[id]", params: { id: document.id } }} asChild>
          <Pressable style={{ minWidth: 82, minHeight: 40, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.bgAlt }}>
              <AppIcon name="chevron.right" size={17} color={colors.text} />
          </Pressable>
        </Link>
        {showStudyAction ? (
          <Link href={{ pathname: "/document/[id]", params: { id: document.id } }} asChild>
            <Pressable style={{ minWidth: 76, minHeight: 40, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.blueSoft }}>
              <AppIcon name="graduationcap" size={18} color={colors.blue} />
            </Pressable>
          </Link>
        ) : null}
        {onDelete ? (
          <Pressable onPress={() => onDelete(document)} accessibilityLabel={deleteLabel} style={{ minWidth: 68, minHeight: 40, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.bgAlt }}>
            <AppIcon name="ellipsis" size={18} color={colors.text} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function ProgressBar({ percent }: { percent: number }) {
  return (
    <View style={{ height: 3, borderRadius: 2, backgroundColor: colors.surfaceSoft, overflow: "hidden" }}>
      <View style={{ width: `${Math.min(100, Math.max(0, percent))}%`, height: "100%", borderRadius: 2, backgroundColor: colors.blue }} />
    </View>
  );
}

export function estimateListeningSeconds(document: ReadingDocument): number {
  if (document.estimatedListeningSeconds) return document.estimatedListeningSeconds;
  const words = document.blocks.reduce((count, block) => count + block.text.trim().split(/\s+/).filter(Boolean).length, 0);
  return Math.max(30, Math.round((words / 160) * 60 / Math.max(0.5, document.speed)));
}

function secondsRemaining(document: ReadingDocument): number {
  const total = estimateListeningSeconds(document);
  return Math.max(0, Math.round(total * (1 - document.progress.percent / 100)));
}

function playActionLabel(percent: number): string {
  if (percent >= 100) return "Replay";
  return percent > 0 ? "Resume" : "Play";
}

function progressSummary(percent: number, remainingSeconds: number): string {
  if (percent >= 100) return "Completed";
  return `${percent}% complete · ${formatDuration(remainingSeconds)} left`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, seconds)}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

function voiceLabel(voice: string): string {
  return voice.replace(/^en-US-/, "").replace(/-/g, " ");
}
