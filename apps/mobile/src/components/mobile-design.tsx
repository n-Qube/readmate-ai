import type { ReactNode } from "react";
import { useRouter } from "expo-router";
import { Image, Platform, Pressable, ScrollView, Text, View, useWindowDimensions, type ScrollViewProps, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon, type AppIconName } from "@/components/app-icon";

export const colors = {
  bg: "#f5f1e8",
  bgAlt: "#e6dfd1",
  surface: "#fffdf8",
  surfaceSoft: "#eee8dc",
  border: "rgba(33, 35, 30, 0.10)",
  ink: "#21231e",
  text: "#35382f",
  muted: "#686c62",
  faint: "#99998e",
  navy: "#21231e",
  player: "#1f2a24",
  blue: "#2f6861",
  blueSoft: "#dfece8",
  blueChip: "#edf5f1",
  indigo: "#4d625e",
  purple: "#6d5b91",
  purpleSoft: "#ede8f3",
  teal: "#2f6861",
  tealSoft: "#edf5f1",
  green: "#58774a",
  greenSoft: "#e7efe0",
  amber: "#8a642d",
  amberSoft: "#f1e4c9",
  red: "#ad514d",
  redSoft: "#f1e1dd",
  claret: "#7b3f4b",
  claretSoft: "#f0e3e5",
  paper: "#fffbf2",
  rule: "rgba(33, 35, 30, 0.16)"
} as const;

export const radius = {
  xs: 4,
  sm: 8,
  md: 10,
  lg: 14,
  xl: 18,
  xxl: 22,
  pill: 999
} as const;

export const tabBarBottomInset = 124;
export const phoneContentMaxWidth = 560;
export const tabletContentMaxWidth = 1080;

export const displayText = {
  fontFamily: "Georgia",
  letterSpacing: -0.6
} as const;

export const shadows = {
  card: "0 1px 0 rgba(15, 26, 40, 0.04)",
  elevated: "0 1px 0 rgba(33, 35, 30, 0.04), 0 14px 28px -24px rgba(33, 35, 30, 0.28)",
  floating: "0 16px 36px -26px rgba(33, 35, 30, 0.24)",
  primary: "0 8px 18px -14px rgba(47, 104, 97, 0.55)"
} as const;

type ScreenProps = ScrollViewProps & {
  bottomNavigation?: RootDestination | true;
};

export function Screen({ children, contentContainerStyle, bottomNavigation, ...props }: ScreenProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tablet = width >= 768;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          {
            width: "100%",
            maxWidth: tablet ? tabletContentMaxWidth : phoneContentMaxWidth,
            alignSelf: "center",
            paddingHorizontal: tablet ? 28 : 18,
            paddingTop: (tablet ? 22 : 6) + (Platform.OS === "android" ? insets.top : 0),
            paddingBottom: bottomNavigation ? tabBarBottomInset : 34,
            gap: tablet ? 24 : 18
          },
          contentContainerStyle
        ]}
        {...props}
      >
        {children}
      </ScrollView>
      {bottomNavigation ? <BottomNavigation active={bottomNavigation === true ? undefined : bottomNavigation} /> : null}
    </View>
  );
}

export function useResponsiveLayout() {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= 768;
  return {
    width,
    height,
    isTablet,
    isLandscape: width > height,
    columns: isTablet ? 2 : 1,
    contentMaxWidth: isTablet ? tabletContentMaxWidth : phoneContentMaxWidth
  };
}

