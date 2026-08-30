import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { Link, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ActionButton, EditorialHero, MetricLine, NavBackButton, QuietRule, Screen, SectionCard, SectionHeading, SettingsShortcut, colors, radius } from "@/components/mobile-design";
import { SourceForm } from "@/components/source-form";
import { defaultSettings, useReadingLibrary } from "@/hooks/use-reading-library";
import { sourceFromQuery, suggestSources, topicCategories, type SourceSuggestion } from "@/utils/source-suggestions";
import { documentTitleFromFilename, normalizeUploadFilename } from "@/utils/upload-filename";
import { getEntitlements } from "@/api/documents";

// This is a root-stack route so it can be opened from Home without exposing a tab.
export default function SourcesScreen() {
  const { getToken, isSignedIn } = useAuth();
  const router = useRouter();
  const { settings, sources, saveUrl, uploadPdf: uploadDocumentMutation, editSource, removeSource } = useReadingLibrary();
  const [query, setQuery] = useState("");
  const [selectedSuggestion, setSelectedSuggestion] = useState<SourceSuggestion | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [uploadedDocumentId, setUploadedDocumentId] = useState<string | null>(null);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ sourceName: "", websiteUrl: "", rssFeedUrl: "" });
  const suggestions = useMemo(() => suggestSources(query), [query]);
  const entitlementQuery = useQuery({
    queryKey: ["entitlements"],
    queryFn: async () => getEntitlements(await getToken()),
    enabled: Boolean(isSignedIn)
  });
  const entitlement = entitlementQuery.data;
  const uploadLimitBytes = entitlement?.limits.maxUploadBytes ?? 10 * 1024 * 1024;
  const openPremium = () => router.push({ pathname: "/premium", params: { source: "large_documents" } });

  async function addSource(input: { suggestion: SourceSuggestion; sourceType: "url" | "rss" }) {
    try {
      setFormError(null);
      setFormNotice(null);
      setUploadedDocumentId(null);
      const sourceUrl = input.sourceType === "rss" ? input.suggestion.rssUrl : input.suggestion.url;
      if (!sourceUrl) throw new Error("This source does not include an RSS feed.");
      const currentSettings = settings ?? defaultSettings();
      const result = await saveUrl.mutateAsync({
        url: sourceUrl,
        sourceType: input.sourceType,
        title: input.sourceType === "rss" ? `${input.suggestion.name} RSS feed` : input.suggestion.name,
        provider: currentSettings.provider,
        voice: currentSettings.voice,
        speed: currentSettings.speed
      });
      const importedCount = result.documents?.length ?? (result.document ? 1 : 0);
      setFormNotice(input.sourceType === "rss"
        ? `Subscribed to ${input.suggestion.name} and added ${importedCount} readable ${importedCount === 1 ? "item" : "items"}.`
        : `Added ${result.document?.title ?? input.suggestion.name} to your library.`);
      setQuery("");
      setSelectedSuggestion(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not add this source.");
    }
  }

  async function uploadDocument() {
    try {
      setFormError(null);
      setFormNotice(null);
      setUploadedDocumentId(null);
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/pdf",
          "application/epub+zip",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/msword",
          "text/plain",
          "text/markdown",
          "text/x-markdown",
          "application/rtf",
          "text/rtf"
        ],
        copyToCacheDirectory: true
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      if (asset.size && entitlement && asset.size > entitlement.limits.maxUploadBytes) {
        const planLabel = entitlement.isPremium ? "Premium" : "Free";
        const message = `This file is above your ${formatBytes(entitlement.limits.maxUploadBytes)} ${planLabel} upload limit.`;
        if (entitlement.isPremium) {
          setFormError(`${message} Choose a smaller file and try again.`);
          Alert.alert("File too large", message);
        } else {
          setFormError(`${message} Upgrade to ReadMate Premium for larger documents.`);
          Alert.alert("Premium document", message, [
            { text: "Not now", style: "cancel" },
            { text: "View Premium", onPress: openPremium }
          ]);
        }
        return;
      }
      const currentSettings = settings ?? defaultSettings();
      const filename = normalizeUploadFilename(asset.name);
      const uploaded = await uploadDocumentMutation.mutateAsync({
        file: { uri: asset.uri, name: filename, size: asset.size, mimeType: asset.mimeType },
        title: documentTitleFromFilename(filename),
        provider: currentSettings.provider,
        voice: currentSettings.voice,
        speed: currentSettings.speed
      });
      setFormNotice(`Uploaded ${uploaded.document.title}. It is ready in your library.`);
      setUploadedDocumentId(uploaded.document.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not upload this document.";
      setFormError(message);
      if (!entitlement?.isPremium && /premium|free plan limit|large document/i.test(message)) {
        Alert.alert("Premium document", message, [
          { text: "Not now", style: "cancel" },
          { text: "View Premium", onPress: openPremium }
        ]);
      }
    }
  }

  return (
    <Screen bottomNavigation="/(tabs)/more">
      <EditorialHero
        eyebrow="Add anything to your library"
        title="Add content"
        subtitle="Save links, subscribe to RSS, upload files, and keep recurring sources under control."
        right={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <NavBackButton label="Back to previous screen" />
            <SettingsShortcut />
          </View>
        }
      >
        <QuietRule />
        <View style={{ flexDirection: "row", gap: 14 }}>
          <MetricLine label="Sources" value={String(sources.length)} />
          <MetricLine label="Per feed" value={String(settings?.articlesPerFeed ?? defaultSettings().articlesPerFeed)} />
          <MetricLine label="Formats" value="7" />
        </View>
      </EditorialHero>

      <SourceForm
        query={query}
        suggestions={suggestions}
        selectedSuggestion={selectedSuggestion}
        busy={saveUrl.isPending || uploadDocumentMutation.isPending}
        error={formError}
        notice={formNotice}
        noticeActionLabel={uploadedDocumentId ? "Open" : undefined}
        uploadLimitLabel={`${entitlement?.isPremium ? "Premium uploads" : "Free uploads"} up to ${formatBytes(uploadLimitBytes)}`}
        showPremiumUpgrade={Boolean(entitlement && !entitlement.isPremium)}
        setQuery={(value) => {
          setFormError(null);
          setFormNotice(null);
          setUploadedDocumentId(null);
          setQuery(value);
          setSelectedSuggestion(suggestSources(value)[0] ?? sourceFromQuery(value));
        }}
        onSelectSuggestion={setSelectedSuggestion}
        onAddUrl={() => selectedSuggestion && addSource({ suggestion: selectedSuggestion, sourceType: "url" })}
        onAddRss={() => selectedSuggestion && addSource({ suggestion: selectedSuggestion, sourceType: "rss" })}
        onUploadDocument={uploadDocument}
        onNoticeAction={uploadedDocumentId
          ? () => router.push({ pathname: "/document/[id]", params: { id: uploadedDocumentId } })
          : undefined}
        onPremiumUpgrade={openPremium}
      />

      <Text selectable style={{ color: colors.muted, fontSize: 13, lineHeight: 19, paddingHorizontal: 4 }}>
        {entitlement?.isPremium
          ? `Premium document limits: up to ${formatBytes(entitlement.limits.maxUploadBytes)} and ${entitlement.limits.maxPdfPages} PDF pages.`
          : `Free document limits: up to ${formatBytes(entitlement?.limits.maxUploadBytes ?? 10 * 1024 * 1024)} and ${entitlement?.limits.maxPdfPages ?? 50} PDF pages. Larger documents require Premium.`}
      </Text>

      <SectionCard>
        <SectionHeading
          title="Feed settings"
          subtitle={`Show ${settings?.articlesPerFeed ?? defaultSettings().articlesPerFeed} articles per feed when RSS sources refresh.`}
        />
        <Link href="/settings" asChild>
          <ActionButton label="Open Settings" tone="navy" />
        </Link>
      </SectionCard>

      <SectionCard>
        <SectionHeading title="Subscribed sources" subtitle="Edit source details, topic tags, RSS URLs, and subscription status." />
        {sources.length ? sources.map((source) => (
          <View key={source.id} style={{ gap: 10, padding: 12, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border }}>
            <View style={{ gap: 3 }}>
              <Text selectable style={{ color: colors.ink, fontSize: 16, fontWeight: "900" }}>
                {source.sourceName}
              </Text>
              <Text selectable numberOfLines={1} style={{ color: colors.muted, fontSize: 13 }}>
                {source.sourceType.toUpperCase()} · {source.rssFeedUrl ?? source.websiteUrl ?? "Saved source"}
              </Text>
            </View>
            {editingSourceId === source.id ? (
              <View style={{ gap: 8 }}>
                <TextInput
                  value={editDraft.sourceName}
                  onChangeText={(sourceName) => setEditDraft((current) => ({ ...current, sourceName }))}
                  placeholder="Source name"
                  style={sourceInputStyle}
                />
                <TextInput
                  value={editDraft.websiteUrl}
                  onChangeText={(websiteUrl) => setEditDraft((current) => ({ ...current, websiteUrl }))}
                  placeholder="Website URL"
                  autoCapitalize="none"
                  keyboardType="url"
                  style={sourceInputStyle}
                />
                <TextInput
                  value={editDraft.rssFeedUrl}
                  onChangeText={(rssFeedUrl) => setEditDraft((current) => ({ ...current, rssFeedUrl }))}
                  placeholder="RSS feed URL"
                  autoCapitalize="none"
                  keyboardType="url"
                  style={sourceInputStyle}
                />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    disabled={editSource.isPending}
                    onPress={() => {
                      const websiteUrl = normalizeUrl(editDraft.websiteUrl);
                      const rssFeedUrl = normalizeUrl(editDraft.rssFeedUrl);
                      editSource.mutate({
                        sourceId: source.id,
                        input: {
                          sourceName: editDraft.sourceName.trim() || source.sourceName,
                          websiteUrl,
                          rssFeedUrl,
                          sourceType: rssFeedUrl ? "rss" : "website"
                        }
                      });
                      setEditingSourceId(null);
                    }}
                  style={{ flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.navy }}
                  >
                    <Text style={{ color: "#ffffff", fontWeight: "900" }}>Save changes</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setEditingSourceId(null)}
                    style={{ minHeight: 40, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.bgAlt }}
                  >
                    <Text style={{ color: colors.ink, fontWeight: "900" }}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {topicCategories.map((topic) => (
                <Pressable
                  key={topic}
                  onPress={() => editSource.mutate({ sourceId: source.id, input: { topics: [topic] } })}
                    style={{ paddingHorizontal: 11, minHeight: 32, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: source.topics.includes(topic) ? colors.navy : colors.surface, borderWidth: 1, borderColor: source.topics.includes(topic) ? colors.navy : colors.border }}
                >
                  <Text style={{ color: source.topics.includes(topic) ? "#ffffff" : colors.muted, fontWeight: "800", fontSize: 12 }}>{topic}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable
              disabled={editSource.isPending}
              onPress={() => {
                setEditingSourceId(source.id);
                setEditDraft({
                  sourceName: source.sourceName,
                  websiteUrl: source.websiteUrl ?? "",
                  rssFeedUrl: source.rssFeedUrl ?? ""
                });
              }}
              style={{ minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.bgAlt }}
            >
              <Text style={{ color: colors.ink, fontWeight: "900" }}>Edit source</Text>
            </Pressable>
            <Pressable
              disabled={removeSource.isPending}
              onPress={() => {
                Alert.alert("Remove source?", `Unsubscribe from ${source.sourceName}.`, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Remove", style: "destructive", onPress: () => removeSource.mutate(source.id) }
                ]);
              }}
              style={{ minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.redSoft }}
            >
              <Text style={{ color: colors.red, fontWeight: "900" }}>Remove source</Text>
            </Pressable>
          </View>
        )) : (
          <Text selectable style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>
            Search for a website name above to add your first source.
          </Text>
        )}
      </SectionCard>
    </Screen>
  );
}

const sourceInputStyle = {
  minHeight: 44,
  borderRadius: radius.md,
  borderCurve: "continuous" as const,
  borderWidth: 1,
  borderColor: colors.border,
  paddingHorizontal: 12,
  color: colors.ink,
  backgroundColor: colors.surface
};

function formatBytes(value: number): string {
  return `${Math.round(value / (1024 * 1024))} MB`;
}

function normalizeUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).href;
  } catch {
    return undefined;
  }
}
