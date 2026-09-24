import { useAuth } from "@clerk/expo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearDocumentHistory,
  clearReadingHistory,
  createDocument,
  deleteLearningData,
  deleteDocument,
  deleteSource,
  getDocuments,
  getSources,
  getUserSettings,
  saveUrlContent,
  updateDocument,
  updateDocumentProgress,
  updateSource,
  uploadPdfDocument,
  updateUserSettings
} from "@/api/documents";
import type { CreateDocumentInput, SaveUrlInput, UpdateDocumentInput } from "@/api/documents";
import type { ReadingDocument, SourceSubscription, UserSettings } from "@/types";
import { balanceFeedDocuments, dedupeDocuments, prependDocument } from "@/utils/document-list";
import { screenshotMode } from "@/utils/screenshot-mode";
import { withKnownBlocks } from "../utils/document-blocks";
import { settingsMutationOptions } from "./settings-mutation";

export function useReadingLibrary() {
  const { isSignedIn, getToken } = useAuth();
  const queryClient = useQueryClient();
  const canLoad = screenshotMode || Boolean(isSignedIn);

  const documentsQuery = useQuery({
    queryKey: ["documents"],
    queryFn: async () => getDocuments(await getToken()),
    enabled: canLoad
  });

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: async () => getUserSettings(await getToken()),
    enabled: canLoad
  });

  const sourcesQuery = useQuery({
    queryKey: ["sources"],
    queryFn: async () => getSources(await getToken()),
    enabled: canLoad
  });

  const saveSettings = useMutation(settingsMutationOptions(queryClient, async (next) => updateUserSettings(await getToken(), next)));

  const addDocument = useMutation({
    mutationFn: async (input: CreateDocumentInput) => createDocument(await getToken(), input),
    onSuccess: (document) => {
      queryClient.setQueryData<ReadingDocument[]>(["documents"], (current) => prependDocument(current ?? [], document));
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
    }
  });

  const saveUrl = useMutation({
    mutationFn: async (input: SaveUrlInput) => saveUrlContent(await getToken(), input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["sources"] });
    }
  });

  const uploadPdf = useMutation({
    mutationFn: async (input: {
      file: { uri: string; name: string; size?: number; mimeType?: string };
      title: string;
      provider: ReadingDocument["provider"];
      voice: string;
      speed: number;
    }) =>
      uploadPdfDocument(await getToken(), input.file, {
        title: input.title,
        provider: input.provider,
        voice: input.voice,
        speed: input.speed
      }),
    onSuccess: ({ document }) => {
      queryClient.setQueryData<ReadingDocument[]>(["documents"], (current) => prependDocument(current ?? [], document));
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
    }
  });

  const removeDocument = useMutation({
    mutationFn: async (documentId: string) => {
      await deleteLearningData(await getToken(), documentId).catch(() => undefined);
      await deleteDocument(documentId, await getToken());
      return documentId;
    },
    onSuccess: (documentId) => {
      queryClient.setQueryData<ReadingDocument[]>(["documents"], (current) => current?.filter((item) => item.id !== documentId));
      queryClient.removeQueries({ queryKey: ["document", documentId] });
      queryClient.invalidateQueries({ queryKey: ["learning-review"] });
    }
  });

  const editDocument = useMutation({
    mutationFn: async ({ documentId, input }: { documentId: string; input: UpdateDocumentInput }) =>
      updateDocument(documentId, await getToken(), input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["document", updated.id], updated);
      queryClient.setQueryData<ReadingDocument[]>(["documents"], (current) =>
        current?.map((item) => (item.id === updated.id ? updated : item))
      );
    }
  });

  const removeHistoryItem = useMutation({
    // History is playback activity only. Study data remains attached to the
    // saved Library item and is removed only by the explicit delete action.
    mutationFn: async (documentId: string) => clearDocumentHistory(documentId, await getToken()),
    onSuccess: (updated) => {
      queryClient.setQueryData(["document", updated.id], updated);
      queryClient.setQueryData<ReadingDocument[]>(["documents"], (current) =>
        current?.map((item) => (item.id === updated.id ? updated : item))
      );
      queryClient.invalidateQueries({ queryKey: ["learning-review"] });
    }
  });

  const clearHistory = useMutation({
    mutationFn: async () => clearReadingHistory(await getToken()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["learning-review"] });
    }
  });

  const editSource = useMutation({
    mutationFn: async ({ sourceId, input }: { sourceId: string; input: Partial<Pick<SourceSubscription, "sourceName" | "websiteUrl" | "rssFeedUrl" | "sourceType" | "topics" | "isSubscribed">> }) =>
      updateSource(sourceId, await getToken(), input),
    onSuccess: (updated) => {
      queryClient.setQueryData<SourceSubscription[]>(["sources"], (current) =>
        current?.map((item) => (item.id === updated.id ? updated : item))
      );
    }
  });

  const removeSource = useMutation({
    mutationFn: async (sourceId: string) => {
      await deleteSource(sourceId, await getToken());
      return sourceId;
    },
    onSuccess: (sourceId) => {
      queryClient.setQueryData<SourceSubscription[]>(["sources"], (current) => current?.filter((item) => item.id !== sourceId));
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    }
  });

  async function markProgress(document: ReadingDocument, progress: ReadingDocument["progress"]) {
    const response = await updateDocumentProgress(document.id, await getToken(), progress);
    const updated = withKnownBlocks(response, queryClient.getQueryData<ReadingDocument>(["document", document.id]) ?? document);
    // The per-document cache must always hold the full text.
    if (updated.blocks.length) queryClient.setQueryData(["document", document.id], updated);
    queryClient.setQueryData<ReadingDocument[]>(["documents"], (current) =>
      current?.map((item) => (item.id === updated.id ? updated : item))
    );
    return updated;
  }

  return {
    isSignedIn: canLoad,
    getToken,
    documents: balanceFeedDocuments(dedupeDocuments(documentsQuery.data ?? [])),
    documentsQuery,
    sources: sourcesQuery.data ?? [],
    sourcesQuery,
    settings: settingsQuery.data,
    settingsQuery,
    saveSettings,
    addDocument,
    saveUrl,
    uploadPdf,
    removeDocument,
    editDocument,
    removeHistoryItem,
    clearHistory,
    editSource,
    removeSource,
    markProgress
  };
}

export function defaultSettings(): Omit<UserSettings, "userId" | "updatedAt"> {
  return {
    provider: "google",
    voice: "en-US-Neural2-F",
    speed: 1,
    tone: "calm and clear",
    targetLanguage: "en",
    autoScroll: true,
    highlightMode: "paragraph",
    preferredContentTypes: ["webpage", "pdf", "rss", "url"],
    articlesPerFeed: 10
  };
}
