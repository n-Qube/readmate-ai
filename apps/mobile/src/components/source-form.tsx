import { Pressable, Text, TextInput, View } from "react-native";
import { AppIcon } from "@/components/app-icon";
import { SectionCard, colors, radius } from "@/components/mobile-design";
import type { SourceSuggestion } from "@/utils/source-suggestions";

type SourceFormProps = {
  query: string;
  suggestions: SourceSuggestion[];
  selectedSuggestion: SourceSuggestion | null;
  busy: boolean;
  error: string | null;
  notice: string | null;
  noticeActionLabel?: string;
  uploadLimitLabel: string;
  showPremiumUpgrade: boolean;
  setQuery: (value: string) => void;
  onSelectSuggestion: (suggestion: SourceSuggestion) => void;
  onAddUrl: () => void;
  onAddRss: () => void;
  onUploadDocument: () => void;
  onNoticeAction?: () => void;
  onPremiumUpgrade: () => void;
};

export function SourceForm(props: SourceFormProps) {
  return (
    <SectionCard elevated>
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.lg, backgroundColor: colors.greenSoft }}>
            <AppIcon name="globe" size={20} color={colors.player} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text selectable style={{ color: colors.ink, fontSize: 16, fontWeight: "800" }}>Web page or RSS feed</Text>
            <Text selectable style={{ color: colors.muted, fontSize: 12, lineHeight: 17 }}>Paste a page to save once, or subscribe to its feed.</Text>
          </View>
        </View>
        <View style={{ gap: 8, padding: 10, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border }}>
          <TextInput placeholder="Paste a link, RSS feed, or article URL" value={props.query} onChangeText={props.setQuery} autoCapitalize="none" keyboardType="url" style={inputStyle} />
          <Pressable accessibilityRole="button" accessibilityLabel="Save page" disabled={!props.selectedSuggestion || props.busy} onPress={props.onAddUrl} style={{ minHeight: 42, flexDirection: "row", gap: 7, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderCurve: "continuous", backgroundColor: props.selectedSuggestion && !props.busy ? colors.blue : "#9aa8bd" }}>
            <AppIcon name="plus" size={17} color="#ffffff" />
            <Text style={{ color: "#ffffff", fontWeight: "700", fontSize: 13 }}>Save page</Text>
          </Pressable>
        </View>
        {props.suggestions.length ? (
          <View style={{ gap: 8 }}>
            {props.suggestions.slice(0, 3).map((suggestion) => {
              const selected = props.selectedSuggestion?.id === suggestion.id;
              return (
                <Pressable
                  key={suggestion.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${suggestion.name}`}
                  onPress={() => props.onSelectSuggestion(suggestion)}
                  style={{ gap: 2, padding: 12, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: selected ? colors.blue : colors.border, backgroundColor: selected ? colors.blueChip : colors.surfaceSoft }}
                >
                  <Text selectable style={{ color: colors.ink, fontSize: 15, fontWeight: "800" }}>
                    {suggestion.name}
                  </Text>
                  <Text selectable numberOfLines={1} style={{ color: colors.muted, fontSize: 13 }}>
                    {suggestion.url} {suggestion.rssUrl ? `· RSS available` : ""}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {props.selectedSuggestion?.rssUrl ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Subscribe RSS" disabled={!props.selectedSuggestion?.rssUrl || props.busy} onPress={props.onAddRss} style={{ ...buttonStyle(Boolean(props.selectedSuggestion?.rssUrl) && !props.busy), flex: 1, flexDirection: "row", gap: 8 }}>
              <AppIcon name="waveform" size={18} color="#ffffff" />
              <Text style={buttonTextStyle}>Subscribe RSS</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Upload file" disabled={props.busy} onPress={props.onUploadDocument} style={{ ...buttonStyle(!props.busy), flex: 1, flexDirection: "row", gap: 8, backgroundColor: props.busy ? "#9aa8bd" : colors.navy }}>
            <AppIcon name="arrow.down.to.line" size={18} color="#ffffff" />
            <Text style={buttonTextStyle}>Upload file</Text>
          </Pressable>
        </View>
        <Text selectable style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
          Files: PDF, Word, EPUB, plain text, Markdown, and RTF · {props.uploadLimitLabel}.
        </Text>
        {props.showPremiumUpgrade ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Upgrade for larger documents" onPress={props.onPremiumUpgrade} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.greenSoft, borderWidth: 1, borderColor: "rgba(88, 119, 74, 0.22)" }}>
            <AppIcon name="star.fill" size={17} color={colors.green} />
            <Text style={{ color: colors.green, fontSize: 14, fontWeight: "900" }}>Upgrade for larger documents</Text>
          </Pressable>
        ) : null}
      </View>
      {props.notice ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9, padding: 11, borderRadius: radius.md, backgroundColor: colors.greenSoft }}>
          <AppIcon name="checkmark.circle.fill" size={18} color={colors.green} />
          <Text selectable style={{ flex: 1, color: colors.green, fontSize: 13, lineHeight: 19, fontWeight: "700" }}>{props.notice}</Text>
          {props.onNoticeAction && props.noticeActionLabel ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Open uploaded document" onPress={props.onNoticeAction} style={{ minHeight: 36, minWidth: 58, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.green }}>
              <Text style={{ color: "#ffffff", fontSize: 13, fontWeight: "900" }}>{props.noticeActionLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {props.error ? <Text selectable style={{ color: colors.red, lineHeight: 20 }}>{props.error}</Text> : null}
    </SectionCard>
  );
}

const inputStyle = {
  minHeight: 48,
  flex: 1,
  paddingHorizontal: 0,
  color: colors.ink,
  backgroundColor: "transparent"
};

function buttonStyle(enabled: boolean) {
  return {
    minHeight: 48,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: radius.md,
    borderCurve: "continuous" as const,
    backgroundColor: enabled ? colors.blue : "#9aa8bd"
  };
}

const buttonTextStyle = { color: "#ffffff", fontWeight: "900" as const, fontSize: 15 };
