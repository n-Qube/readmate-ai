import type { ExtensionSettings, LearningReview, ReadingChunk, ReadingDocument } from "../shared/types";
import { normalizeUploadedDocumentForDisplay } from "../shared/documentDisplay";

export type CartesiaVoiceOption = { id: string; name: string; description?: string; language?: string; gender?: string };

export type ReadMateEntitlement = {
  plan: "free" | "premium";
  isPremium: boolean;
  features: {
    largeDocuments: boolean;
    premiumAudio: boolean;
  };
  limits: {
    maxUploadBytes: number;
    maxDocumentCharacters: number;
    maxPdfPages: number;
    dailyTtsCharacters: number;
  };
};

export type UploadProgress = {
  loadedBytes: number;
  totalBytes: number;
  percent: number;
};

export type UploadDocumentOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
  onUploadComplete?: () => void;
};

export type CompactLibraryDocument = {
  documentId: string;
  title: string;
  sourceType: ReadingDocument["sourceType"];
  category: string;
  sourceLabel?: string;
  author?: string;
  status: NonNullable<ReadingDocument["status"]>;
  progressPercent: number;
  estimatedListeningSeconds?: number;
  createdAt: string;
  updatedAt: string;
  lastReadAt?: string;
};

export type CompactLibraryPage = {
  items: CompactLibraryDocument[];
  nextCursor?: string;
};

export class UploadRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly feature?: string,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "UploadRequestError";
  }
}

export const AUTH_REQUIRED_ERROR = "READMATE_AUTH_REQUIRED";
export const TTS_AUTH_REQUIRED_ERROR = AUTH_REQUIRED_ERROR;
const COMPACT_LIBRARY_PAGE_SIZE = 100;
const MAX_COMPACT_LIBRARY_PAGES = 100;

