import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { AppIcon } from "@/components/app-icon";
import { EditorialImage } from "@/components/editorial-image";
import { BottomNavigation, BrandLockup, EmptyCard, NavBackButton, colors, displayText, radius, tabletContentMaxWidth, useResponsiveLayout } from "@/components/mobile-design";
import { PlaybackBar } from "@/components/playback-bar";
import { useReadingLibrary } from "@/hooks/use-reading-library";
import { usePlaybackManager } from "@/playback/playback-manager";
import type { ReadingDocument } from "@/types";
import { libraryFilters, librarySortLabels, matchesLibraryFilter, matchesLibrarySearch, nextLibrarySort, sortLibraryDocuments, type LibraryFilter, type LibrarySort } from "@/utils/library-filters";

export default function LibraryScreen() {
  const router = useRouter();
  const { documents, documentsQuery, settings, saveSettings } = useReadingLibrary();
  const playback = usePlaybackManager();
  const { isTablet } = useResponsiveLayout();
  const [filter, setFilter] = useState<LibraryFilter>("All");
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [playRequest, setPlayRequest] = useState(0);
  const [playerHeight, setPlayerHeight] = useState(0);

  const [sort, setSort] = useState<LibrarySort>("recent");
  const filteredDocuments = useMemo(
    () => sortLibraryDocuments(documents.filter((document) => matchesLibraryFilter(document, filter) && matchesLibrarySearch(document, searchQuery)), sort),
    [documents, filter, searchQuery, sort]
  );
  const activeDocument = useMemo(() => {
    const globalDocument = playback.activeDocument;
    return (
      documents.find((document) => document.id === globalDocument?.id) ??
      globalDocument ??
      documents.find((document) => document.id === selectedDocumentId) ??
      filteredDocuments[0] ??
      documents[0]
    );
  }, [documents, filteredDocuments, playback.activeDocument, selectedDocumentId]);
  const listBottomPadding = activeDocument ? Math.max(isTablet ? 260 : 300, playerHeight + 180) : 136;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        key={isTablet ? "tablet-library" : "phone-library"}
        data={filteredDocuments}
        numColumns={isTablet ? 2 : 1}
        columnWrapperStyle={isTablet ? { gap: 14 } : undefined}
        keyExtractor={(document) => document.id}
        refreshControl={<RefreshControl refreshing={documentsQuery.isRefetching} onRefresh={documentsQuery.refetch} />}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ width: "100%", maxWidth: tabletContentMaxWidth, alignSelf: "center", paddingHorizontal: isTablet ? 28 : 18, paddingTop: isTablet ? 22 : 10, paddingBottom: listBottomPadding, gap: isTablet ? 14 : 0 }}
        ListHeaderComponent={
          <View style={{ gap: 22, marginBottom: 16 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <NavBackButton label="Back to home" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)")} />
              <BrandLockup />
              <HeaderButton label={searchVisible ? "Close search" : "Search library"} icon={searchVisible ? "xmark" : "magnifyingglass"} onPress={() => { setSearchVisible((value) => !value); if (searchVisible) setSearchQuery(""); }} />
            </View>

            <View style={{ gap: 7 }}>
              <Text selectable style={{ color: colors.ink, fontSize: 31, lineHeight: 36, fontWeight: "700", ...displayText }}>Your library</Text>
              <Text selectable style={{ color: colors.text, fontSize: 16, lineHeight: 23 }}>Saved reads & listens, ready when you are.</Text>
            </View>

            {searchVisible ? (
              <View style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                <AppIcon name="magnifyingglass" size={19} color={colors.muted} />
                <TextInput autoFocus value={searchQuery} onChangeText={setSearchQuery} placeholder="Search your library" placeholderTextColor={colors.faint} style={{ flex: 1, color: colors.ink, fontSize: 15 }} />
              </View>
            ) : null}

            <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
              {libraryFilters.map((item) => {
                const selected = item === filter;
                return (
                  <Pressable key={item} accessibilityRole="button" accessibilityLabel={item} accessibilityState={{ selected }} onPress={() => setFilter(item)} style={{ flex: item === "Podcasts" ? 1.15 : 1, minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: radius.lg, backgroundColor: selected ? colors.player : colors.surface, borderWidth: 1, borderColor: selected ? colors.player : colors.border }}>
                    <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: selected ? "#fffdf8" : colors.text, fontSize: 12, fontWeight: "700" }}>{item === "Documents" ? "Docs" : item}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Sort library: ${librarySortLabels[sort]}`}
                accessibilityHint="Changes the library order"
                onPress={() => setSort(nextLibrarySort)}
                style={{ width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                <AppIcon name="line.3.horizontal" size={19} color={colors.text} />
              </Pressable>
            </View>
            <Text selectable style={{ marginTop: -12, color: colors.muted, fontSize: 12.5, fontWeight: "600" }}>Sorted by: {librarySortLabels[sort]}</Text>

            {documentsQuery.isLoading ? <ActivityIndicator color={colors.blue} /> : null}
          </View>
        }
        ListEmptyComponent={!documentsQuery.isLoading ? <EmptyCard title="No content in this category" body="Save an article, podcast, PDF, Word file, EPUB, or other document to see it here." /> : null}
        renderItem={({ item, index }) => (
          <LibraryRow
            document={item}
            first={isTablet || index === 0}
            last={isTablet || index === filteredDocuments.length - 1}
            onPlay={() => {
              playback.selectDocument(item);
              setSelectedDocumentId(item.id);
              setPlayRequest((current) => current + 1);
            }}
            onOpen={() => {
              playback.selectDocument(item);
              router.push({ pathname: "/document/[id]", params: { id: item.id } });
            }}
          />
        )}
      />

      {activeDocument ? (
        <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 112, zIndex: 10, alignItems: "center", paddingHorizontal: isTablet ? 28 : 16 }}>
          <View onLayout={(event) => setPlayerHeight(event.nativeEvent.layout.height)} style={{ width: "100%", maxWidth: isTablet ? 720 : 560 }}>
            <PlaybackBar
              document={activeDocument}
              queue={filteredDocuments}
              autoPlayKey={playRequest}
              onDocumentChange={(nextDocument) => setSelectedDocumentId(nextDocument.id)}
              settings={settings}
              onSettingsChange={(next) => saveSettings.mutate(next)}
              settingsSaving={saveSettings.isPending}
              variant="compact"
            />
          </View>
        </View>
      ) : null}
      <BottomNavigation active="/(tabs)/library" />
    </View>
  );
}

function LibraryRow({ document, first, last, onPlay, onOpen }: { document: ReadingDocument; first: boolean; last: boolean; onPlay: () => void; onOpen: () => void }) {
  const minutes = Math.max(1, Math.round((document.estimatedListeningSeconds ?? 1440) / 60));
  return (
    <View style={{ flex: 1, minHeight: 132, flexDirection: "row", alignItems: "center", gap: 10, padding: 10, backgroundColor: colors.surface, borderWidth: 1, borderBottomWidth: last ? 1 : 0, borderColor: colors.border, borderTopLeftRadius: first ? radius.xl : 0, borderTopRightRadius: first ? radius.xl : 0, borderBottomLeftRadius: last ? radius.xl : 0, borderBottomRightRadius: last ? radius.xl : 0 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${document.title}`} onPress={onOpen} style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 14 }}>
        <EditorialImage document={document} style={{ width: 102, height: 108, borderRadius: radius.lg }} />
        <View style={{ flex: 1, minWidth: 0, gap: 7 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Text selectable numberOfLines={1} style={{ flex: 1, color: colors.claret, fontSize: 12, fontWeight: "600" }}>{document.sourceLabel ?? document.category}</Text>
            <AppIcon name="ellipsis" size={18} color={colors.muted} />
          </View>
          <Text selectable numberOfLines={2} style={{ color: colors.ink, fontSize: 19, lineHeight: 22, fontWeight: "700", ...displayText }}>{document.title}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <AppIcon name="headphones" size={15} color={colors.muted} />
            <Text selectable style={{ color: colors.muted, fontSize: 12 }}>{minutes} min</Text>
            <Text style={{ color: colors.faint }}>·</Text>
            <Text selectable style={{ color: colors.muted, fontSize: 12 }}>{Math.round(document.progress.percent)}%</Text>
          </View>
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Play ${document.title}`} onPress={onPlay} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: colors.blueChip }}>
        <AppIcon name="play.fill" size={21} color={colors.player} />
      </Pressable>
    </View>
  );
}

function HeaderButton({ label, icon, onPress }: { label: string; icon: "chevron.left" | "magnifyingglass" | "xmark"; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <AppIcon name={icon} size={21} color={colors.player} />
    </Pressable>
  );
}
