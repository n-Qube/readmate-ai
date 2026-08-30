import { Link } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from "react-native";
import { AppIcon } from "@/components/app-icon";
import { EditorialImage } from "@/components/editorial-image";
import { BrandLockup, EmptyCard, Screen, SettingsShortcut, colors, displayText, radius } from "@/components/mobile-design";
import { useReadingLibrary } from "@/hooks/use-reading-library";
import type { ReadingDocument } from "@/types";

export default function StudyScreen() {
  const { documents, documentsQuery } = useReadingLibrary();
  const studyItems = documents.filter(hasLearningData);
  const featured = studyItems.find((document) => document.title.includes("Creative Focus")) ?? studyItems[0];
  const queue = studyItems.filter((document) => document.id !== featured?.id).slice(0, 2);

  return (
    <Screen bottomNavigation="/(tabs)/study" refreshControl={<RefreshControl refreshing={documentsQuery.isRefetching} onRefresh={documentsQuery.refetch} />}>
      <View style={{ gap: 22 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <BrandLockup large />
          <SettingsShortcut size={50} />
        </View>
        <View style={{ gap: 7 }}>
          <Text selectable style={{ color: colors.ink, fontSize: 31, lineHeight: 36, fontWeight: "700", ...displayText }}>Study</Text>
          <Text selectable style={{ color: colors.text, fontSize: 16, lineHeight: 23 }}>Build understanding that lasts.</Text>
        </View>
        <WeeklyProgress />
      </View>

      {documentsQuery.isLoading ? <ActivityIndicator color={colors.blue} /> : null}
      {!featured && !documentsQuery.isLoading ? <EmptyCard title="No study material yet" body="Save an article or document to create highlights, flashcards, and practice questions." /> : null}

      {featured ? (
        <View style={{ gap: 14 }}>
          <SectionLabel>Featured review</SectionLabel>
          <Link href={{ pathname: "/document/[id]", params: { id: featured.id } }} asChild>
            <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <EditorialImage document={featured} style={{ width: 154, height: 150, borderRadius: radius.xl }} />
              <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
                <Text selectable numberOfLines={1} style={{ color: colors.claret, fontSize: 13, fontWeight: "600" }}>{featured.sourceLabel ?? featured.category}</Text>
                <Text selectable numberOfLines={3} style={{ color: colors.ink, fontSize: 23, lineHeight: 27, fontWeight: "700", ...displayText }}>{featured.title}</Text>
                <Text selectable numberOfLines={3} style={{ color: colors.text, fontSize: 13, lineHeight: 19 }}>{featured.description ?? featured.summary}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                  <AppIcon name="headphones" size={16} color={colors.muted} />
                  <Text selectable style={{ color: colors.muted, fontSize: 12 }}>{listenMinutes(featured)} min</Text>
                  <Text style={{ color: colors.faint }}>·</Text>
                  <Text selectable style={{ color: colors.muted, fontSize: 12 }}>{featured.keyPoints?.length ?? 0} key points</Text>
                </View>
              </View>
            </Pressable>
          </Link>

          <Link href={{ pathname: "/document/[id]", params: { id: featured.id } }} asChild>
            <Pressable style={{ minHeight: 64, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, borderRadius: radius.xl, backgroundColor: "#075c3a" }}>
              <AppIcon name="graduationcap" size={27} color="#ffffff" />
              <Text style={{ flex: 1, color: "#ffffff", fontSize: 17, fontWeight: "800" }}>Continue learning</Text>
              <AppIcon name="chevron.right" size={23} color="#ffffff" />
            </Pressable>
          </Link>
        </View>
      ) : null}

      {queue.length ? (
        <View style={{ gap: 0, borderTopWidth: 1, borderTopColor: colors.rule, paddingTop: 20 }}>
          <SectionLabel>Review queue</SectionLabel>
          <View style={{ marginTop: 10 }}>
            {queue.map((document, index) => <ReviewRow key={document.id} document={document} last={index === queue.length - 1} />)}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

function WeeklyProgress() {
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: colors.rule }}>
      <AppIcon name="calendar" size={30} color={colors.player} />
      <View style={{ width: 96, gap: 2 }}>
        <Text selectable style={{ color: colors.muted, fontSize: 13 }}>Weekly progress</Text>
        <Text selectable style={{ color: colors.player, fontSize: 15, fontWeight: "700" }}>3 of 7 days</Text>
      </View>
      <View style={{ flex: 1, flexDirection: "row", justifyContent: "space-between" }}>
        {days.map((day, index) => (
          <View key={`${day}-${index}`} style={{ alignItems: "center", gap: 5 }}>
            <View style={{ width: 23, height: 23, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: index < 3 ? "#075c3a" : colors.bgAlt }}>
              {index < 3 ? <AppIcon name="checkmark" size={14} color="#ffffff" weight="bold" /> : null}
            </View>
            <Text style={{ color: colors.text, fontSize: 10 }}>{day}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ReviewRow({ document, last }: { document: ReadingDocument; last: boolean }) {
  return (
    <Link href={{ pathname: "/document/[id]", params: { id: document.id } }} asChild>
      <Pressable style={{ minHeight: 132, flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.rule }}>
        <EditorialImage document={document} style={{ width: 112, height: 110, borderRadius: radius.lg }} />
        <View style={{ flex: 1, minWidth: 0, gap: 7 }}>
          <Text selectable numberOfLines={1} style={{ color: colors.claret, fontSize: 12 }}>{document.sourceLabel ?? document.category}</Text>
          <Text selectable numberOfLines={2} style={{ color: colors.ink, fontSize: 18, lineHeight: 22, fontWeight: "700", ...displayText }}>{document.title}</Text>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
            <Metric icon="line.3.horizontal" value={document.keyPoints?.length ?? 0} label="Key points" />
            <Metric icon="rectangle.stack" value={document.flashcards?.length ?? 0} label="Flashcards" />
            <Metric icon="checkmark.circle.fill" value={document.quizQuestions?.length ?? 0} label="Practice" />
          </View>
        </View>
        <AppIcon name="chevron.right" size={20} color={colors.muted} />
      </Pressable>
    </Link>
  );
}

function Metric({ icon, value, label }: { icon: "line.3.horizontal" | "rectangle.stack" | "checkmark.circle.fill"; value: number; label: string }) {
  return (
    <View style={{ alignItems: "center", gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><AppIcon name={icon} size={15} color={colors.player} /><Text style={{ color: colors.player, fontSize: 12, fontWeight: "700" }}>{value}</Text></View>
      <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 9 }}>{label}</Text>
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text selectable style={{ color: colors.claret, fontSize: 14, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5 }}>{children}</Text>;
}

function hasLearningData(document: ReadingDocument): boolean {
  return Boolean(document.summary || document.keyPoints?.length || document.flashcards?.length || document.quizQuestions?.length);
}

function listenMinutes(document: ReadingDocument): number {
  return Math.max(1, Math.round((document.estimatedListeningSeconds ?? 1440) / 60));
}
