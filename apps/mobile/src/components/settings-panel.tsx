import { Pressable, Text, View } from "react-native";
import type { ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import { SectionCard, colors, radius } from "@/components/mobile-design";
import { defaultVoiceForLanguage, localVoiceLabel, voicesForLanguage, type LocalLanguage } from "@/config/local-voices";
import {
  DEFAULT_VOICE_BY_PROVIDER,
  GEMINI_READING_VOICES,
  GOOGLE_VOICES,
  isGeminiProvider,
  isGeminiVoice,
  isPremiumProvider,
  providerLongLabel,
  TTS_PROVIDERS
} from "@/config/tts-providers";
import { canOfferPremiumUpgrade } from "@/purchases/purchases-availability";
import type { ReadingDocument, UserSettings } from "@/types";

const speeds = [0.75, 1, 1.25, 1.5, 2];
const articleCounts = [5, 10, 15, 20, 25, 50];
const languageOptions = [
  { code: "en", label: "English", provider: "Google or Gemini" },
  { code: "tw", label: "Twi", provider: "Google Translate + GhanaNLP TTS" },
  { code: "ee", label: "Ewe", provider: "Google Translate + Khaya TTS v2" },
  { code: "gaa", label: "Ga", provider: "Khaya Translation + TTS v2" }
] as const;

export type SettingsSection = "language" | "listening" | "reading" | "study" | "sync";

type SettingsPanelProps = {
  settings: Omit<UserSettings, "userId" | "updatedAt">;
  section: SettingsSection;
  saving?: boolean;
  isPremium?: boolean;
  previewingVoice?: string;
  onPreviewVoice?: (language: LocalLanguage, voice: string) => void;
  onPremiumFeaturePress?: () => void;
  onChange: (settings: Omit<UserSettings, "userId" | "updatedAt">) => void;
};

export function SettingsPanel({ settings, section, saving = false, isPremium = false, previewingVoice, onPreviewVoice, onPremiumFeaturePress, onChange }: SettingsPanelProps) {
  const providerVoices: Array<{ id: string; name: string }> = isGeminiProvider(settings.provider)
    ? [
        ...GEMINI_READING_VOICES.map((voice) => ({ id: voice.id, name: `${voice.name} · ${voice.description}` })),
        // Keep a voice chosen on another device selectable even when it is outside the curated list.
        ...(GEMINI_READING_VOICES.some((voice) => voice.id === settings.voice) || !isGeminiVoice(settings.voice)
          ? []
          : [{ id: settings.voice, name: settings.voice }])
      ]
    : GOOGLE_VOICES.map((id) => ({ id, name: voiceShortLabel(id) }));
  const selectedVoice = providerVoices.some((voice) => voice.id === settings.voice)
    ? settings.voice
    : providerVoices[0]?.id ?? settings.voice;
  const voiceOptions = providerVoices.map((voice) => voice.id);
  const voiceLabels = Object.fromEntries(providerVoices.map((voice) => [voice.id, voice.name]));
  return (
    <View style={{ gap: 18 }}>
      {section === "language" ? <LanguageSettings settings={settings} onChange={onChange} /> : null}
      {section === "listening" ? <ListeningSettings settings={settings} voiceOptions={voiceOptions} selectedVoice={selectedVoice} voiceLabels={voiceLabels} isPremium={isPremium} previewingVoice={previewingVoice} onPreviewVoice={onPreviewVoice} onPremiumFeaturePress={onPremiumFeaturePress} onChange={onChange} /> : null}
      {section === "reading" ? <ReadingSettings settings={settings} onChange={onChange} /> : null}
      {section === "study" ? <StudySettings settings={settings} onChange={onChange} /> : null}
      {section === "sync" ? <SyncSettings settings={settings} saving={saving} onChange={onChange} /> : null}
    </View>
  );
}

function LanguageSettings({ settings, onChange }: Pick<SettingsPanelProps, "settings" | "onChange">) {
  return (
    <SettingGroup title="Language">
      <SettingRow icon="globe" tone="blue" label="Reading language" value={languageLabel(settings.targetLanguage)} />
      <SegmentedControl
        label="Translate and listen"
        options={languageOptions.map((language) => language.code)}
        value={settings.targetLanguage}
        onChange={(targetLanguage) => onChange({
          ...settings,
          targetLanguage,
          voice: targetLanguage === "en"
            ? DEFAULT_VOICE_BY_PROVIDER[settings.provider]
            : voicesForLanguage(targetLanguage).some((voice) => voice.id === settings.voice)
              ? settings.voice
              : defaultVoiceForLanguage(targetLanguage)
        })}
        shortLabels={{ en: "English", tw: "Twi", ee: "Ewe", gaa: "Ga" }}
      />
      <Text selectable style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>
        English uses your selected voice provider. Twi, Ewe, and Ga translate first, then play with Khaya TTS v2.
      </Text>
      {settings.targetLanguage !== "en" ? <Text selectable style={{ color: colors.blue, fontSize: 13, lineHeight: 19, fontWeight: "700" }}>Choose and preview a speaker under Voice &amp; playback.</Text> : null}
    </SettingGroup>
  );
}

function ListeningSettings({ settings, voiceOptions, selectedVoice, voiceLabels, isPremium, previewingVoice, onPreviewVoice, onPremiumFeaturePress, onChange }: Pick<SettingsPanelProps, "settings" | "onChange" | "isPremium" | "previewingVoice" | "onPreviewVoice" | "onPremiumFeaturePress"> & { voiceOptions: string[]; selectedVoice: string; voiceLabels: Record<string, string> }) {
  const localVoices = settings.targetLanguage === "en" ? [] : voicesForLanguage(settings.targetLanguage);
  const selectedLocalVoice = settings.targetLanguage === "en"
    ? ""
    : localVoices.some((voice) => voice.id === settings.voice) ? settings.voice : defaultVoiceForLanguage(settings.targetLanguage);
  return (
    <SettingGroup title="Voice & playback">
      <SettingRow icon="waveform" tone="blue" label="TTS provider" value={languageProviderLabel(settings)} />
      {settings.targetLanguage === "en" ? (
        <>
          <SegmentedControl
            label="Reading voice quality"
            // Hide Premium voices from Free accounts when the store cannot sell Premium.
            options={TTS_PROVIDERS.filter((provider) => isPremium || !isPremiumProvider(provider) || canOfferPremiumUpgrade(Boolean(isPremium)))}
            value={settings.provider}
            onChange={(provider) => onChange({ ...settings, provider, voice: DEFAULT_VOICE_BY_PROVIDER[provider] })}
            shortLabels={{
              google: "Google · Standard",
              "gemini-lite": "Gemini Lite · Natural",
              gemini: isPremium ? "Gemini Flash · Premium" : "Gemini Flash · Premium · Locked"
            }}
            disabledOptions={isPremium ? [] : TTS_PROVIDERS.filter(isPremiumProvider)}
            onDisabledPress={onPremiumFeaturePress}
          />
          {canOfferPremiumUpgrade(Boolean(isPremium)) ? <Text selectable style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>Google, Gemini Lite, Twi, Ewe, and Ga are available on Free. Gemini Flash studio-quality voices are a Premium feature.</Text> : null}
          {isGeminiProvider(settings.provider) ? <Text selectable style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>Gemini voices are AI-generated.</Text> : null}
          <SettingRow icon="speaker.wave.2.fill" tone="blue" label="Voice" value={voiceLabels[selectedVoice] ?? voiceShortLabel(selectedVoice)} />
          <SegmentedControl label="Choose voice" options={voiceOptions} value={selectedVoice} onChange={(voice) => onChange({ ...settings, voice })} shortLabels={voiceLabels} />
        </>
      ) : (
        <>
          <Text selectable style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>
            {languageLabel(settings.targetLanguage)} playback uses Khaya. Choose a speaker, then preview it before saving a long listen.
          </Text>
          <SettingRow icon="speaker.wave.2.fill" tone="blue" label="Local voice" value={localVoiceLabel(selectedLocalVoice)} />
          <SegmentedControl
            label="Choose speaker"
            options={localVoices.map((voice) => voice.id)}
            value={selectedLocalVoice}
            onChange={(voice) => onChange({ ...settings, voice })}
            shortLabels={Object.fromEntries(localVoices.map((voice) => [voice.id, voice.label]))}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Preview ${localVoiceLabel(selectedLocalVoice)}`}
            disabled={!onPreviewVoice || previewingVoice === selectedLocalVoice}
            onPress={() => onPreviewVoice?.(settings.targetLanguage as LocalLanguage, selectedLocalVoice)}
            style={{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 14, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.blueChip, opacity: previewingVoice === selectedLocalVoice ? 0.65 : 1 }}
          >
            <AppIcon name={previewingVoice === selectedLocalVoice ? "waveform" : "play.fill"} size={17} color={colors.blue} />
            <Text style={{ color: colors.blue, fontWeight: "800" }}>{previewingVoice === selectedLocalVoice ? "Preparing preview..." : "Preview selected voice"}</Text>
          </Pressable>
        </>
      )}
      <SettingRow icon="waveform" tone="amber" label="Default speed" value={`${settings.speed.toFixed(2).replace(/\\.00$/, "")}x`} />
      <SegmentedControl label="Speed" options={speeds.map(String)} value={String(settings.speed)} onChange={(speed) => onChange({ ...settings, speed: Number(speed) })} />
    </SettingGroup>
  );
}

function ReadingSettings({ settings, onChange }: Pick<SettingsPanelProps, "settings" | "onChange">) {
  return (
    <SettingGroup title="Reading display">
      <SettingRow icon="doc.text" tone="green" label="Auto-scroll while reading" value={settings.autoScroll ? "On" : "Off"} />
      <SegmentedControl label="Auto-scroll" options={["On", "Off"]} value={settings.autoScroll ? "On" : "Off"} onChange={(autoScroll) => onChange({ ...settings, autoScroll: autoScroll === "On" })} />
      <SettingRow icon="textformat" tone="amber" label="Highlight mode" value={settings.highlightMode} />
      <SegmentedControl label="Highlight mode" options={["paragraph", "sentence", "none"] as const} value={settings.highlightMode} onChange={(highlightMode) => onChange({ ...settings, highlightMode })} />
      <Text selectable style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>Tune the reading surface for focus while audio plays.</Text>
    </SettingGroup>
  );
}

function StudySettings({ settings, onChange }: Pick<SettingsPanelProps, "settings" | "onChange">) {
  return (
    <SettingGroup title="AI & study">
      <SettingRow icon="sparkles" tone="purple" label="Auto-generate" value="Summary, highlights" />
      <SettingRow icon="rectangle.stack" tone="blue" label="Flashcard reviews" value="Daily reminder" />
      <SettingRow icon="textformat" tone="green" label="Citations in answers" value="On" />
      <ContentTypeToggles settings={settings} onChange={onChange} section="study" />
    </SettingGroup>
  );
}

function SyncSettings({ settings, saving, onChange }: Pick<SettingsPanelProps, "settings" | "saving" | "onChange">) {
  return (
    <SettingGroup title="Sync & feeds">
      <SettingRow icon="cloud" tone="blue" label="Cloud sync" value="On after sign-in" />
      <SegmentedControl label="Articles per RSS feed" options={articleCounts.map(String)} value={String(settings.articlesPerFeed)} onChange={(articlesPerFeed) => onChange({ ...settings, articlesPerFeed: Number(articlesPerFeed) })} />
      <Text selectable style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>{saving ? "Saving preferences..." : "Chrome and mobile use the same library when you sign in with the same ReadMate account."}</Text>
    </SettingGroup>
  );
}

function ContentTypeToggles({ settings, onChange }: Pick<SettingsPanelProps, "settings" | "onChange"> & { section?: SettingsSection }) {
  const options: ReadingDocument["sourceType"][] = ["webpage", "pdf", "rss", "url", "news", "document"];
  return (
    <View style={{ gap: 8 }}>
      <Text selectable style={groupLabelStyle}>Content types</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((item) => {
          const active = settings.preferredContentTypes.includes(item);
          return (
            <Pressable
              key={item}
              onPress={() => {
                const next = active ? settings.preferredContentTypes.filter((value) => value !== item) : [...settings.preferredContentTypes, item];
                onChange({ ...settings, preferredContentTypes: next.length ? next : [item] });
              }}
              style={{ paddingHorizontal: 12, minHeight: 34, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: active ? colors.blueChip : colors.bgAlt }}
            >
              <Text style={{ color: active ? colors.blue : colors.muted, fontWeight: "700" }}>{item}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function SegmentedControl<T extends string>({ label, options, value, onChange, shortLabels, disabledOptions = [], onDisabledPress }: { label: string; options: T[]; value: T; onChange: (value: T) => void; shortLabels?: Partial<Record<T, string>>; disabledOptions?: T[]; onDisabledPress?: () => void }) {
  return (
    <View style={{ gap: 8 }}>
      <Text selectable style={groupLabelStyle}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((option) => {
          const disabled = disabledOptions.includes(option);
          return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ disabled: disabled && !onDisabledPress, selected: option === value }}
            accessibilityHint={disabled && onDisabledPress ? "Opens ReadMate Premium plans" : undefined}
            onPress={() => disabled ? onDisabledPress?.() : onChange(option)}
            style={{ minHeight: 38, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: option === value && !disabled ? colors.navy : colors.bgAlt, opacity: disabled ? 0.62 : 1 }}
          >
            <Text style={{ color: option === value && !disabled ? "#ffffff" : colors.ink, fontWeight: "700", fontSize: 13 }}>
              {shortLabels?.[option] ?? option}
            </Text>
          </Pressable>
        );})}
      </View>
    </View>
  );
}

function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text selectable style={{ color: colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0, textTransform: "uppercase", paddingHorizontal: 4 }}>
        {title}
      </Text>
      <SectionCard>{children}</SectionCard>
    </View>
  );
}

function SettingRow({ icon, tone, label, value }: { icon: AppIconName; tone: "blue" | "amber" | "green" | "purple"; label: string; value: string }) {
  const palette = {
    blue: { bg: colors.blueChip, fg: colors.blue },
    amber: { bg: colors.amberSoft, fg: colors.amber },
    green: { bg: colors.greenSoft, fg: colors.green },
    purple: { bg: colors.purpleSoft, fg: colors.purple }
  }[tone];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border }}>
      <View style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: palette.bg }}>
        <AppIcon name={icon} size={18} color={palette.fg} />
      </View>
      <Text selectable style={{ flex: 1, color: colors.ink, fontSize: 14, fontWeight: "600" }}>{label}</Text>
      <Text selectable numberOfLines={1} style={{ maxWidth: 150, color: colors.muted, fontSize: 13.5, fontWeight: "700" }}>{value}</Text>
    </View>
  );
}

const groupLabelStyle = {
  color: colors.muted,
  fontWeight: "700" as const,
  fontSize: 13
};

function voiceShortLabel(voice: string): string {
  return voice.replace(/^en-US-/, "").replace(/-/g, " ");
}

function languageLabel(language: UserSettings["targetLanguage"]): string {
  return languageOptions.find((option) => option.code === language)?.label ?? "English";
}

function languageProviderLabel(settings: Pick<UserSettings, "targetLanguage" | "provider">): string {
  if (settings.targetLanguage !== "en") return "GhanaNLP";
  return providerLongLabel(settings.provider);
}
