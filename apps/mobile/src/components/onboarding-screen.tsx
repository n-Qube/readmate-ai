import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/components/mobile-design";

const referenceScreen1 = require("../../assets/onboarding/reference-screen-1.png");
const referenceScreen2 = require("../../assets/onboarding/reference-screen-2.png");

const steps = [
  { image: referenceScreen1, title: "Turn anything into listening.", subtitle: "Save an article, then press play." },
  { image: referenceScreen2, title: "Your reading, in motion.", subtitle: "Keep every source in one place and make time to listen." },
  { image: referenceScreen2, title: "Your pace, your way.", subtitle: "Choose a voice, press play, and keep moving." }
];

function Progress({ active }: { active: number }) {
  return (
    <View style={styles.progress} accessibilityLabel={`Onboarding step ${active + 1} of ${steps.length}`}>
      {steps.map((_, index) => <View key={index} style={[styles.dot, index === active ? styles.dotActive : styles.dotInactive]} />)}
    </View>
  );
}

function WobblingConnection({ screen }: { screen: number }) {
  const motion = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(motion, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(motion, { toValue: -1, duration: 850, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(motion, { toValue: 0, duration: 850, easing: Easing.inOut(Easing.sin), useNativeDriver: true })
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [motion]);

  const translateY = motion.interpolate({ inputRange: [-1, 0, 1], outputRange: [-3, 0, 3] });
  const rotate = motion.interpolate({ inputRange: [-1, 0, 1], outputRange: ["-2deg", "0deg", "2deg"] });

  return (
    <View pointerEvents="none" style={[styles.connectionOverlay, screen === 0 ? styles.connectionFirst : styles.connectionSources]}>
      {[0, 1, 2].map((segment) => (
        <Animated.View key={segment} style={[styles.connectionSegment, { transform: [{ translateY }, { rotate }] }, segment === 1 && styles.connectionSegmentMiddle, segment === 2 && styles.connectionSegmentEnd]} />
      ))}
    </View>
  );
}

function VoiceChoices() {
  return (
    <View pointerEvents="none" style={styles.voiceChoicesMask}>
      <View style={styles.voiceChoiceLine} />
      <View style={styles.voiceChoiceRow}>
        {["English", "Twi", "Ewe", "Ga"].map((label, index) => (
          <View key={label} style={[styles.voiceChoice, index === 0 && styles.voiceChoiceSelected]}>
            <Text style={[styles.voiceChoiceLabel, index === 0 && styles.voiceChoiceLabelSelected]}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function FirstRunOnboarding({ onComplete }: { onComplete: (options?: { showSetup?: boolean }) => void }) {
  const insets = useSafeAreaInsets();
  const [stepIndex, setStepIndex] = useState(0);
  const [showSplash, setShowSplash] = useState(true);
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const contentOffset = useRef(new Animated.Value(0)).current;
  const step = steps[stepIndex];

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 1450);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(contentOpacity, { toValue: 1, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(contentOffset, { toValue: 0, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true })
    ]).start();
  }, [contentOffset, contentOpacity, stepIndex]);

  const next = () => {
    if (stepIndex === steps.length - 1) return onComplete({ showSetup: true });
    Animated.parallel([
      Animated.timing(contentOpacity, { toValue: 0, duration: 160, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(contentOffset, { toValue: -14, duration: 160, easing: Easing.in(Easing.cubic), useNativeDriver: true })
    ]).start(() => {
      contentOffset.setValue(14);
      setStepIndex((current) => current + 1);
    });
  };

  if (showSplash) return <SplashIntro />;

  return (
    <View style={styles.screen}>
      <Animated.View style={[styles.referenceFrame, { opacity: contentOpacity, transform: [{ translateX: contentOffset }] }]}>
        <Image source={step.image} resizeMode="cover" style={styles.referenceImage} />
        <WobblingConnection screen={stepIndex} />
        {stepIndex > 0 ? (
          <View pointerEvents="none" style={styles.topControlsMask}>
            <Progress active={stepIndex} />
            <Text style={styles.skipOverlay}>Skip</Text>
          </View>
        ) : null}
        {stepIndex === 2 ? <VoiceChoices /> : null}
        {stepIndex === 2 ? (
          <View pointerEvents="none" style={styles.copyMask}>
            <Text style={styles.replacementTitle}>{step.title}</Text>
            <Text style={styles.replacementSubtitle}>{step.subtitle}</Text>
          </View>
        ) : null}
      </Animated.View>

      <Pressable accessibilityRole="button" accessibilityLabel="Skip onboarding" onPress={() => onComplete({ showSetup: false })} style={[styles.skipHit, { top: insets.top + 48 }]} />
      <Pressable accessibilityRole="button" accessibilityLabel={stepIndex === steps.length - 1 ? "Finish onboarding" : "Next onboarding screen"} onPress={next} style={styles.nextHit} />
    </View>
  );
}

function SplashIntro() {
  const opacity = useRef(new Animated.Value(0)).current;
  const offset = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(offset, { toValue: 0, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true })
    ]).start();
  }, [offset, opacity]);

  return (
    <View style={styles.splashScreen}>
      <Animated.View style={[styles.splashContent, { opacity, transform: [{ translateY: offset }] }]}>
        <Image source={require("../../assets/icon.png")} resizeMode="contain" style={styles.splashMark} />
        <Text style={styles.splashTitle}>ReadMate</Text>
        <Text style={styles.splashSubtitle}>Turn anything worth reading into something worth listening to.</Text>
        <View style={styles.splashProgress}><View style={styles.splashProgressFill} /></View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  splashScreen: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  splashContent: { alignItems: "center", paddingHorizontal: 42, gap: 18 },
  splashMark: { width: 84, height: 84, borderRadius: 19 },
  splashTitle: { color: colors.player, fontFamily: "Georgia", fontSize: 42, fontWeight: "700", letterSpacing: -0.6 },
  splashAccent: { color: colors.claret },
  splashSubtitle: { maxWidth: 270, color: colors.muted, fontSize: 15, lineHeight: 23, textAlign: "center" },
  splashProgress: { width: 52, height: 3, borderRadius: 2, backgroundColor: colors.surfaceSoft, overflow: "hidden", marginTop: 12 },
  splashProgressFill: { width: "62%", height: "100%", borderRadius: 2, backgroundColor: colors.blue },
  referenceFrame: { ...StyleSheet.absoluteFill },
  referenceImage: { width: "100%", height: "100%" },
  progress: { position: "absolute", left: 0, right: 0, top: 0, height: 34, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  dotActive: { backgroundColor: colors.claret },
  dotInactive: { backgroundColor: "#d8d0c2" },
  topControlsMask: { position: "absolute", left: 0, right: 0, top: 0, height: 90, backgroundColor: colors.bg },
  skipOverlay: { position: "absolute", right: 34, top: 52, color: colors.claret, fontSize: 16, lineHeight: 22, fontWeight: "600" },
  connectionOverlay: { position: "absolute", height: 8, left: 0, right: 0 },
  connectionFirst: { top: "38%" },
  connectionSources: { top: "40%" },
  connectionSegment: { position: "absolute", left: "18%", width: "20%", height: 3, borderRadius: 2, backgroundColor: "rgba(47,104,97,0.72)" },
  connectionSegmentMiddle: { left: "39%" },
  connectionSegmentEnd: { left: "60%" },
  copyMask: { position: "absolute", left: 0, right: 0, top: "48%", height: "27%", backgroundColor: colors.bg, alignItems: "center", paddingHorizontal: 30, paddingTop: 18 },
  replacementTitle: { color: colors.ink, fontFamily: "Georgia", fontSize: 38, lineHeight: 43, fontWeight: "700", textAlign: "center" },
  replacementSubtitle: { color: colors.muted, marginTop: 18, fontSize: 18, lineHeight: 27, fontWeight: "500", textAlign: "center" },
  voiceChoicesMask: { position: "absolute", left: 0, right: 0, top: "29%", height: "23%", backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  voiceChoiceLine: { position: "absolute", left: 34, right: 34, bottom: 22, height: 2, backgroundColor: colors.teal },
  voiceChoiceRow: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  voiceChoice: { width: 86, height: 74, borderRadius: 16, borderWidth: 2, borderColor: "#c8c1b4", backgroundColor: "rgba(255,253,248,0.72)", alignItems: "center", justifyContent: "center" },
  voiceChoiceSelected: { backgroundColor: colors.teal, borderColor: colors.teal },
  voiceChoiceLabel: { color: colors.teal, fontSize: 15, fontWeight: "800" },
  voiceChoiceLabelSelected: { color: colors.surface },
  skipHit: { position: "absolute", right: 24, width: 84, height: 48 },
  nextHit: { position: "absolute", left: 0, right: 0, bottom: 0, height: "54%" }
});
