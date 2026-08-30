import { HStack, Image, ProgressView, Text, VStack } from "@expo/ui/swift-ui";
import { font, foregroundStyle, lineLimit, padding } from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";

export type ReadMatePlaybackActivityProps = {
  title: string;
  subtitle: string;
  status: "loading" | "playing" | "paused" | "buffering" | "ready" | "completed";
  percent: number;
  blockLabel: string;
  remainingLabel: string;
  languageLabel: string;
  disclosureLabel: string;
};

const activityName = "ReadMatePlaybackActivity";

function ReadMatePlaybackActivity(props: ReadMatePlaybackActivityProps, environment: LiveActivityEnvironment) {
  "widget";
  const isDark = environment.colorScheme === "dark";
  const primary = isDark ? "#ffffff" : "#111827";
  const secondary = isDark ? "#cbd5e1" : "#475569";
  const accent = "#3868f6";
  const symbol = props.status === "playing" ? "waveform" : props.status === "paused" ? "pause.fill" : "book.fill";
  const statusLabel = statusText(props.status);

  return {
    banner: (
      <VStack alignment="leading" spacing={8} modifiers={[padding({ all: 14 })]}>
        <HStack spacing={8} alignment="center">
          <Image systemName={symbol} color={accent} size={20} />
          <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle(accent), lineLimit(1)]}>
            {statusLabel}
          </Text>
          <Text modifiers={[font({ size: 12, weight: "medium" }), foregroundStyle(secondary), lineLimit(1)]}>
            {props.languageLabel}
          </Text>
        </HStack>
        <Text modifiers={[font({ size: 17, weight: "bold" }), foregroundStyle(primary), lineLimit(2)]}>
          {props.title}
        </Text>
        <Text modifiers={[font({ size: 12, weight: "medium" }), foregroundStyle(secondary), lineLimit(1)]}>
          {props.subtitle}
        </Text>
        <Text modifiers={[font({ size: 11, weight: "semibold" }), foregroundStyle(accent), lineLimit(1)]}>
          {props.disclosureLabel}
        </Text>
        <ProgressView value={boundedProgress(props.percent)} />
        <HStack spacing={8} alignment="center">
          <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(secondary), lineLimit(1)]}>
            {props.blockLabel}
          </Text>
          <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(secondary), lineLimit(1)]}>
            {props.remainingLabel}
          </Text>
        </HStack>
      </VStack>
    ),
    compactLeading: <Image systemName={symbol} color={accent} size={18} />,
    compactTrailing: <Text modifiers={[font({ size: 12, weight: "bold" }), foregroundStyle(primary)]}>{Math.round(props.percent)}%</Text>,
    minimal: <Image systemName="book.fill" color={accent} size={16} />,
    expandedLeading: (
      <VStack alignment="leading" spacing={4} modifiers={[padding({ all: 10 })]}>
        <Image systemName={symbol} color={accent} size={20} />
        <Text modifiers={[font({ size: 11, weight: "semibold" }), foregroundStyle(secondary), lineLimit(1)]}>{statusLabel}</Text>
      </VStack>
    ),
    expandedTrailing: (
      <VStack alignment="trailing" spacing={4} modifiers={[padding({ all: 10 })]}>
        <Text modifiers={[font({ size: 20, weight: "bold" }), foregroundStyle(primary)]}>{Math.round(props.percent)}%</Text>
        <Text modifiers={[font({ size: 11, weight: "semibold" }), foregroundStyle(secondary), lineLimit(1)]}>{props.remainingLabel}</Text>
      </VStack>
    ),
    expandedBottom: (
      <VStack alignment="leading" spacing={6} modifiers={[padding({ all: 10 })]}>
        <Text modifiers={[font({ size: 14, weight: "bold" }), foregroundStyle(primary), lineLimit(2)]}>{props.title}</Text>
        <ProgressView value={boundedProgress(props.percent)} />
        <Text modifiers={[font({ size: 11, weight: "medium" }), foregroundStyle(secondary), lineLimit(1)]}>
          {props.blockLabel} · {props.languageLabel}
        </Text>
        <Text modifiers={[font({ size: 11, weight: "semibold" }), foregroundStyle(accent), lineLimit(1)]}>
          {props.disclosureLabel}
        </Text>
      </VStack>
    )
  };
}

function boundedProgress(percent: number) {
  return Math.min(1, Math.max(0, percent / 100));
}

function statusText(status: ReadMatePlaybackActivityProps["status"]) {
  if (status === "playing") return "Reading aloud";
  if (status === "paused") return "Paused";
  if (status === "buffering") return "Loading next section";
  if (status === "completed") return "Completed";
  if (status === "loading") return "Preparing audio";
  return "Ready";
}

export default createLiveActivity<ReadMatePlaybackActivityProps>(activityName, ReadMatePlaybackActivity);
