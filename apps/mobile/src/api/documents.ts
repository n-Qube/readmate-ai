import { Directory, File, Paths, UploadType } from "expo-file-system";
import { ApiError, apiBaseUrl, fetchJson } from "@/api/client";
import type { AskAiAnswer, GlobalLearningReview, LearningFlashcard, LearningQuizAttempt, LearningReview, ReadMateEntitlement, ReadingDocument, ReadingHighlight, ReadingNote, SourceSubscription, UserSettings } from "@/types";
import { screenshotMode } from "@/utils/screenshot-mode";
import { speechCacheFileKey } from "@/utils/speech-cache-key";
import { normalizeUploadedDocumentForDisplay } from "@/utils/upload-filename";

export async function getDocuments(token: string | null): Promise<ReadingDocument[]> {
  const documents = screenshotMode ? mockDocuments : await fetchJson<ReadingDocument[]>("/api/documents", token);
  return documents.map(normalizeUploadedDocumentForDisplay);
}

export async function getDocument(documentId: string, token: string | null): Promise<ReadingDocument> {
  const document = screenshotMode
    ? mockDocuments.find((item) => item.id === documentId) ?? mockDocuments[0]
    : await fetchJson<ReadingDocument>(`/api/documents/${encodeURIComponent(documentId)}`, token);
  return normalizeUploadedDocumentForDisplay(document);
}

export function updateDocumentProgress(
  documentId: string,
  token: string | null,
  progress: ReadingDocument["progress"]
): Promise<ReadingDocument> {
  if (screenshotMode) {
    const document = mockDocuments.find((item) => item.id === documentId) ?? mockDocuments[0];
    return Promise.resolve({ ...document, progress });
  }
  return fetchJson<ReadingDocument>(`/api/documents/${encodeURIComponent(documentId)}/progress`, token, {
    method: "PATCH",
    body: JSON.stringify({ progress })
  });
}

export type UpdateDocumentInput = Partial<Pick<ReadingDocument, "title" | "sourceUrl" | "canonicalUrl" | "category" | "sourceLabel" | "thumbnailUrl" | "author" | "description">>;

