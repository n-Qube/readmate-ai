import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, RefreshControl, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon } from "@/components/app-icon";
import { ContentCard, formatDuration, estimateListeningSeconds } from "@/components/content-card";
import { BottomNavigation, EmptyCard, MetricTile, PageHeader, SectionCard, SectionHeading, SettingsShortcut, colors, radius, tabBarBottomInset } from "@/components/mobile-design";
import { PlaybackBar } from "@/components/playback-bar";
import { useReadingLibrary } from "@/hooks/use-reading-library";
import { usePlaybackManager } from "@/playback/playback-manager";

export default function HistoryScreen() {
  const { documents, documentsQuery, settings, saveSettings, removeHistoryItem, clearHistory } = useReadingLibrary();
  const playback = usePlaybackManager();
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [playRequest, setPlayRequest] = useState(0);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tablet = width >= 768;
  const history = useMemo(
    () => documents
      .filter((document) => Boolean(document.lastReadAt) || document.progress.percent > 0)
      .sort((a, b) => new Date(b.lastReadAt ?? b.updatedAt).getTime() - new Date(a.lastReadAt ?? a.updatedAt).getTime()),
    [documents]
  );
  const activeDocument = useMemo(
    () => history.find((document) => document.id === selectedDocumentId) ?? history[0],
    [history, selectedDocumentId]
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        style={{ flex: 1, backgroundColor: colors.bg }}
        data={history}
        keyExtractor={(item) => item.id}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={documentsQuery.isRefetching} onRefresh={documentsQuery.refetch} />}
        contentContainerStyle={{ width: "100%", maxWidth: tablet ? 1080 : 560, alignSelf: "center", paddingHorizontal: tablet ? 28 : 20, paddingTop: (tablet ? 22 : 8) + (Platform.OS === "android" ? insets.top : 0), paddingBottom: tabBarBottomInset, gap: tablet ? 24 : 18 }}
        ListHeaderComponent={
          <View style={{ gap: 18 }}>
            <PageHeader
              eyebrow="Listening activity"
              title="Recent"
              subtitle="Resume from saved progress without deleting saved library items."
              right={
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {history.length ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Manage recent activity"
                      disabled={clearHistory.isPending}
                      onPress={() => {
                        Alert.alert("Manage recent activity", "Clear listening progress while keeping saved library items?", [
                          { text: "Cancel", style: "cancel" },
                          { text: "Clear history", style: "destructive", onPress: () => clearHistory.mutate() }
                        ]);
                      }}
                      style={{
                        width: 44,
                        height: 44,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: radius.pill,
                        backgroundColor: colors.surface
                      }}
                    >
                      <AppIcon name="ellipsis" size={21} color={colors.ink} />
                    </Pressable>
                  ) : null}
                  <SettingsShortcut />
                </View>
              }
            />

            <PlaybackBar
              document={activeDocument}
              variant="compact"
              queue={history}
              autoPlayKey={playRequest}
              onDocumentChange={(nextDocument) => setSelectedDocumentId(nextDocument.id)}
              settings={settings}
              onSettingsChange={(next) => saveSettings.mutate(next)}
              settingsSaving={saveSettings.isPending}
            />

            <SectionCard>
              <SectionHeading title="Listening summary" />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <MetricTile label="Items" value={String(history.length)} tone="blue" />
                <MetricTile label="Completed" value={String(history.filter((item) => item.progress.percent >= 100).length)} tone="green" />
                <MetricTile label="Saved time" value={formatDuration(history.reduce((sum, item) => sum + estimateListeningSeconds(item), 0))} tone="amber" />
              </View>
            </SectionCard>

            {documentsQuery.isLoading ? <ActivityIndicator /> : null}
            {history.length === 0 && !documentsQuery.isLoading ? (
              <EmptyCard title="No listening activity yet" body="Read a page, selected text, PDF, or feed item to start building history." />
            ) : null}
            {history.length ? (
              <SectionHeading title="Timeline" subtitle="Each row keeps source, progress, remaining time, resume, and clear-history actions close together." />
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <ContentCard
            document={item}
            compact
            onPlay={(nextDocument) => {
              playback.selectDocument(nextDocument);
              setSelectedDocumentId(nextDocument.id);
              setPlayRequest((current) => current + 1);
            }}
            onDelete={(document) => {
              Alert.alert("Clear this item?", "Remove this item from recent activity without deleting it from your library?", [
                { text: "Cancel", style: "cancel" },
                { text: "Clear item", style: "destructive", onPress: () => removeHistoryItem.mutate(document.id) }
              ]);
            }}
            deleteLabel="Clear history"
          />
        )}
      />
      <BottomNavigation />
    </View>
  );
}