export function PageHeader({ eyebrow, title, subtitle, right }: { eyebrow?: string; title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={{ gap: 6, paddingHorizontal: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flex: 1, gap: 5 }}>
          {eyebrow ? (
            <Text selectable style={{ color: colors.muted, fontSize: 13, fontWeight: "500", letterSpacing: 0 }}>
              {eyebrow}
            </Text>
          ) : null}
          <Text selectable style={{ color: colors.ink, fontSize: 31, lineHeight: 35, fontWeight: "700", ...displayText }}>
            {title}
          </Text>
        </View>
        {right}
      </View>
      {subtitle ? (
        <Text selectable style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function WelcomeHeader({ eyebrow, title, subtitle, right }: { eyebrow?: string; title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={{ gap: 6, paddingHorizontal: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <BrandMark size={50} />
        <View style={{ flex: 1, gap: 4 }}>
          {eyebrow ? (
            <Text selectable style={{ color: colors.muted, fontSize: 13, fontWeight: "500", letterSpacing: 0 }}>
              {eyebrow}
            </Text>
          ) : null}
          <Text selectable numberOfLines={2} adjustsFontSizeToFit style={{ color: colors.ink, fontSize: 29, lineHeight: 32, fontWeight: "800", letterSpacing: 0 }}>
            {title}
          </Text>
        </View>
        {right}
      </View>
      {subtitle ? (
        <Text selectable style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function SectionCard({ children, style, elevated = false }: { children: ReactNode; style?: StyleProp<ViewStyle>; elevated?: boolean }) {
  return (
    <View
      style={[
        {
          gap: 12,
          padding: 15,
          borderRadius: 12,
          borderCurve: "continuous",
          backgroundColor: colors.paper,
          borderWidth: 1,
          borderColor: colors.border,
          boxShadow: elevated ? shadows.elevated : "none"
        },
        style
      ]}
    >
      {children}
    </View>
  );
}

export function StatusPill({ label, tone = "blue" }: { label: string; tone?: "blue" | "green" | "amber" | "red" | "navy" }) {
  const toneColors = {
    blue: { bg: colors.blueChip, fg: colors.blue },
    green: { bg: colors.greenSoft, fg: colors.green },
    amber: { bg: colors.amberSoft, fg: colors.amber },
    red: { bg: colors.redSoft, fg: colors.red },
    navy: { bg: "#edf2f8", fg: colors.navy }
  }[tone];

  return (
    <Text selectable numberOfLines={1} style={{ overflow: "hidden", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: toneColors.bg, color: toneColors.fg, fontSize: 12, fontWeight: "900" }}>
      {label}
    </Text>
  );
}

export function Pill({ label, selected = false, tone = "navy", onPress }: { label: string; selected?: boolean; tone?: "navy" | "blue" | "green"; onPress?: () => void }) {
  const activeColor = tone === "blue" ? colors.blue : tone === "green" ? colors.green : colors.navy;
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={{
        minHeight: 34,
        paddingHorizontal: 13,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 999,
        backgroundColor: selected ? activeColor : colors.surface,
        borderWidth: 1,
        borderColor: selected ? activeColor : colors.border
      }}
    >
      <Text numberOfLines={1} style={{ color: selected ? "#ffffff" : colors.muted, fontSize: 12, fontWeight: "700" }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ActionButton({
  label,
  onPress,
  tone = "navy",
  disabled = false,
  style
}: {
  label: string;
  onPress?: () => void;
  tone?: "navy" | "blue" | "green" | "soft" | "danger";
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const toneColors = {
    navy: { bg: colors.navy, fg: "#ffffff" },
    blue: { bg: colors.blue, fg: "#ffffff" },
    green: { bg: colors.greenSoft, fg: colors.green },
    soft: { bg: colors.bgAlt, fg: colors.text },
    danger: { bg: colors.redSoft, fg: colors.red }
  }[tone];
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        {
          minHeight: 44,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.pill,
          borderCurve: "continuous",
          backgroundColor: disabled ? "#9aa8bd" : toneColors.bg,
          paddingHorizontal: 14
        },
        style
      ]}
    >
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: disabled ? "#ffffff" : toneColors.fg, fontSize: 14, fontWeight: "700" }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function IconCircle({
  label,
  symbol,
  icon,
  onPress,
  tone = "soft",
  disabled = false,
  size = 44
}: {
  label: string;
  symbol?: string;
  icon?: AppIconName;
  onPress?: () => void;
  tone?: "soft" | "navy" | "blue" | "danger";
  disabled?: boolean;
  size?: number;
}) {
  const toneColors = {
    soft: { bg: colors.bgAlt, fg: colors.text, shadow: "none" },
    navy: { bg: colors.navy, fg: "#ffffff", shadow: "0 8px 18px rgba(16, 24, 39, 0.22)" },
    blue: { bg: colors.blue, fg: "#ffffff", shadow: shadows.primary },
    danger: { bg: colors.redSoft, fg: colors.red, shadow: "none" }
  }[tone];

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.pill,
        backgroundColor: disabled ? "#e8edf5" : toneColors.bg,
        boxShadow: disabled ? "none" : toneColors.shadow
      }}
    >
      {icon ? (
        <AppIcon name={icon} size={Math.round(size * 0.42)} color={disabled ? "#9aa8bd" : toneColors.fg} weight="semibold" />
      ) : symbol ? (
        <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: disabled ? "#9aa8bd" : toneColors.fg, fontSize: Math.round(size * 0.32), fontWeight: "900" }}>
          {symbol}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function MediaButton({
  label,
  icon,
  onPress,
  disabled = false,
  primary = false
}: {
  label: string;
  icon: AppIconName;
  onPress?: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <IconCircle
      label={label}
      icon={icon}
      onPress={onPress}
      disabled={disabled}
      tone={primary ? "blue" : "soft"}
      size={primary ? 56 : 44}
    />
  );
}

export function FieldTile({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <View style={{ flex: 1, gap: 4, padding: 12, borderRadius: 12, borderCurve: "continuous", backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border }}>
      <Text selectable style={{ color: colors.faint, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>
        {label}
      </Text>
      <Text selectable numberOfLines={1} adjustsFontSizeToFit style={{ color: colors.ink, fontSize: 18, fontWeight: "900", fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
      {helper ? (
        <Text selectable numberOfLines={1} style={{ color: colors.muted, fontSize: 12, fontWeight: "700" }}>
          {helper}
        </Text>
      ) : null}
    </View>
  );
}

export function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text selectable style={{ color: colors.ink, fontSize: 20, fontWeight: "800", lineHeight: 25, letterSpacing: 0 }}>
        {title}
      </Text>
      {subtitle ? (
        <Text selectable style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function EditorialHero({
  eyebrow,
  title,
  subtitle,
  right,
  children
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <View style={{ gap: 16, padding: 18, borderRadius: 18, borderCurve: "continuous", backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.rule }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flex: 1, gap: 7 }}>
          {eyebrow ? (
            <Text selectable style={{ color: colors.claret, fontSize: 12, lineHeight: 16, fontWeight: "800" }}>
              {eyebrow}
            </Text>
          ) : null}
          <Text selectable style={{ color: colors.ink, fontSize: 36, lineHeight: 40, fontWeight: "700", ...displayText }}>
            {title}
          </Text>
          {subtitle ? (
            <Text selectable style={{ color: colors.muted, fontSize: 15, lineHeight: 23 }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

export function QuietRule() {
  return <View style={{ height: 1, backgroundColor: colors.rule }} />;
}

export function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 3 }}>
      <Text selectable numberOfLines={1} adjustsFontSizeToFit style={{ color: colors.ink, fontSize: 22, lineHeight: 25, fontWeight: "900", fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
      <Text selectable numberOfLines={1} style={{ color: colors.muted, fontSize: 12, fontWeight: "700" }}>
        {label}
      </Text>
    </View>
  );
}

export function BrandMark({ size = 54 }: { size?: number }) {
  return (
    <Image
      source={require("../../assets/icon.png")}
      resizeMode="contain"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.22)
      }}
    />
  );
}

export function SettingsShortcut({ size = 40 }: { size?: number }) {
  const router = useRouter();
  const dimension = Math.max(40, size);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open settings"
      hitSlop={10}
      onPress={() => router.push("/settings")}
      style={{
        width: dimension,
        height: dimension,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.pill,
        borderCurve: "continuous",
        backgroundColor: colors.surfaceSoft,
        borderWidth: 1,
        borderColor: colors.border
      }}
    >
      <AppIcon name="gearshape" size={Math.round(dimension * 0.46)} color={colors.player} weight="semibold" />
    </Pressable>
  );
}

export function BrandWordmark({ large = false }: { large?: boolean }) {
  return (
    <Text selectable style={{ color: colors.claret, fontSize: large ? 34 : 27, lineHeight: large ? 39 : 32, fontWeight: "700", ...displayText }}>
      ReadMate
    </Text>
  );
}

export function BrandLockup({ large = false }: { large?: boolean }) {
  return (
    <View accessibilityLabel="ReadMate" style={{ flexDirection: "row", alignItems: "center", gap: large ? 11 : 9 }}>
      <BrandMark size={large ? 44 : 34} />
      <BrandWordmark large={large} />
    </View>
  );
}

export function NavBackButton({ label = "Back", onPress }: { label?: string; onPress?: () => void }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      onPress={onPress ?? (() => router.back())}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
    >
      <AppIcon name="chevron.left" size={24} color={colors.player} weight="semibold" />
    </Pressable>
  );
}

type RootDestination = "/(tabs)" | "/(tabs)/library" | "/(tabs)/study" | "/(tabs)/more";

export function BottomNavigation({ active }: { active?: RootDestination }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const destinations: Array<{ label: string; icon: AppIconName; href: RootDestination }> = [
    { label: "Home", icon: "house", href: "/(tabs)" },
    { label: "Library", icon: "books.vertical", href: "/(tabs)/library" },
    { label: "Study", icon: "graduationcap", href: "/(tabs)/study" },
    { label: "More", icon: "ellipsis", href: "/(tabs)/more" }
  ];
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 14, right: 14, bottom: Math.max(8, insets.bottom + 8), alignItems: "center" }}>
      <View style={{ width: "100%", maxWidth: phoneContentMaxWidth, flexDirection: "row", gap: 8, padding: 5, borderRadius: radius.xxl, backgroundColor: "rgba(255,253,248,0.96)", borderWidth: 1, borderColor: colors.border, boxShadow: "0 12px 36px -28px rgba(33,35,30,0.6)" }}>
        {destinations.map((destination) => {
          const selected = destination.href === active;
          return (
            <Pressable
              key={destination.href}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Go to ${destination.label}`}
              onPress={() => router.replace(destination.href)}
              style={{ flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center", gap: 2, borderRadius: radius.lg, backgroundColor: "transparent" }}
            >
              <AppIcon name={destination.icon} size={selected ? 23 : 21} color={selected ? colors.player : colors.muted} weight={selected ? "bold" : "regular"} />
              <Text style={{ color: selected ? colors.player : colors.muted, fontSize: 10, fontWeight: selected ? "900" : "700" }}>{destination.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function MetricTile({ label, value, tone = "blue" }: { label: string; value: string; tone?: "blue" | "green" | "amber" | "navy" }) {
  const toneColors = {
    blue: { bg: colors.blueSoft, fg: colors.blue },
    green: { bg: colors.greenSoft, fg: colors.green },
    amber: { bg: colors.amberSoft, fg: colors.amber },
    navy: { bg: "#edf2f8", fg: colors.navy }
  }[tone];

  return (
    <View style={{ flex: 1, gap: 3, padding: 12, borderRadius: 12, borderCurve: "continuous", backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: toneColors.bg }}>
      <Text selectable numberOfLines={1} adjustsFontSizeToFit style={{ color: toneColors.fg, fontSize: 21, fontWeight: "800", fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
      <Text selectable numberOfLines={1} style={{ color: colors.muted, fontSize: 12, fontWeight: "600" }}>
        {label}
      </Text>
    </View>
  );
}

export function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <SectionCard>
      <Text selectable style={{ fontSize: 18, fontWeight: "900", color: colors.ink }}>
        {title}
      </Text>
      <Text selectable style={{ fontSize: 15, lineHeight: 22, color: colors.muted }}>
        {body}
      </Text>
    </SectionCard>
  );
}

export function todayLabel() {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date());
}
