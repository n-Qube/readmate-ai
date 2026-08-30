import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import { ActionButton, BrandLockup, colors, radius } from "@/components/mobile-design";

type SetupStep = "voice" | "topics" | "extension";

const voices = [
  { id: "Isla", description: "Warm and unhurried · British", icon: "waveform" as AppIconName },
  { id: "Atlas", description: "Clear and steady · good for study", icon: "waveform" as AppIconName },
  { id: "Marlow", description: "Bright and conversational", icon: "waveform" as AppIconName }
];

const topics = ["Science & psychology", "Design & architecture", "Technology", "Business", "Climate & nature", "Health", "History", "Fiction"];

export function SetupFlow({ onComplete }: { onComplete: () => void }) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<SetupStep>("voice");
  const [voice, setVoice] = useState("Isla");
  const [speed, setSpeed] = useState("1.25×");
  const [selectedTopics, setSelectedTopics] = useState(new Set([topics[0], topics[1]]));
  const opacity = useRef(new Animated.Value(1)).current;
  const offset = useRef(new Animated.Value(0)).current;

  const stepIndex = step === "voice" ? 0 : step === "topics" ? 1 : 2;
  const transitionTo = (next: SetupStep) => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 140, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(offset, { toValue: -10, duration: 140, easing: Easing.in(Easing.cubic), useNativeDriver: true })
    ]).start(() => {
      offset.setValue(10);
      setStep(next);
    });
  };

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(offset, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true })
    ]).start();
  }, [offset, opacity, step]);

  const next = () => {
    if (step === "voice") return transitionTo("topics");
    if (step === "topics") return transitionTo("extension");
    onComplete();
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }]}>
      <View style={styles.topBar}>
        <BrandLockup />
        <Pressable accessibilityRole="button" accessibilityLabel="Skip setup" onPress={onComplete} hitSlop={10}>
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      </View>
      <View style={styles.progressRow}>
        {([0, 1, 2] as const).map((index) => <View key={index} style={[styles.progressDot, index === stepIndex ? styles.progressDotActive : styles.progressDotInactive]} />)}
      </View>
      <Animated.View style={[styles.content, { opacity, transform: [{ translateY: offset }] }]}>
        {step === "voice" ? <VoiceStep voice={voice} speed={speed} onVoice={setVoice} onSpeed={setSpeed} /> : null}
        {step === "topics" ? <TopicsStep selectedTopics={selectedTopics} onToggle={(topic) => setSelectedTopics((current) => { const nextSet = new Set(current); if (nextSet.has(topic)) nextSet.delete(topic); else nextSet.add(topic); return nextSet; })} /> : null}
        {step === "extension" ? <ExtensionStep /> : null}
      </Animated.View>
      <View style={styles.footer}>
        <ActionButton label={step === "extension" ? "Get started" : "Continue"} tone="navy" onPress={next} style={styles.continueButton} />
      </View>
    </View>
  );
}

function VoiceStep({ voice, speed, onVoice, onSpeed }: { voice: string; speed: string; onVoice: (value: string) => void; onSpeed: (value: string) => void }) {
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.eyebrow}>SET UP · 1 OF 3</Text>
      <View style={styles.headingGroup}><Text style={styles.title}>Choose a voice</Text><Text style={styles.subtitle}>Every voice is AI-generated. Pick the one you want to spend time with.</Text></View>
      <View style={styles.voiceList}>
        {voices.map((item) => {
          const selected = item.id === voice;
          return <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => onVoice(item.id)} style={[styles.voiceRow, selected && styles.voiceRowSelected]}>
            <View style={[styles.voiceIcon, selected && styles.voiceIconSelected]}><AppIcon name={item.icon} size={20} color={selected ? colors.surface : colors.blue} /></View>
            <View style={styles.voiceText}><Text style={styles.voiceName}>{item.id}</Text><Text style={styles.voiceDescription}>{item.description}</Text></View>
            <AppIcon name={selected ? "checkmark.circle.fill" : "circle"} size={20} color={selected ? colors.blue : "#c9c4b6"} />
          </Pressable>;
        })}
      </View>
      <View style={styles.controlGroup}><Text style={styles.controlLabel}>How fast should ReadMate read?</Text><View style={styles.pillRow}>{["1×", "1.25×", "1.5×", "2×"].map((item) => <Pressable key={item} onPress={() => onSpeed(item)} style={[styles.pill, speed === item && styles.pillSelected]}><Text style={[styles.pillText, speed === item && styles.pillTextSelected]}>{item}</Text></Pressable>)}</View></View>
      <View style={styles.quote}><Text style={styles.quoteText}>“Our attention is a finite resource. Focus isn’t about doing more — it’s about choosing what matters.”</Text><View style={styles.quoteMeta}><AppIcon name="sparkles" size={14} color={colors.faint} /><Text style={styles.quoteMetaText}>Sample · AI-generated speech</Text></View></View>
    </ScrollView>
  );
}