export async function getCartesiaVoices(apiBaseUrl: string, token: string | null): Promise<CartesiaVoiceOption[]> {
  if (!token) return [];
  const response = await fetch(`${apiBaseUrl}/api/tts/voices`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  throwIfAuthRequired(response);
  if (!response.ok) throw new Error("Unable to load Cartesia voices.");
  const payload = await response.json() as { voices?: CartesiaVoiceOption[] };
  return Array.isArray(payload.voices) ? payload.voices.filter((voice) => voice?.id && voice?.name) : [];
}

export async function requestTtsAudio(
  settings: ExtensionSettings,
  token: string | null,
  text: string
): Promise<Blob> {
  if (!token) throw new Error(TTS_AUTH_REQUIRED_ERROR);
  const response = await fetch(`${settings.apiBaseUrl}/api/tts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      text,
      provider: settings.ttsProvider,
      voice: settings.voice,
      speed: settings.speed,
      targetLanguage: settings.targetLanguage,
      instructions: settings.instructions
    })
  });
  throwIfAuthRequired(response);
  if (!response.ok) throw new Error(await apiErrorMessage(response, "Unable to generate speech"));
  return response.blob();
}

export async function listHistory(apiBaseUrl: string, token: string | null): Promise<ReadingDocument[]> {
  if (!token) return [];
  const response = await fetch(`${apiBaseUrl}/api/documents`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  throwIfAuthRequired(response);
  if (!response.ok) throw new Error("Unable to load reading history.");
  const documents = await response.json() as ReadingDocument[];
  return documents.map(normalizeUploadedDocumentForDisplay);
}

export async function listLibrary(apiBaseUrl: string, token: string | null): Promise<ReadingDocument[]> {
  if (!token) return [];
  const documents = new Map<string, ReadingDocument>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pageCount = 0;

  do {
    if (pageCount >= MAX_COMPACT_LIBRARY_PAGES) {
      throw new Error(`Unable to load your Library: it exceeds the ${COMPACT_LIBRARY_PAGE_SIZE * MAX_COMPACT_LIBRARY_PAGES}-item safety limit.`);
    }
    pageCount += 1;
    const url = new URL(`${apiBaseUrl}/api/documents/library-page`);
    url.searchParams.set("limit", String(COMPACT_LIBRARY_PAGE_SIZE));
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    throwIfAuthRequired(response);
    if (!response.ok) throw new Error("Unable to load your Library.");
    const page = await response.json() as CompactLibraryPage;
    if (!page || !Array.isArray(page.items) || (page.nextCursor !== undefined && typeof page.nextCursor !== "string")) {
      throw new Error("Unable to load your Library: ReadMate returned an invalid page.");
    }
    if (page.items.length > COMPACT_LIBRARY_PAGE_SIZE || (page.items.length === 0 && page.nextCursor)) {
      throw new Error("Unable to load your Library: ReadMate returned an invalid page boundary.");
    }
    for (const item of page.items) {
      if (!item?.documentId || !item.title || !item.sourceType || !item.createdAt || !item.updatedAt) {
        throw new Error("Unable to load your Library: ReadMate returned an invalid item.");
      }
      documents.set(item.documentId, compactLibraryDocument(item));
    }
    cursor = page.nextCursor;
    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw new Error("Unable to load your Library: ReadMate returned a repeated page.");
      }
      seenCursors.add(cursor);
    }
  } while (cursor);

  return [...documents.values()].map(normalizeUploadedDocumentForDisplay);
}

export async function getRemoteDocument(apiBaseUrl: string, token: string, documentId: string): Promise<ReadingDocument> {
  const response = await fetchWithRetry(`${apiBaseUrl}/api/documents/${encodeURIComponent(documentId)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  throwIfAuthRequired(response);
  if (!response.ok) throw new Error(await apiErrorMessage(response, "Unable to open this Library item."));
  return normalizeUploadedDocumentForDisplay(await response.json() as ReadingDocument);
}

export async function getRemoteSettings(apiBaseUrl: string, token: string): Promise<ExtensionSettings> {
  const response = await fetch(`${apiBaseUrl}/api/settings`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  throwIfAuthRequired(response);
  if (!response.ok) throw new Error("Unable to load synced settings.");
  const settings = await response.json();
  return {
    ttsProvider: settings.provider,
    voice: settings.voice,
    speed: settings.speed,
    instructions: settings.tone ?? "calm and clear",
    targetLanguage: settings.targetLanguage ?? "en",
    autoScroll: settings.autoScroll,
    highlightMode: settings.highlightMode,
    preferredContentTypes: settings.preferredContentTypes,
    apiBaseUrl
  };
}

export async function getRemoteEntitlement(apiBaseUrl: string, token: string): Promise<ReadMateEntitlement> {
  const response = await fetch(`${apiBaseUrl}/api/entitlements`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  throwIfAuthRequired(response);
  if (!response.ok) throw new Error(await apiErrorMessage(response, "Unable to check your document limit."));
  return response.json() as Promise<ReadMateEntitlement>;
}

export async function saveRemoteSettings(settings: ExtensionSettings, token: string): Promise<void> {
  const response = await fetch(`${settings.apiBaseUrl}/api/settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      provider: settings.ttsProvider,
      voice: settings.voice,
      speed: settings.speed,
      tone: settings.instructions,
      targetLanguage: settings.targetLanguage,
      autoScroll: settings.autoScroll,
      highlightMode: settings.highlightMode,
      preferredContentTypes: settings.preferredContentTypes
    })
  });
  throwIfAuthRequired(response);
  if (!response.ok) throw new Error("Unable to save synced settings.");
}

export async function createSyncedDocument(
  apiBaseUrl: string,
  token: string,
  chunks: ReadingChunk[],
  settings: ExtensionSettings
): Promise<ReadingDocument> {
  const first = chunks[0];
  const sourceUrl = safeHttpUrl(first?.pageUrl);
  const canonicalUrl = sourceUrl;
  const payload = {
    title: first?.title ?? "Untitled reading",
    sourceType: first?.sourceType ?? "document",
    sourceUrl,
    canonicalUrl,
    category: categoryForSource(first?.sourceType),
    sourceLabel: sourceLabelForUrl(sourceUrl),
    thumbnailUrl: safeHttpUrl(first?.thumbnailUrl),
    author: first?.author,
    description: first?.description,
    estimatedListeningSeconds: estimateListeningSeconds(chunks, settings.speed),
    provider: settings.ttsProvider,
    voice: settings.voice,
    speed: settings.speed,
    progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 },
    blocks: chunks.map((chunk, index) => ({
      orderIndex: index,
      blockType: index === 0 && chunk.text.length < 180 ? "heading" : "paragraph",
      text: chunk.text,
      sourceSelector: chunk.elementSelector,
      sourcePageNumber: chunk.pageNumber
    }))
  };
  const existing = await findExistingDocument(apiBaseUrl, token, payload);
  if (existing) return existing;

  const sourceDocument = await createDocumentFromSourceUrl(apiBaseUrl, token, payload, settings);
  if (sourceDocument) return sourceDocument;

  const capturedDocument = await createDocumentFromCapturedText(apiBaseUrl, token, chunks, payload, settings);
  if (capturedDocument) return capturedDocument;

  if (shouldUseCapturedContentPipeline(payload.sourceType, payload.sourceUrl)) {
    throw new Error("Unable to save captured page text.");
  }

  const response = await fetchWithRetry(`${apiBaseUrl}/api/documents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  throwIfAuthRequired(response);
  if (!response.ok) throw new Error(await apiErrorMessage(response, "Unable to sync this document."));
  return response.json();
}

async function createDocumentFromSourceUrl(
  apiBaseUrl: string,
  token: string,
  payload: {
    title: string;
    sourceType: ReadingChunk["sourceType"];
    sourceUrl?: string;
  },
  settings: ExtensionSettings
): Promise<ReadingDocument | null> {
  if (!payload.sourceUrl || !shouldUseServerContentPipeline(payload.sourceType)) return null;
  const response = await fetchWithRetry(`${apiBaseUrl}/api/content/save-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      url: payload.sourceUrl,
      sourceType: payload.sourceType === "rss" ? "rss" : payload.sourceType === "news" ? "news" : "webpage",
      title: payload.title,
      provider: settings.ttsProvider,
      voice: settings.voice,
      speed: settings.speed
    })
  });
  throwIfAuthRequired(response);
  if (!response.ok) return null;
  const result = await response.json();
  return result.document ?? result.documents?.[0] ?? null;
}

function shouldUseServerContentPipeline(sourceType: ReadingChunk["sourceType"]): boolean {
  return sourceType === "webpage" || sourceType === "url" || sourceType === "rss" || sourceType === "news" || sourceType === "document";
}

function shouldUseCapturedContentPipeline(sourceType: ReadingChunk["sourceType"], _sourceUrl?: string): boolean {
  return sourceType === "webpage" || sourceType === "url" || sourceType === "selection" || sourceType === "news" || sourceType === "document";
}

async function createDocumentFromCapturedText(
  apiBaseUrl: string,
  token: string,
  chunks: ReadingChunk[],
  payload: {
    title: string;
    sourceType: ReadingChunk["sourceType"];
    sourceUrl?: string;
    thumbnailUrl?: string;
    author?: string;
    description?: string;
  },
  settings: ExtensionSettings
): Promise<ReadingDocument | null> {
  if (!chunks.length) return null;
  if (payload.sourceType === "pdf" || payload.sourceType === "ocr") return null;
  const text = chunks.map((chunk) => chunk.text.trim()).filter(Boolean).join("\n\n").slice(0, 1_000_000);
  if (!text) return null;

  const response = await fetchWithRetry(`${apiBaseUrl}/api/content/save-selection`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      title: payload.title,
      text,
      sourceUrl: payload.sourceUrl,
      sourceType: payload.sourceType === "selection" ? "selection" : payload.sourceType === "news" ? "news" : "webpage",
      thumbnailUrl: payload.thumbnailUrl,
      author: payload.author,
      description: payload.description,
      provider: settings.ttsProvider,
      voice: settings.voice,
      speed: settings.speed
    })
  });
  throwIfAuthRequired(response);
  if (!response.ok) throw new Error(await apiErrorMessage(response, "Unable to save captured page text."));
  const result = await response.json();
  const document = result.document ?? result.documents?.[0] ?? (result.id ? result : null);
  if (!document) {
    throw new Error("Unable to save captured page text: sync API returned no document.");
  }
  return document;
}

export async function uploadPdfDocument(
  apiBaseUrl: string,
  token: string,
  file: File,
  settings: ExtensionSettings,
  title = file.name.replace(/\.pdf$/i, ""),
  options: UploadDocumentOptions = {}
): Promise<ReadingDocument> {
  const form = new FormData();
  form.append("title", title);
  form.append("provider", settings.ttsProvider);
  form.append("voice", settings.voice);
  form.append("speed", String(settings.speed));
  form.append("file", file, file.name);
  return uploadDocumentForm(`${apiBaseUrl}/api/content/upload-pdf`, token, file, form, options);
}

function uploadDocumentForm(
  url: string,
  token: string,
  file: File,
  form: FormData,
  options: UploadDocumentOptions
): Promise<ReadingDocument> {
  if (options.signal?.aborted) return Promise.reject(createAbortError());

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    const cleanup = () => options.signal?.removeEventListener("abort", handleSignalAbort);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const handleSignalAbort = () => xhr.abort();

    xhr.open("POST", url, true);
    xhr.timeout = 5 * 60 * 1000;
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (!options.onProgress) return;
      const ratio = event.lengthComputable && event.total > 0
        ? Math.min(1, Math.max(0, event.loaded / event.total))
        : 0;
      const loadedBytes = Math.min(file.size, Math.round(file.size * ratio));
      options.onProgress({
        loadedBytes,
        totalBytes: file.size,
        percent: file.size > 0 ? Math.round((loadedBytes / file.size) * 100) : 0
      });
    };
    xhr.upload.onload = () => {
      // Once the bytes have reached ReadMate, extraction can legitimately take
      // longer than the transfer timeout. Do not time out and encourage a
      // duplicate retry while the server may still be creating the Library item.
      xhr.timeout = 0;
      options.onProgress?.({ loadedBytes: file.size, totalBytes: file.size, percent: 100 });
      options.onUploadComplete?.();
    };

    xhr.onload = () => {
      const body = parseXhrJson(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        const document = body?.document as ReadingDocument | undefined;
        if (!document) {
          finish(() => reject(new UploadRequestError("Unable to upload this PDF: ReadMate returned no Library item.", xhr.status)));
          return;
        }
        finish(() => resolve(document));
        return;
      }

      const code = stringValue(body?.code);
      const feature = stringValue(body?.feature);
      if (xhr.status === 401 || (xhr.status === 403 && code !== "PREMIUM_REQUIRED")) {
        finish(() => reject(new Error(AUTH_REQUIRED_ERROR)));
        return;
      }
      const detail = stringValue(body?.error);
      const retryAfter = parseRetryAfter(xhr.getResponseHeader("Retry-After"));
      finish(() => reject(new UploadRequestError(
        joinApiErrorMessage("Unable to upload this PDF.", detail),
        xhr.status,
        code,
        feature,
        retryAfter
      )));
    };
    xhr.onerror = () => finish(() => reject(new UploadRequestError("Unable to upload this PDF: network connection failed.", 0)));
    xhr.ontimeout = () => finish(() => reject(new UploadRequestError("Unable to upload this PDF: the request timed out. Please retry.", 408)));
    xhr.onabort = () => finish(() => reject(createAbortError()));

    options.signal?.addEventListener("abort", handleSignalAbort, { once: true });
    xhr.send(form);
  });
}

function estimateListeningSeconds(chunks: ReadingChunk[], speed: number): number {
  const words = chunks.reduce((count, chunk) => count + chunk.text.trim().split(/\s+/).filter(Boolean).length, 0);
  return Math.max(30, Math.round((words / 160) * 60 / Math.max(0.5, speed)));
}

export async function updateSyncedProgress(
  apiBaseUrl: string,
  token: string,
  documentId: string,
  chunkIndex: number,
  totalChunks: number,
  settings: ExtensionSettings,
  percent = totalChunks ? Math.round((chunkIndex / totalChunks) * 100) : 0,
  sentenceIndex = 0
): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/documents/${encodeURIComponent(documentId)}/progress`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      progress: {
        blockIndex: chunkIndex,
        characterOffset: 0,
        sentenceIndex,
        percent: clampPercent(percent)
      },
      provider: settings.ttsProvider,
      voice: settings.voice,
      speed: settings.speed
    })
  });
  throwIfAuthRequired(response);
  if (!response.ok) throw new Error("Unable to sync reading progress.");
}

export async function clearRemoteDocumentHistory(apiBaseUrl: string, token: string, documentId: string): Promise<ReadingDocument> {
  const response = await fetch(`${apiBaseUrl}/api/documents/${encodeURIComponent(documentId)}/history`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  throwIfAuthRequired(response);
  if (!response.ok) throw new Error("Unable to clear this history item.");
  return response.json();
}

export async function deleteRemoteLearningData(apiBaseUrl: string, token: string, documentId: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/learning/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  throwIfAuthRequired(response);
  if (response.status === 404) return;
  if (!response.ok) throw new Error(await apiErrorMessage(response, "Unable to remove learning data."));
}

export async function clearRemoteHistory(apiBaseUrl: string, token: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/documents/history`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  throwIfAuthRequired(response);
  if (!response.ok) throw new Error("Unable to clear reading history.");
}

export async function deleteRemoteDocument(apiBaseUrl: string, token: string, documentId: string): Promise<boolean> {
  const response = await fetch(`${apiBaseUrl}/api/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  throwIfAuthRequired(response);
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(await apiErrorMessage(response, "Unable to delete this library item."));
  return true;
}

export type LearningGenerationOptions = {
  flashcardCount?: number;
  quizCount?: number;
  targetLanguage?: ExtensionSettings["targetLanguage"];
  mode?: "summary" | "flashcards" | "quiz";
};

export type LearningGenerationResult = {
  document: ReadingDocument;
  fallback: boolean;
  syncPending: boolean;
};

export async function generateDocumentLearning(
  apiBaseUrl: string,
  token: string,
  documentId: string,
  options: LearningGenerationOptions = {}
): Promise<LearningGenerationResult> {
  const { mode = "summary", ...generationOptions } = options;
  const response = await fetch(`${apiBaseUrl}/api/learning/${encodeURIComponent(documentId)}/${mode}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(generationOptions)
  });
  throwIfAuthRequired(response);
  if (!response.ok) throw new Error(await apiErrorMessage(response, "Could not generate Study material"));
  const result = await response.json();
  return {
    document: result.document,
    fallback: Boolean(result.fallback),
    syncPending: Boolean(result.syncPending)
  };
}

export async function getDocumentLearningReview(apiBaseUrl: string, token: string, documentId: string): Promise<LearningReview> {
  const response = await fetch(`${apiBaseUrl}/api/learning/${encodeURIComponent(documentId)}/review`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  throwIfAuthRequired(response);
  if (!response.ok) throw new Error(await apiErrorMessage(response, "Unable to load study review."));
  return response.json();
}

export async function markRemoteFlashcardReview(
  apiBaseUrl: string,
  token: string,
  documentId: string,
  flashcardId: string,
  reviewStatus: "known" | "needs_review"
): Promise<LearningReview["flashcards"][number]> {
  const response = await fetch(`${apiBaseUrl}/api/learning/${encodeURIComponent(documentId)}/flashcards/${encodeURIComponent(flashcardId)}/review`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ reviewStatus })
  });
  throwIfAuthRequired(response);
  if (!response.ok) throw new Error(await apiErrorMessage(response, "Unable to update flashcard review."));
  return response.json();
}

export async function submitRemoteQuizAttempt(
  apiBaseUrl: string,
  token: string,
  documentId: string,
  answers: Record<string, string>
): Promise<LearningReview["quizAttempts"][number]> {
  const response = await fetch(`${apiBaseUrl}/api/learning/${encodeURIComponent(documentId)}/quiz/attempts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ answers })
  });
  throwIfAuthRequired(response);
  if (!response.ok) throw new Error(await apiErrorMessage(response, "Unable to submit quiz attempt."));
  return response.json();
}

export async function askDocumentQuestion(
  apiBaseUrl: string,
  token: string,
  documentId: string,
  question: string,
  targetLanguage: ExtensionSettings["targetLanguage"] = "en"
): Promise<{ answer: string; citedSections: string[] }> {
  const response = await fetch(`${apiBaseUrl}/api/learning/${encodeURIComponent(documentId)}/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ question, targetLanguage })
  });
  throwIfAuthRequired(response);
  if (!response.ok) throw new Error(await apiErrorMessage(response, "Unable to answer this question."));
  return response.json();
}

async function findExistingDocument(
  apiBaseUrl: string,
  token: string,
  payload: {
    title: string;
    sourceType: ReadingChunk["sourceType"];
    sourceUrl?: string;
    canonicalUrl?: string;
    sourceLabel?: string;
  }
): Promise<ReadingDocument | null> {
  const documents = await listHistory(apiBaseUrl, token).catch((caught) => {
    if (isAuthRequiredError(caught)) throw caught;
    return [];
  });
  const normalizedSourceUrl = normalizeUrlForMatch(payload.sourceUrl);
  const normalizedCanonicalUrl = normalizeUrlForMatch(payload.canonicalUrl);
  const normalizedTitle = normalizeTitle(payload.title);

  return documents.find((document) => {
    if (document.sourceType !== payload.sourceType) return false;
    const documentSourceUrl = normalizeUrlForMatch(document.sourceUrl);
    if (normalizedCanonicalUrl && documentSourceUrl === normalizedCanonicalUrl) return true;
    if (normalizedSourceUrl && documentSourceUrl === normalizedSourceUrl) return true;
    return !normalizedSourceUrl && normalizeTitle(document.title) === normalizedTitle && document.sourceLabel === payload.sourceLabel;
  }) ?? null;
}

function categoryForSource(sourceType: ReadingChunk["sourceType"] | undefined): string {
  if (sourceType === "pdf") return "Documents";
  if (sourceType === "rss" || sourceType === "news") return "Feeds";
  if (sourceType === "webpage" || sourceType === "url") return "Websites";
  return "Saved";
}

function sourceLabelForUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function safeHttpUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function normalizeUrlForMatch(url: string | undefined): string | undefined {
  const safeUrl = safeHttpUrl(url);
  if (!safeUrl) return undefined;
  const parsed = new URL(safeUrl);
  parsed.hash = "";
  parsed.searchParams.sort();
  return parsed.href.replace(/\/$/, "");
}

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function compactLibraryDocument(item: CompactLibraryDocument): ReadingDocument {
  return {
    id: item.documentId,
    userId: "synced",
    title: item.title,
    sourceType: item.sourceType,
    category: item.category,
    sourceLabel: item.sourceLabel,
    author: item.author,
    status: item.status,
    estimatedListeningSeconds: item.estimatedListeningSeconds,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastReadAt: item.lastReadAt,
    progress: { percent: item.progressPercent },
    // Full playback data is deliberately absent from Library pages. App.tsx
    // hydrates the single owned document only after an explicit Open/Play action.
    voice: "",
    speed: 1
  };
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

export async function fetchWithRetry(input: RequestInfo | URL, init: RequestInit, attempts = 3): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const retryableMethod = method === "GET" || method === "HEAD" || method === "OPTIONS";
  const maxAttempts = retryableMethod ? attempts : 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (!shouldRetryResponse(response) || attempt === maxAttempts) return response;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw error;
    }
    await wait(150 * attempt);
  }
  throw lastError instanceof Error ? lastError : new Error("Network request failed.");
}

function shouldRetryResponse(response: Response): boolean {
  return [408, 429, 500, 502, 503, 504].includes(response.status);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

async function apiErrorMessage(response: Response, fallback: string): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await response.json().catch(() => undefined);
    return body?.error ? joinApiErrorMessage(fallback, body.error) : fallback;
  }
  const text = await response.text().catch(() => "");
  return text ? joinApiErrorMessage(fallback, text) : fallback;
}

function joinApiErrorMessage(fallback: string, detail: unknown): string {
  const prefix = fallback.trim().replace(/[\s:;,.!?]+$/g, "");
  const message = typeof detail === "string" ? detail.trim() : "";
  return message ? `${prefix}: ${message}` : fallback;
}

function parseXhrJson(responseText: string): Record<string, unknown> | undefined {
  if (!responseText.trim()) return undefined;
  try {
    const parsed = JSON.parse(responseText);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : undefined;
}

function createAbortError(): DOMException {
  return new DOMException("Upload cancelled.", "AbortError");
}

function throwIfAuthRequired(response: Response): void {
  if (response.redirected || response.status === 401 || response.status === 403) {
    throw new Error(AUTH_REQUIRED_ERROR);
  }
}

function isAuthRequiredError(caught: unknown): boolean {
  return caught instanceof Error && caught.message === AUTH_REQUIRED_ERROR;
}