export function updateDocument(documentId: string, token: string | null, input: UpdateDocumentInput): Promise<ReadingDocument> {
  return fetchJson<ReadingDocument>(`/api/documents/${encodeURIComponent(documentId)}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function clearDocumentHistory(documentId: string, token: string | null): Promise<ReadingDocument> {
  if (screenshotMode) return Promise.resolve(mockDocuments.find((item) => item.id === documentId) ?? mockDocuments[0]);
  return fetchJson<ReadingDocument>(`/api/documents/${encodeURIComponent(documentId)}/history`, token, {
    method: "DELETE"
  });
}

export function clearReadingHistory(token: string | null): Promise<{ count: number }> {
  if (screenshotMode) return Promise.resolve({ count: 3 });
  return fetchJson<{ count: number }>("/api/documents/history", token, {
    method: "DELETE"
  });
}

export function deleteDocument(documentId: string, token: string | null): Promise<void> {
  if (screenshotMode) return Promise.resolve();
  return fetchJson<void>(`/api/documents/${encodeURIComponent(documentId)}`, token, {
    method: "DELETE"
  });
}

export type CreateDocumentInput = {
  title: string;
  sourceType: ReadingDocument["sourceType"];
  sourceUrl?: string;
  canonicalUrl?: string;
  category: string;
  sourceLabel?: string;
  thumbnailUrl?: string;
  author?: string;
  description?: string;
  estimatedListeningSeconds?: number;
  provider: ReadingDocument["provider"];
  voice: string;
  speed: number;
  blocks: Array<{ blockType?: ReadingDocument["blocks"][number]["blockType"]; text: string }>;
};

export function createDocument(token: string | null, input: CreateDocumentInput): Promise<ReadingDocument> {
  if (screenshotMode) return Promise.resolve(mockDocuments[0]);
  return fetchJson<ReadingDocument>("/api/documents", token, {
    method: "POST",
    body: JSON.stringify({
      ...input,
      progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 }
    })
  });
}

export type SaveUrlInput = {
  url: string;
  sourceType: "url" | "rss" | "webpage" | "news" | "website";
  title?: string;
  provider: ReadingDocument["provider"];
  voice: string;
  speed: number;
};

export type SaveUrlResult = {
  document?: ReadingDocument;
  documents?: ReadingDocument[];
  source?: SourceSubscription;
};

export function saveUrlContent(token: string | null, input: SaveUrlInput): Promise<SaveUrlResult> {
  if (screenshotMode) return Promise.resolve({ document: mockDocuments[0], source: mockSources[0] });
  return fetchJson<SaveUrlResult>("/api/content/save-url", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function uploadPdfDocument(
  token: string | null,
  file: { uri: string; name: string; size?: number; mimeType?: string },
  input: { title: string; provider: ReadingDocument["provider"]; voice: string; speed: number }
): Promise<{ document: ReadingDocument }> {
  if (screenshotMode) return Promise.resolve({ document: mockDocuments[1] });
  // Keep the selected file in the native filesystem upload path. React Native's
  // FormData implementation copies Expo File objects through its Blob encoder;
  // on iOS that can surface a Node Buffer and fail before the request is sent.
  // Expo's multipart UploadTask streams the file URL directly and adds the
  // accompanying fields without moving document bytes through JavaScript.
  const uploadFile = new File(file.uri);
  const response = await uploadFile.upload(`${apiBaseUrl}/api/content/upload-pdf`, {
    httpMethod: "POST",
    uploadType: UploadType.MULTIPART,
    fieldName: "file",
    mimeType: file.mimeType,
    sessionType: "foreground",
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    parameters: {
      title: input.title,
      provider: input.provider,
      voice: input.voice,
      speed: String(input.speed)
    }
  });

  let payload: { document?: ReadingDocument; error?: string } | undefined;
  try {
    payload = JSON.parse(response.body) as { document?: ReadingDocument; error?: string };
  } catch {
    payload = undefined;
  }
  if (response.status < 200 || response.status >= 300 || !payload?.document) {
    throw new ApiError(payload?.error ?? `Document upload failed with ${response.status}`, response.status);
  }

  return { document: normalizeUploadedDocumentForDisplay(payload.document) };
}

export function getSources(token: string | null): Promise<SourceSubscription[]> {
  if (screenshotMode) return Promise.resolve(mockSources);
  return fetchJson<SourceSubscription[]>("/api/sources", token);
}

export function updateSource(
  sourceId: string,
  token: string | null,
  input: Partial<Pick<SourceSubscription, "sourceName" | "websiteUrl" | "rssFeedUrl" | "sourceType" | "topics" | "isSubscribed">>
): Promise<SourceSubscription> {
  if (screenshotMode) return Promise.resolve({ ...mockSources[0], ...input, id: sourceId });
  return fetchJson<SourceSubscription>(`/api/sources/${encodeURIComponent(sourceId)}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function deleteSource(sourceId: string, token: string | null): Promise<void> {
  if (screenshotMode) return Promise.resolve();
  return fetchJson<void>(`/api/sources/${encodeURIComponent(sourceId)}`, token, {
    method: "DELETE"
  });
}

export function getUserSettings(token: string | null): Promise<UserSettings> {
  if (screenshotMode) return Promise.resolve(mockSettings);
  return fetchJson<UserSettings>("/api/settings", token);
}

export function getEntitlements(token: string | null): Promise<ReadMateEntitlement> {
  if (screenshotMode) {
    return Promise.resolve({
      plan: "free",
      isPremium: false,
      features: { largeDocuments: false, premiumAudio: false },
      limits: { maxUploadBytes: 10 * 1024 * 1024, maxDocumentCharacters: 100_000, maxPdfPages: 50, dailyTtsCharacters: 25_000 }
    });
  }
  return fetchJson<ReadMateEntitlement>("/api/entitlements", token);
}

export function refreshEntitlements(token: string | null): Promise<ReadMateEntitlement> {
  if (screenshotMode) return getEntitlements(token);
  return fetchJson<ReadMateEntitlement>("/api/entitlements/refresh", token, {
    method: "POST"
  });
}

export function updateUserSettings(token: string | null, settings: Omit<UserSettings, "userId" | "updatedAt">): Promise<UserSettings> {
  if (screenshotMode) return Promise.resolve({ ...settings, userId: "screenshot-user", updatedAt: new Date().toISOString() });
  return fetchJson<UserSettings>("/api/settings", token, {
    method: "PUT",
    body: JSON.stringify(settings)
  });
}

export type TtsVoiceOption = {
  id: string;
  name: string;
  description?: string;
  language?: string;
  gender?: string;
};

export function getNotes(token: string | null, documentId: string): Promise<ReadingNote[]> {
  if (screenshotMode) return Promise.resolve(mockNotes.filter((item) => item.documentId === documentId));
  return fetchJson<ReadingNote[]>(`/api/notes?documentId=${encodeURIComponent(documentId)}`, token);
}

export function createNote(
  token: string | null,
  input: { documentId: string; noteText: string; blockIndex?: number; sentenceIndex?: number; highlightId?: string }
): Promise<ReadingNote> {
  if (screenshotMode) return Promise.resolve({ ...mockNotes[0], id: `note-${Date.now()}`, ...input, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  return fetchJson<ReadingNote>("/api/notes", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function deleteNote(token: string | null, noteId: string): Promise<void> {
  if (screenshotMode) return Promise.resolve();
  return fetchJson<void>(`/api/notes/${encodeURIComponent(noteId)}`, token, {
    method: "DELETE"
  });
}

export function getHighlights(token: string | null, documentId: string): Promise<ReadingHighlight[]> {
  if (screenshotMode) return Promise.resolve(mockHighlights.filter((item) => item.documentId === documentId));
  return fetchJson<ReadingHighlight[]>(`/api/highlights?documentId=${encodeURIComponent(documentId)}`, token);
}

export function createHighlight(
  token: string | null,
  input: {
    documentId: string;
    blockId?: string;
    blockIndex: number;
    sentenceIndex?: number;
    highlightText: string;
    highlightType: ReadingHighlight["highlightType"];
  }
): Promise<ReadingHighlight> {
  if (screenshotMode) return Promise.resolve({ ...mockHighlights[0], id: `highlight-${Date.now()}`, ...input, userId: "screenshot-user", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  return fetchJson<ReadingHighlight>("/api/highlights", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getLearningReview(token: string | null, documentId: string): Promise<LearningReview> {
  if (screenshotMode) return Promise.resolve(mockLearningReviews[documentId] ?? mockLearningReviews[mockDocuments[0].id]);
  return fetchJson<LearningReview>(`/api/learning/${encodeURIComponent(documentId)}/review`, token);
}

export function getLearningKeyPoints(token: string | null, documentId: string): Promise<string[]> {
  if (screenshotMode) return Promise.resolve(mockLearningReviews[documentId]?.keyPoints ?? mockLearningReviews[mockDocuments[0].id].keyPoints);
  return fetchJson<string[]>(`/api/learning/${encodeURIComponent(documentId)}/key-points`, token);
}

export function getLearningFlashcards(token: string | null, documentId: string): Promise<LearningFlashcard[]> {
  if (screenshotMode) return Promise.resolve(mockLearningReviews[documentId]?.flashcards ?? mockLearningReviews[mockDocuments[0].id].flashcards);
  return fetchJson<LearningFlashcard[]>(`/api/learning/${encodeURIComponent(documentId)}/flashcards`, token);
}

export function getLearningQuiz(token: string | null, documentId: string): Promise<LearningReview["quizQuestions"]> {
  if (screenshotMode) return Promise.resolve(mockLearningReviews[documentId]?.quizQuestions ?? mockLearningReviews[mockDocuments[0].id].quizQuestions);
  return fetchJson<LearningReview["quizQuestions"]>(`/api/learning/${encodeURIComponent(documentId)}/quiz`, token);
}

export function deleteLearningData(token: string | null, documentId: string): Promise<void> {
  if (screenshotMode) return Promise.resolve();
  return fetchJson<void>(`/api/learning/${encodeURIComponent(documentId)}`, token, {
    method: "DELETE"
  });
}

export function getGlobalLearningReview(token: string | null): Promise<GlobalLearningReview> {
  if (screenshotMode) return Promise.resolve(mockGlobalLearningReview);
  return fetchJson<GlobalLearningReview>("/api/learning/review", token);
}

export type LearningGenerationOptions = {
  flashcardCount?: number;
  quizCount?: number;
  targetLanguage?: UserSettings["targetLanguage"];
};

export function generateDocumentLearning(
  token: string | null,
  documentId: string,
  options: LearningGenerationOptions = {}
): Promise<{ document: ReadingDocument; syncPending?: boolean }> {
  if (screenshotMode) return Promise.resolve({ document: mockDocuments.find((item) => item.id === documentId) ?? mockDocuments[0] });
  return fetchJson<{ document: ReadingDocument; syncPending?: boolean }>(`/api/learning/${encodeURIComponent(documentId)}/summary`, token, {
    method: "POST",
    body: JSON.stringify(options)
  });
}

export function markFlashcardReview(
  token: string | null,
  documentId: string,
  flashcardId: string,
  reviewStatus: LearningFlashcard["reviewStatus"]
): Promise<LearningFlashcard> {
  if (screenshotMode) {
    const card = mockLearningReviews[documentId]?.flashcards.find((item) => item.id === flashcardId) ?? mockLearningReviews[mockDocuments[0].id].flashcards[0];
    return Promise.resolve({ ...card, reviewStatus });
  }
  return fetchJson<LearningFlashcard>(`/api/learning/${encodeURIComponent(documentId)}/flashcards/${encodeURIComponent(flashcardId)}/review`, token, {
    method: "PATCH",
    body: JSON.stringify({ reviewStatus })
  });
}

export function submitQuizAttempt(token: string | null, documentId: string, answers: Record<string, string>): Promise<LearningQuizAttempt> {
  if (screenshotMode) return Promise.resolve(mockLearningReviews[documentId]?.quizAttempts[0] ?? mockLearningReviews[mockDocuments[0].id].quizAttempts[0]);
  return fetchJson<LearningQuizAttempt>(`/api/learning/${encodeURIComponent(documentId)}/quiz/attempts`, token, {
    method: "POST",
    body: JSON.stringify({ answers })
  });
}

export function askDocumentQuestion(
  token: string | null,
  documentId: string,
  question: string,
  targetLanguage: UserSettings["targetLanguage"] = "en"
): Promise<AskAiAnswer> {
  if (screenshotMode) {
    return Promise.resolve({
      answer: `Short answer: ${question || "this item"} is answered from the saved document context, with cited sections available for review.`,
      citedSections: ["Executive summary", "Key findings"]
    });
  }
  return fetchJson<AskAiAnswer>(`/api/learning/${encodeURIComponent(documentId)}/ask`, token, {
    method: "POST",
    body: JSON.stringify({ question, targetLanguage })
  });
}

export type CreateSpeechAudioFileInput = {
  userId: string;
  cacheKey: string;
  text: string;
  provider: ReadingDocument["provider"];
  voice: string;
  speed: number;
  targetLanguage?: UserSettings["targetLanguage"];
  instructions?: string;
};

const speechFilePromises = new Map<string, Promise<string>>();
const SPEECH_AUDIO_CACHE_VERSION = "v4-neutral-rate";

export async function createSpeechAudioFile(token: string | null, input: CreateSpeechAudioFileInput): Promise<string> {
  if (screenshotMode) throw new ApiError("Audio playback is disabled in screenshot mode.", 503);
  const scopedCacheKey = `${SPEECH_AUDIO_CACHE_VERSION}-${input.userId}-${input.cacheKey}`;
  const fileStem = `readmate-${speechCacheFileKey(scopedCacheKey)}`;
  const cachedFile = existingSpeechAudioFile(fileStem);
  if (cachedFile) return cachedFile.uri;

  const inFlight = speechFilePromises.get(scopedCacheKey);
  if (inFlight) return inFlight;

  const request = (async () => {
    const response = await fetch(`${apiBaseUrl}/api/tts`, {
      method: "POST",
      headers: {
        Accept: "audio/mpeg,audio/wav,audio/mp4,audio/aac,application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        text: input.text,
        provider: input.provider,
        voice: input.voice,
        speed: input.speed,
        targetLanguage: input.targetLanguage ?? "en",
        instructions: input.instructions
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => undefined);
      throw new ApiError(error?.error ?? `TTS request failed with ${response.status}`, response.status);
    }

    const audioBytes = new Uint8Array(await response.arrayBuffer());
    const file = new File(Paths.cache, `${fileStem}.${speechAudioExtension(response.headers.get("content-type"))}`);
    file.create({ intermediates: true, overwrite: true });
    file.write(audioBytes);
    return file.uri;
  })();

  speechFilePromises.set(scopedCacheKey, request);
  try {
    return await request;
  } finally {
    speechFilePromises.delete(scopedCacheKey);
  }
}

export async function createSpeechCastUrl(token: string | null, input: CreateSpeechAudioFileInput): Promise<string> {
  if (screenshotMode) throw new ApiError("Casting is disabled in screenshot mode.", 503);
  const response = await fetch(`${apiBaseUrl}/api/tts/cast`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      text: input.text,
      provider: input.provider,
      voice: input.voice,
      speed: input.speed,
      targetLanguage: input.targetLanguage ?? "en",
      instructions: input.instructions
    })
  });
  const body = await response.json().catch(() => ({})) as { url?: string; error?: string };
  if (!response.ok || !body.url) throw new ApiError(body.error ?? `Cast preparation failed with ${response.status}`, response.status);
  if (!body.url.startsWith("https://")) throw new ApiError("ReadMate refused an insecure cast audio URL.", 502);
  return body.url;
}

export function clearSpeechAudioCache(): void {
  speechFilePromises.clear();
  try {
    for (const entry of new Directory(Paths.cache).list()) {
      if (entry instanceof File && entry.name.startsWith("readmate-") && /\.(mp3|wav|m4a)$/i.test(entry.name)) {
        entry.delete();
      }
    }
  } catch {
    // Cache cleanup is best effort; user-scoped filenames still prevent reuse.
  }
}

function existingSpeechAudioFile(fileStem: string): File | null {
  for (const extension of ["mp3", "wav", "m4a"] as const) {
    const file = new File(Paths.cache, `${fileStem}.${extension}`);
    if (file.exists) return file;
  }
  return null;
}

function speechAudioExtension(contentType: string | null): "mp3" | "wav" | "m4a" {
  const normalized = contentType?.toLowerCase() ?? "";
  if (normalized.includes("wav") || normalized.includes("wave")) return "wav";
  if (normalized.includes("mp4") || normalized.includes("m4a") || normalized.includes("aac")) return "m4a";
  return "mp3";
}

const now = new Date("2026-05-27T20:30:00.000Z").toISOString();

const mockDocuments: ReadingDocument[] = [
  {
    id: "article-a2ui",
    userId: "screenshot-user",
    title: "Designing Cities for a Sustainable Tomorrow",
    sourceType: "webpage",
    sourceUrl: "https://a2ui.org",
    canonicalUrl: "https://a2ui.org",
    category: "Cities & Environment",
    sourceLabel: "The Atlantic",
    author: "Maya Okafor",
    description: "How thoughtful urban design can create greener, healthier, more resilient communities.",
    status: "in_progress",
    summary: "A practical look at how greener buildings, walkable streets, and renewable power can make cities more resilient.",
    keyPoints: ["Green buildings cool dense neighborhoods.", "Walkable streets strengthen communities.", "Renewable energy improves urban resilience."],
    flashcards: [
      { front: "What does A2UI send?", back: "Declarative component descriptions." },
      { front: "Where should ReadMate use A2UI?", back: "Inside dynamic learning responses." },
      { front: "Why avoid arbitrary code?", back: "It protects users and keeps rendering predictable." },
      { front: "What can A2UI render?", back: "Cards, lists, quiz previews, definitions, and actions." }
    ],
    quizQuestions: [
      { question: "A2UI should replace the whole app UI.", answer: "False" },
      { question: "What makes A2UI safer?", answer: "It uses approved components." },
      { question: "Where is it useful in ReadMate?", answer: "The Learn tab and study screens." }
    ],
    estimatedListeningSeconds: 1140,
    createdAt: "2026-05-26T10:15:00.000Z",
    updatedAt: now,
    lastReadAt: now,
    progress: { blockIndex: 1, characterOffset: 120, sentenceIndex: 2, percent: 42 },
    provider: "google",
    voice: "en-US-Neural2-F",
    speed: 1.25,
    blocks: [
      { id: "a2ui-0", orderIndex: 0, blockType: "heading", text: "Designing cities for a sustainable tomorrow" },
      { id: "a2ui-1", orderIndex: 1, blockType: "paragraph", text: "Cities are living systems. Thoughtful design can make daily life healthier while reducing heat, pollution, and energy use." },
      { id: "a2ui-2", orderIndex: 2, blockType: "paragraph", text: "The most resilient neighborhoods combine trees, efficient buildings, public transport, and welcoming public space." }
    ]
  },
  {
    id: "article-alone",
    userId: "screenshot-user",
    title: "The Art of Being Alone",
    sourceType: "webpage",
    sourceUrl: "https://aeon.co/essays/the-art-of-being-alone",
    category: "Psychology",
    sourceLabel: "Aeon",
    description: "Why solitude can create room for attention, reflection, and a richer inner life.",
    status: "in_progress",
    estimatedListeningSeconds: 1920,
    createdAt: "2026-05-25T12:00:00.000Z",
    updatedAt: "2026-05-27T18:10:00.000Z",
    lastReadAt: "2026-05-27T18:10:00.000Z",
    progress: { blockIndex: 1, characterOffset: 80, sentenceIndex: 1, percent: 42 },
    provider: "google",
    voice: "en-US-Neural2-F",
    speed: 1.25,
    blocks: [
      { id: "alone-0", orderIndex: 0, blockType: "heading", text: "The art of being alone" },
      { id: "alone-1", orderIndex: 1, blockType: "paragraph", text: "Solitude is not simply the absence of company; it can be a deliberate practice of attention." }
    ]
  },
  {
    id: "article-teams",
    userId: "screenshot-user",
    title: "What Great Teams Have in Common",
    sourceType: "webpage",
    sourceUrl: "https://hbr.org/great-teams",
    category: "Leadership",
    sourceLabel: "Harvard Business Review",
    description: "The habits that help talented people trust one another and do their best work.",
    status: "in_progress",
    estimatedListeningSeconds: 1440,
    createdAt: "2026-05-24T12:00:00.000Z",
    updatedAt: "2026-05-27T17:10:00.000Z",
    lastReadAt: "2026-05-27T17:10:00.000Z",
    progress: { blockIndex: 0, characterOffset: 30, sentenceIndex: 0, percent: 15 },
    provider: "google",
    voice: "en-US-Neural2-D",
    speed: 1,
    blocks: [
      { id: "teams-0", orderIndex: 0, blockType: "heading", text: "What great teams have in common" },
      { id: "teams-1", orderIndex: 1, blockType: "paragraph", text: "Strong teams share clarity, trust, and a practical habit of learning together." }
    ]
  },
  {
    id: "article-rainforest",
    userId: "screenshot-user",
    title: "Inside the World’s Rainforests",
    sourceType: "webpage",
    sourceUrl: "https://nationalgeographic.com/rainforests",
    category: "Nature",
    sourceLabel: "National Geographic",
    description: "A journey through the layered ecosystems that sustain extraordinary biodiversity.",
    status: "in_progress",
    estimatedListeningSeconds: 2160,
    createdAt: "2026-05-23T12:00:00.000Z",
    updatedAt: "2026-05-27T16:10:00.000Z",
    lastReadAt: "2026-05-27T16:10:00.000Z",
    progress: { blockIndex: 1, characterOffset: 140, sentenceIndex: 1, percent: 90 },
    provider: "google",
    voice: "en-US-Neural2-F",
    speed: 1,
    blocks: [
      { id: "rain-0", orderIndex: 0, blockType: "heading", text: "Inside the world’s rainforests" },
      { id: "rain-1", orderIndex: 1, blockType: "paragraph", text: "Rainforests are layered habitats whose health shapes climate and biodiversity far beyond their borders." }
    ]
  },
  {
    id: "pdf-research",
    userId: "screenshot-user",
    title: "The Science of Creative Focus",
    sourceType: "webpage",
    sourceUrl: "https://aeon.co/essays/creative-focus",
    category: "Science & Psychology",
    sourceLabel: "Aeon",
    description: "How environment, attention, and rest shape our best ideas.",
    status: "in_progress",
    summary: "The packet explains research design, source evaluation, note-taking, and synthesis for academic reading.",
    keyPoints: ["Define a research question before reading.", "Track evidence quality.", "Summarize each section in your own words."],
    flashcards: [
      { front: "What is a research question?", back: "A focused question that guides evidence collection." },
      { front: "Why track sources?", back: "To verify credibility and support citations." },
      { front: "What is synthesis?", back: "Combining evidence into a coherent argument." }
    ],
    quizQuestions: [
      { question: "What should happen before deep reading?", answer: "Define a research question." },
      { question: "Why are notes useful?", answer: "They preserve evidence and interpretation." }
    ],
    estimatedListeningSeconds: 1440,
    createdAt: "2026-05-25T14:00:00.000Z",
    updatedAt: "2026-05-27T18:15:00.000Z",
    lastReadAt: "2026-05-27T18:15:00.000Z",
    progress: { blockIndex: 2, characterOffset: 50, sentenceIndex: 1, percent: 67 },
    provider: "google",
    voice: "en-US-Neural2-D",
    speed: 1,
    blocks: [
      { id: "pdf-0", orderIndex: 0, blockType: "heading", text: "The science of creative focus" },
      { id: "pdf-1", orderIndex: 1, blockType: "paragraph", text: "Creative focus grows when periods of deliberate attention are balanced with rest and reflection." },
      { id: "pdf-2", orderIndex: 2, blockType: "paragraph", text: "Our environment can protect attention by reducing needless context switching." }
    ]
  },
  {
    id: "rss-tech",
    userId: "screenshot-user",
    title: "Solar Cities: Powering Communities Sustainably",
    sourceType: "rss",
    sourceUrl: "https://example.com/feed.xml",
    category: "Energy",
    sourceLabel: "National Geographic",
    description: "How urban centers are harnessing renewable energy to build a cleaner future.",
    status: "in_progress",
    summary: "Cities are combining rooftop solar, storage, and smarter grids to make clean power dependable.",
    keyPoints: ["Rooftop solar uses existing urban space.", "Storage balances demand.", "Smarter grids strengthen resilience."],
    estimatedListeningSeconds: 360,
    createdAt: "2026-05-27T09:20:00.000Z",
    updatedAt: "2026-05-27T09:20:00.000Z",
    progress: { blockIndex: 0, characterOffset: 40, sentenceIndex: 0, percent: 15 },
    provider: "google",
    voice: "en-US-Neural2-J",
    speed: 1.5,
    blocks: [
      { id: "rss-0", orderIndex: 0, blockType: "heading", text: "Solar cities" },
      { id: "rss-1", orderIndex: 1, blockType: "paragraph", text: "Urban solar networks pair local generation with storage and smarter grids." }
    ]
  }
];

const mockSources: SourceSubscription[] = [
  {
    id: "source-a2ui",
    userId: "screenshot-user",
    sourceName: "A2UI",
    websiteUrl: "https://a2ui.org",
    rssFeedUrl: "https://a2ui.org/feed.xml",
    sourceType: "rss",
    topics: ["AI", "Technology"],
    isSubscribed: true,
    lastSyncedAt: now,
    createdAt: "2026-05-26T10:15:00.000Z",
    updatedAt: now
  },
  {
    id: "source-engadget",
    userId: "screenshot-user",
    sourceName: "Engadget",
    websiteUrl: "https://www.engadget.com",
    rssFeedUrl: "https://www.engadget.com/rss.xml",
    sourceType: "rss",
    topics: ["Technology"],
    isSubscribed: true,
    lastSyncedAt: "2026-05-27T09:20:00.000Z",
    createdAt: "2026-05-24T12:00:00.000Z",
    updatedAt: "2026-05-27T09:20:00.000Z"
  }
];

const mockSettings: UserSettings = {
  userId: "screenshot-user",
  provider: "google",
  voice: "en-US-Neural2-F",
  speed: 1.25,
  tone: "calm and clear",
  targetLanguage: "gaa",
  autoScroll: true,
  highlightMode: "paragraph",
  preferredContentTypes: ["webpage", "pdf", "rss", "url"],
  articlesPerFeed: 10,
  updatedAt: now
};

const mockFlashcards: LearningFlashcard[] = [
  { id: "fc-1", documentId: "article-a2ui", question: "What problem does A2UI solve?", answer: "It lets agents send structured interfaces safely across trust boundaries.", difficulty: "medium", reviewStatus: "needs_review", topicTag: "AI", createdAt: now, updatedAt: now },
  { id: "fc-2", documentId: "article-a2ui", question: "Why use approved components?", answer: "They keep AI-generated learning screens safe and consistent.", difficulty: "easy", reviewStatus: "known", topicTag: "UX", createdAt: now, updatedAt: now },
  { id: "fc-3", documentId: "article-a2ui", question: "Where should A2UI appear in ReadMate?", answer: "Only in dynamic learning responses inside Learn or Study.", difficulty: "easy", reviewStatus: "new", topicTag: "Product", createdAt: now, updatedAt: now }
];

const mockLearningReviews: Record<string, LearningReview> = {
  "article-a2ui": {
    documentId: "article-a2ui",
    summary: mockDocuments[0].summary,
    keyPoints: mockDocuments[0].keyPoints ?? [],
    topicTags: ["AI", "Learning", "UX"],
    flashcards: mockFlashcards,
    quizQuestions: [
      { id: "q-1", documentId: "article-a2ui", question: "A2UI uses arbitrary generated JavaScript for UI.", questionType: "true_false", options: ["True", "False"], correctAnswer: "False", explanation: "A2UI uses declarative component descriptions rendered by approved components.", topicTag: "Safety", createdAt: now, updatedAt: now },
      { id: "q-2", documentId: "article-a2ui", question: "Which ReadMate area should use A2UI?", questionType: "multiple_choice", options: ["Audio player", "Settings", "Learn tab", "Bottom navigation"], correctAnswer: "Learn tab", explanation: "The Learn tab contains dynamic AI learning responses.", topicTag: "Product", createdAt: now, updatedAt: now }
    ],
    quizAttempts: [
      {
        id: "attempt-1",
        documentId: "article-a2ui",
        answers: { "q-1": "False", "q-2": "Learn tab" },
        score: 100,
        total: 2,
        scoredTotal: 2,
        correct: 2,
        createdAt: now,
        results: [
          { questionId: "q-1", question: "A2UI uses arbitrary generated JavaScript for UI.", userAnswer: "False", correctAnswer: "False", explanation: "Correct. A2UI uses declarative data.", isCorrect: true, isScored: true },
          { questionId: "q-2", question: "Which ReadMate area should use A2UI?", userAnswer: "Learn tab", correctAnswer: "Learn tab", explanation: "Correct. Learning responses are dynamic.", isCorrect: true, isScored: true }
        ]
      }
    ],
    progress: { notesCount: 2, highlightsCount: 2, flashcardsReviewed: 1, quizAttempts: 1, bestQuizScore: 100 }
  }
};

mockLearningReviews["pdf-research"] = {
  ...mockLearningReviews["article-a2ui"],
  documentId: "pdf-research",
  summary: mockDocuments.find((document) => document.id === "pdf-research")?.summary,
  keyPoints: mockDocuments.find((document) => document.id === "pdf-research")?.keyPoints ?? [],
  topicTags: ["Research", "Academic writing"],
  flashcards: mockFlashcards.map((card, index) => ({ ...card, id: `pdf-fc-${index}`, documentId: "pdf-research" })),
  quizQuestions: mockLearningReviews["article-a2ui"].quizQuestions.map((question, index) => ({ ...question, id: `pdf-q-${index}`, documentId: "pdf-research" }))
};

mockLearningReviews["rss-tech"] = {
  ...mockLearningReviews["article-a2ui"],
  documentId: "rss-tech",
  summary: mockDocuments.find((document) => document.id === "rss-tech")?.summary,
  keyPoints: mockDocuments.find((document) => document.id === "rss-tech")?.keyPoints ?? [],
  topicTags: ["Technology", "Policy"],
  flashcards: [],
  quizQuestions: [],
  quizAttempts: []
};

const mockGlobalLearningReview: GlobalLearningReview = {
  documents: mockDocuments.map((document) => ({
    documentId: document.id,
    title: document.title,
    sourceType: document.sourceType,
    sourceLabel: document.sourceLabel,
    topicTags: mockLearningReviews[document.id]?.topicTags ?? [document.category],
    progressPercent: document.progress.percent,
    needsReview: mockLearningReviews[document.id]?.flashcards.filter((card) => card.reviewStatus === "needs_review").length ?? 0,
    quizAttempts: mockLearningReviews[document.id]?.quizAttempts.length ?? 0,
    bestQuizScore: mockLearningReviews[document.id]?.progress.bestQuizScore,
    updatedAt: document.updatedAt
  })),
  totals: {
    studied: 3,
    notes: 2,
    highlights: 2,
    flashcards: 6,
    flashcardsReviewed: 2,
    quizAttempts: 1,
    averageQuizScore: 88
  }
};

const mockNotes: ReadingNote[] = [
  { id: "note-1", userId: "screenshot-user", documentId: "article-a2ui", noteText: "Use structured cards for AI answers in the Learn tab.", blockIndex: 1, createdAt: now, updatedAt: now },
  { id: "note-2", userId: "screenshot-user", documentId: "pdf-research", noteText: "Turn the research methods section into quiz questions.", blockIndex: 2, createdAt: now, updatedAt: now }
];

const mockHighlights: ReadingHighlight[] = [
  { id: "highlight-1", userId: "screenshot-user", documentId: "article-a2ui", blockIndex: 1, sentenceIndex: 0, highlightText: "Declarative component descriptions keep agent-driven UI safe.", highlightType: "sentence", createdAt: now, updatedAt: now },
  { id: "highlight-2", userId: "screenshot-user", documentId: "pdf-research", blockIndex: 2, sentenceIndex: 1, highlightText: "Summarize each section in your own words.", highlightType: "paragraph", createdAt: now, updatedAt: now }
];