function TopicsStep({ selectedTopics, onToggle }: { selectedTopics: Set<string>; onToggle: (topic: string) => void }) {
  return <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}><Text style={styles.eyebrow}>SET UP · 2 OF 3</Text><View style={styles.headingGroup}><Text style={styles.title}>What do you like to read?</Text><Text style={styles.subtitle}>Pick a few topics to shape your first recommendations.</Text></View><View style={styles.topicWrap}>{topics.map((topic) => <Pressable key={topic} onPress={() => onToggle(topic)} style={[styles.topicPill, selectedTopics.has(topic) && styles.topicPillSelected]}><Text style={[styles.topicLabel, selectedTopics.has(topic) && styles.topicLabelSelected]}>{topic}</Text></Pressable>)}</View><View style={styles.topicIllustration}><AppIcon name="books.vertical" size={38} color={colors.blue} /><View style={styles.connectorDots}>{[0, 1, 2].map((index) => <View key={index} style={[styles.connectorDot, index === 1 && styles.connectorDotMid]} />)}</View><AppIcon name="headphones" size={38} color={colors.blue} /></View></ScrollView>;
}

function ExtensionStep() {
  return <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}><Text style={styles.eyebrow}>SET UP · 3 OF 3</Text><View style={styles.headingGroup}><Text style={styles.title}>Save from any tab</Text><Text style={styles.subtitle}>Connect the Chrome extension and everything you save appears here, with progress synced.</Text></View><View style={styles.extensionCard}><View style={styles.extensionNode}><View style={styles.extensionIcon}><AppIcon name="globe" size={28} color={colors.blue} /></View><Text style={styles.extensionLabel}>Chrome</Text></View><View style={styles.extensionLine}>{[0, 1, 2].map((index) => <View key={index} style={[styles.connectorDot, index === 1 && styles.connectorDotMid]} />)}</View><View style={styles.extensionNode}><View style={[styles.extensionIcon, styles.extensionIconDark]}><AppIcon name="headphones" size={28} color={colors.surface} /></View><Text style={styles.extensionLabel}>ReadMate</Text></View></View><View style={styles.checkList}><CheckRow text="Save articles, PDFs, and feeds in one tap" /><CheckRow text="Progress, voice, and speed stay in sync" /></View></ScrollView>;
}

function CheckRow({ text }: { text: string }) { return <View style={styles.checkRow}><AppIcon name="checkmark" size={16} color={colors.blue} /><Text style={styles.checkText}>{text}</Text></View>; }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 22 },
  topBar: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  skip: { color: colors.claret, fontSize: 15, fontWeight: "700" },
  progressRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10, paddingVertical: 16 },
  progressDot: { width: 9, height: 9, borderRadius: 5 },
  progressDotActive: { backgroundColor: colors.claret },
  progressDotInactive: { backgroundColor: "#d8d0c2" },
  content: { flex: 1 },
  scrollContent: { gap: 18, paddingTop: 14, paddingBottom: 20 },
  eyebrow: { color: colors.claret, fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  headingGroup: { gap: 8 },
  title: { color: colors.ink, fontFamily: "Georgia", fontSize: 34, lineHeight: 38, fontWeight: "700", letterSpacing: -0.6 },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 23 },
  voiceList: { overflow: "hidden", borderRadius: radius.xl, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.border },
  voiceRow: { minHeight: 74, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  voiceRowSelected: { backgroundColor: colors.blueChip },
  voiceIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: colors.surfaceSoft },
  voiceIconSelected: { backgroundColor: colors.blue },
  voiceText: { flex: 1, gap: 2 },
  voiceName: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  voiceDescription: { color: colors.muted, fontSize: 12.5 },
  controlGroup: { gap: 8 },
  controlLabel: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { minHeight: 38, paddingHorizontal: 15, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.bgAlt },
  pillSelected: { backgroundColor: colors.player },
  pillText: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  pillTextSelected: { color: colors.surface },
  quote: { gap: 8, padding: 15, borderRadius: radius.lg, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.border },
  quoteText: { color: colors.text, fontFamily: "Georgia", fontSize: 16, lineHeight: 25, fontStyle: "italic" },
  quoteMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  quoteMetaText: { color: colors.faint, fontSize: 11, fontWeight: "700" },
  topicWrap: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  topicPill: { minHeight: 38, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  topicPillSelected: { backgroundColor: colors.player, borderColor: colors.player },
  topicLabel: { color: colors.text, fontSize: 13, fontWeight: "700" },
  topicLabelSelected: { color: colors.surface },
  topicIllustration: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18, paddingTop: 58 },
  connectorDots: { flexDirection: "row", alignItems: "center", gap: 6 },
  connectorDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(47,104,97,0.35)" },
  connectorDotMid: { backgroundColor: colors.blue },
  extensionCard: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, padding: 28, borderRadius: radius.xl, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.border },
  extensionNode: { alignItems: "center", gap: 8 },
  extensionIcon: { width: 56, height: 56, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: colors.blueChip },
  extensionIconDark: { backgroundColor: colors.player },
  extensionLabel: { color: colors.muted, fontSize: 11.5, fontWeight: "800" },
  extensionLine: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", minWidth: 52 },
  checkList: { gap: 10 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  checkText: { flex: 1, color: colors.text, fontSize: 13.5, lineHeight: 20 },
  footer: { paddingTop: 12 },
  continueButton: { width: "100%" }
});
