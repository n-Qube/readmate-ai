import { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { BrandLockup, colors, radius, shadows } from "@/components/mobile-design";

const referenceScreen1 = require("../../assets/onboarding/reference-screen-1.png");
const referenceScreen2 = require("../../assets/onboarding/reference-screen-2.png");

const steps = [
  {
    image: referenceScreen1,
    title: "Turn anything into listening.",
    subtitle: "Save an article, then press play. ReadMate keeps the experience calm, focused, and easy to return to."
  },
  {
    image: referenceScreen2,
    title: "Your reading, in motion.",
    subtitle: "Keep articles, PDFs, and feeds together, then carry your listening progress across every screen."
  },
  {
    image: referenceScreen2,
    title: "Your pace, your way.",
    subtitle: "Choose a voice, set your speed, and listen in English, Twi, Ewe, or Ga."
  }
] as const;

function Progress({ active }: { active: number }) {
  return (
    <View
      accessibilityLabel={`Onboarding step ${active + 1} of ${steps.length}`}
      style={styles.progress}
    >
      {steps.map((_, index) => (
        <View
          key={index}
          style={[
            styles.progressSegment,
            index <= active ? styles.progressSegmentActive : styles.progressSegmentInactive
          ]}
        />
      ))}
    </View>
  );
}

export function FirstRunOnboarding({ onComplete }: { onComplete: (options?: { showSetup?: boolean }) => void }) {
  const { width, height } = useWindowDimensions();
  const [stepIndex, setStepIndex] = useState(0);
  const compact = width < 800;
  const shortViewport = height < 680;
  const step = steps[stepIndex];
  const finalStep = stepIndex === steps.length - 1;

  const next = () => {
    if (finalStep) {
      onComplete({ showSetup: true });
      return;
    }
    setStepIndex((current) => current + 1);
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          compact ? styles.scrollContentCompact : styles.scrollContentDesktop
        ]}
      >
        <View style={[styles.shell, compact && styles.shellCompact]}>
          <View style={styles.topBar}>
            <BrandLockup large={!compact} />
            <View style={styles.topActions}>
              <Text selectable style={styles.stepLabel}>Step {stepIndex + 1} of {steps.length}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Skip onboarding"
                hitSlop={8}
                onPress={() => onComplete({ showSetup: false })}
                style={({ pressed }) => [styles.skipButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.skipText}>Skip</Text>
              </Pressable>
            </View>
          </View>

          <Progress active={stepIndex} />

          <View style={[styles.content, compact && styles.contentCompact]}>
            <View style={[styles.copy, compact && styles.copyCompact]}>
              <View style={styles.copyGroup}>
                <Text
                  accessibilityRole="header"
                  selectable
                  style={[
                    styles.title,
                    compact && styles.titleCompact,
                    shortViewport && !compact && styles.titleShort
                  ]}
                >
                  {step.title}
                </Text>
                <Text selectable style={[styles.subtitle, compact && styles.subtitleCompact]}>
                  {step.subtitle}
                </Text>
              </View>

              {finalStep ? (
                <View
                  accessibilityLabel="Languages include English, Twi, Ewe, and Ga"
                  style={styles.languageRow}
                >
                  {["English", "Twi", "Ewe", "Ga"].map((language, index) => (
                    <View key={language} style={[styles.languageChip, index === 1 && styles.languageChipFeatured]}>
                      <Text style={[styles.languageLabel, index === 1 && styles.languageLabelFeatured]}>{language}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={[styles.buttonRow, compact && styles.buttonRowCompact]}>
                {stepIndex > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Previous onboarding screen"
                    onPress={() => setStepIndex((current) => Math.max(0, current - 1))}
                    style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
                  >
                    <Text style={styles.secondaryButtonText}>Back</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={finalStep ? "Finish onboarding" : "Next onboarding screen"}
                  onPress={next}
                  style={({ pressed }) => [styles.primaryButton, compact && styles.primaryButtonCompact, pressed && styles.buttonPressed]}
                >
                  <Text style={styles.primaryButtonText}>{finalStep ? "Choose my setup" : "Continue"}</Text>
                  <Text aria-hidden style={styles.primaryButtonArrow}>→</Text>
                </Pressable>
              </View>
            </View>

            <View style={[styles.artPanel, compact && styles.artPanelCompact, shortViewport && !compact && styles.artPanelShort]}>
              <Image
                accessible={false}
                source={step.image}
                resizeMode="contain"
                style={[styles.referenceImage, { top: compact ? -185 : -280 }]}
              />
              <View pointerEvents="none" style={styles.artFrame} />
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg
  },
  scrollContent: {
    flexGrow: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center"
  },
  scrollContentDesktop: {
    paddingHorizontal: 32,
    paddingVertical: 24
  },
  scrollContentCompact: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    justifyContent: "flex-start"
  },
  shell: {
    width: "100%",
    maxWidth: 1180,
    gap: 20,
    padding: 28,
    borderRadius: 28,
    borderCurve: "continuous",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.rule,
    boxShadow: shadows.floating
  },
  shellCompact: {
    padding: 18,
    gap: 16,
    borderRadius: radius.xxl
  },
  topBar: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 18
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14
  },
  stepLabel: {
    color: colors.faint,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700"
  },
  skipButton: {
    minWidth: 64,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.claretSoft
  },
  skipText: {
    color: colors.claret,
    fontSize: 14,
    fontWeight: "800"
  },
  progress: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: radius.pill
  },
  progressSegmentActive: {
    backgroundColor: colors.teal
  },
  progressSegmentInactive: {
    backgroundColor: colors.bgAlt
  },
  content: {
    minHeight: 430,
    flexDirection: "row",
    alignItems: "stretch",
    gap: 38
  },
  contentCompact: {
    minHeight: 0,
    flexDirection: "column",
    gap: 24
  },
  copy: {
    flex: 0.92,
    minWidth: 0,
    justifyContent: "center",
    gap: 30,
    paddingHorizontal: 12,
    paddingVertical: 24
  },
  copyCompact: {
    paddingHorizontal: 2,
    paddingVertical: 10,
    gap: 22
  },
  copyGroup: {
    gap: 16
  },
  title: {
    maxWidth: 510,
    color: colors.ink,
    fontFamily: "Georgia",
    fontSize: 58,
    lineHeight: 62,
    fontWeight: "700",
    letterSpacing: -1.4
  },
  titleShort: {
    fontSize: 50,
    lineHeight: 54
  },
  titleCompact: {
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -0.8
  },
  subtitle: {
    maxWidth: 510,
    color: colors.muted,
    fontSize: 18,
    lineHeight: 28
  },
  subtitleCompact: {
    fontSize: 16,
    lineHeight: 24
  },
  languageRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  languageChip: {
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.blueChip,
    borderWidth: 1,
    borderColor: colors.border
  },
  languageChipFeatured: {
    backgroundColor: colors.teal,
    borderColor: colors.teal
  },
  languageLabel: {
    color: colors.teal,
    fontSize: 13,
    fontWeight: "800"
  },
  languageLabelFeatured: {
    color: colors.surface
  },
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  buttonRowCompact: {
    alignItems: "stretch"
  },
  primaryButton: {
    minWidth: 184,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.player,
    boxShadow: shadows.primary
  },
  primaryButtonCompact: {
    flex: 1
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800"
  },
  primaryButtonArrow: {
    color: colors.surface,
    fontSize: 18,
    lineHeight: 20,
    fontWeight: "700"
  },
  secondaryButton: {
    minWidth: 92,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800"
  },
  buttonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.99 }]
  },
  artPanel: {
    flex: 1.08,
    minWidth: 0,
    minHeight: 430,
    overflow: "hidden",
    borderRadius: 24,
    borderCurve: "continuous",
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.rule
  },
  artPanelShort: {
    minHeight: 380
  },
  artPanelCompact: {
    minHeight: 260,
    maxHeight: 280
  },
  referenceImage: {
    position: "absolute",
    left: 0,
    right: 0,
    width: "100%",
    aspectRatio: 853 / 1844
  },
  artFrame: {
    ...StyleSheet.absoluteFill,
    borderRadius: 24,
    borderWidth: 8,
    borderColor: "rgba(255,253,248,0.34)"
  }
});
