import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { AppIcon } from "@/components/app-icon";
import { BrandLockup, NavBackButton, QuietRule, Screen, SectionCard, colors, displayText, radius } from "@/components/mobile-design";

export default function AboutScreen() {
  const router = useRouter();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const showPrivacy = section === "privacy";
  return (
    <Screen bottomNavigation="/(tabs)/more" contentContainerStyle={{ gap: 22 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <NavBackButton label="Back to More" />
        <BrandLockup />
      </View>

      <View style={{ gap: 7 }}>
        <Text selectable style={{ color: colors.claret, fontSize: 13, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.7 }}>
          {showPrivacy ? "Your data" : "Read anywhere. Listen everywhere."}
        </Text>
        <Text selectable style={{ color: colors.ink, fontSize: 34, lineHeight: 38, fontWeight: "700", ...displayText }}>
          {showPrivacy ? "Privacy Policy" : "About ReadMate"}
        </Text>
        <Text selectable style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>
          {showPrivacy ? "Last updated August 29, 2026" : "ReadMate turns saved webpages and documents into a synchronized reading, listening, and study library."}
        </Text>
      </View>

      {showPrivacy ? <PrivacyPolicy /> : <AboutProduct onPrivacy={() => router.replace({ pathname: "/about", params: { section: "privacy" } })} />}
    </Screen>
  );
}

function AboutProduct({ onPrivacy }: { onPrivacy: () => void }) {
  const capabilities = [
    { icon: "headphones" as const, title: "Listen", body: "Play saved reading with background and lock-screen controls." },
    { icon: "cloud" as const, title: "Sync", body: "Continue the same account library across Chrome and mobile." },
    { icon: "graduationcap" as const, title: "Study", body: "Create summaries, key points, flashcards, quizzes, and cited answers." }
  ];
  return (
    <View style={{ gap: 14 }}>
      {capabilities.map((item) => (
        <SectionCard key={item.title}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 13 }}>
            <View style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.lg, backgroundColor: colors.greenSoft }}>
              <AppIcon name={item.icon} size={22} color={colors.player} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text selectable style={{ color: colors.ink, fontSize: 17, fontWeight: "800" }}>{item.title}</Text>
              <Text selectable style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>{item.body}</Text>
            </View>
          </View>
        </SectionCard>
      ))}
      <Pressable accessibilityRole="button" onPress={onPrivacy} style={{ minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: radius.lg, backgroundColor: colors.player }}>
        <Text style={{ color: "#fffdf8", fontSize: 14, fontWeight: "900" }}>Read the Privacy Policy</Text>
      </Pressable>
    </View>
  );
}

function PrivacyPolicy() {
  return (
    <SectionCard>
      <PolicySection title="Information we process">
        Account identifiers used for sign-in and synchronization; saved reading items and uploads; document metadata; playback progress; notes, highlights, and preferences; and text you choose to convert into audio.
      </PolicySection>
      <QuietRule />
      <PolicySection title="How we use information">
        We use this information to provide the app, synchronize your library, generate text-to-speech audio, and maintain the service.
      </PolicySection>
      <QuietRule />
      <PolicySection title="Browser-agent actions">
        On supported web browsers, an assistant can invoke ReadMate tools only while you are signed in on the active ReadMate page. Actions that save content, subscribe to a feed, or generate study material stay visible and require your review and submission. ReadMate does not expose these tools on account-deletion, payment, password, or provider-secret pages.
      </PolicySection>
      <QuietRule />
      <PolicySection title="Service providers">
        ReadMate uses service providers for authentication, database and file storage, hosting, AI study features, text-to-speech, and Premium subscription verification. Saved content or selected text is sent to AI or speech providers only when you request the related feature. Synthesized speech is AI-generated and may contain errors. RevenueCat receives your ReadMate account identifier and store subscription status so Premium access can be verified and restored; ReadMate does not receive your card or bank details.
      </PolicySection>
      <QuietRule />
      <PolicySection title="What we do not do">
        ReadMate does not continuously record your screen, collect passwords, read hidden form fields, capture sensitive pages, add cross-site tracking, or export your library to another website.
      </PolicySection>
      <QuietRule />
      <PolicySection title="Retention and deletion">
        Your saved content and preferences remain available for synchronization until you delete individual items or delete your account in Settings. Account deletion removes account-linked app records unless retention is required for legal, security, or abuse-prevention reasons. Deleting your ReadMate account does not cancel an App Store or Google Play subscription; manage the subscription in the store first if you want to stop renewal.
      </PolicySection>
      <QuietRule />
      <PolicySection title="Contact">
        For privacy questions or deletion requests, email nii.nortey@gmail.com.
      </PolicySection>
    </SectionCard>
  );
}

function PolicySection({ title, children }: { title: string; children: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text selectable style={{ color: colors.ink, fontSize: 17, fontWeight: "800", ...displayText }}>{title}</Text>
      <Text selectable style={{ color: colors.muted, fontSize: 14, lineHeight: 22 }}>{children}</Text>
    </View>
  );
}
