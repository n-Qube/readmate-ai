import { BookOpen, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, FastForward, FileText, FolderOpen, GraduationCap, Headphones, HelpCircle, History as HistoryIcon, Layers, Library, List, Lock, LogOut, Menu, MessageCircle, Mic2, Minus, MoreVertical, Pause, Play, RefreshCw, Rewind, Rss, Search, Send, Settings, SkipBack, SkipForward, Sparkles, Square, Trash2, Upload, Volume2, WifiOff, X } from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { askDocumentQuestion, AUTH_REQUIRED_ERROR, clearRemoteDocumentHistory, clearRemoteHistory, createSyncedDocument, deleteRemoteDocument, deleteRemoteLearningData, generateDocumentLearning, getDocumentLearningReview, getRemoteDocument, getRemoteEntitlement, getRemoteSettings, listLibrary, markRemoteFlashcardReview, requestTtsAudio, saveRemoteSettings, submitRemoteQuizAttempt, TTS_AUTH_REQUIRED_ERROR, updateSyncedProgress, uploadPdfDocument, UploadRequestError, type ReadMateEntitlement } from "../api/client";
import { getAuthSession, signOut as clearManualSession, type AuthSession } from "../auth/authClient";
import { fileFromPdfResponse } from "../pdf/pdfDownload";
import { extractPdfChunks } from "../pdf/pdfText";
import { createInitialPlayerState, playerReducer } from "../player/playerMachine";
import { ReadMateLogo } from "../shared/ReadMateLogo";
import { normalizeUploadedDocumentForDisplay, normalizeUploadedDocumentsForDisplay } from "../shared/documentDisplay";
import { DEFAULT_SETTINGS, DEFAULT_VOICE_BY_PROVIDER, isPremiumProvider, loadSettings, PROVIDER_LABELS, saveSettings, SPEEDS, TARGET_LANGUAGES, TTS_PROVIDERS, VOICE_LABELS, voicesForProvider } from "../shared/settings";
import { canInjectIntoUrl, PENDING_READ_REQUEST_KEY, parsePendingReadRequest, resolveActiveReadableTab, resolveActiveTab, sendToActiveTab, sendToTab, type PendingReadRequest, type ReadmateMessage, type TabMessageResult } from "../shared/messages";
import type { ExtensionSettings, LearningReview, ReadingChunk, ReadingDocument } from "../shared/types";
import { splitBrowserSpeechSegments, type BrowserSpeechSegment } from "./browserSpeech";
import { getActiveHighlightTarget, type HighlightPlaybackPosition } from "./highlightSegments";
import { clearAllLocalHistory, clearLocalDocumentHistory, readingHistoryEntries } from "./historyView";
import { libraryEntries, matchesLibrarySearch } from "./libraryView";
import { mobileReadMateUrl } from "./mobileLink";
import { isLikelyPdfUrl, pdfSourceUrlFromTab } from "./pdfTab";
import { adjacentChunkIndex, type ChunkDirection } from "./playbackNavigation";
import { languageProviderLabel } from "./providerLabel";
import { parseSidePanelRoute, SIDE_PANEL_ROUTE_KEY, type SidePanelTab } from "./sidepanelRoute";
import { syntheticSpeechDisclosure, type SpeechSource } from "./speechDisclosure";
import { STUDY_AI_DISCLOSURE } from "./studyDisclosure";
import { resolveLearningTarget } from "./studyTarget";
import { deriveSyncState } from "./syncState";
import { estimateUploadRemainingSeconds, evaluateUploadCapacity, formatBytes, formatDuration, uploadElapsedSeconds, uploadPercent, uploadPlanSummary, type DocumentUploadStatus } from "./uploadStatus";

const LOCAL_HISTORY_KEY = "readmateLocalHistory";
type ActiveAction = "read-page" | "read-selection" | "save" | "upload-pdf" | "study" | "read-study" | "ask" | "settings" | "history" | null;
type ReadingOptions = { autoPlay?: boolean; action?: ActiveAction; sync?: boolean };
type PendingPdfUpload = { file: File; metadata: { title?: string; pageUrl?: string }; options: ReadingOptions };
type ExtensionTab = SidePanelTab;
type LearningActionMode = "summary" | "key-points" | "explain" | "flashcards" | "quiz" | "study";
type LearningErrorState = { message: string; documentId: string; mode: LearningActionMode };
type StudyFlashcard = { id?: string; front: string; back: string; reviewStatus?: "new" | "known" | "needs_review" };
type StudyQuizQuestion = { id?: string; question: string; answer: string; options?: string[]; correctAnswer?: string; explanation?: string };
type StudyPanelState = {
  documentId?: string;
  mode?: LearningActionMode | "ask";
  summary?: string;
  keyPoints?: string[];
  answer?: string;
  citedSections?: string[];
  flashcards?: StudyFlashcard[];
  quizQuestions?: StudyQuizQuestion[];
  lastQuestion?: string;
};
type LearningComponentAction = "save_note" | "create_flashcards" | "create_quiz" | "send_to_study";
type LearningUiComponent =
  | { component: "AnswerCard"; title: string; body: string }
  | { component: "SummaryCard"; title: string; body: string }
  | { component: "KeyPointsList"; title: string; items: string[] }
  | { component: "ExplanationCard"; title: string; body: string }
  | { component: "FlashcardPreview"; title: string; cards: StudyFlashcard[] }
  | { component: "QuizQuestionCard"; title: string; questions: StudyQuizQuestion[] }
  | { component: "SourceCard"; title: string; items: string[] }
  | { component: "ActionButtonGroup"; actions: Array<{ label: string; action: LearningComponentAction }> };

type ClerkBridge = {
  isConfigured: boolean;
  isLoaded: boolean;
  isSignedIn: boolean;
  userName: string;
  avatarUrl?: string;
  getToken: (options?: { skipCache?: boolean }) => Promise<string | null>;
  signOut?: () => Promise<void>;
  UserButton: ComponentType;
};

const TAB_CONFIG: { id: ExtensionTab; label: string; Icon: ComponentType<{ size?: number | string }> }[] = [
  { id: "read",     label: "Read",     Icon: Headphones },
  { id: "learn",    label: "Learn",    Icon: GraduationCap },
  { id: "library",  label: "Library",  Icon: Library },
  { id: "history",  label: "History",  Icon: HistoryIcon },
  { id: "settings", label: "Settings", Icon: Settings },
];

export function App({ clerk }: { clerk?: ClerkBridge }) {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [auth, setAuth] = useState<AuthSession | null>(null);
  const [chunks, setChunks] = useState<ReadingChunk[]>([]);
  const [history, setHistory] = useState<ReadingDocument[]>([]);
  const [player, setPlayer] = useState(createInitialPlayerState());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [entitlement, setEntitlement] = useState<ReadMateEntitlement | null>(null);
  const [uploadStatus, setUploadStatus] = useState<DocumentUploadStatus | null>(null);
  const [activeTab, setActiveTab] = useState<ExtensionTab>("read");
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [studyPanel, setStudyPanel] = useState<StudyPanelState>({});
  const [studyQuestion, setStudyQuestion] = useState("");
  const [learningCounts, setLearningCounts] = useState({ flashcardCount: 8, quizCount: 6 });
  const [learningError, setLearningError] = useState<LearningErrorState | null>(null);
  const [currentTabInfo, setCurrentTabInfo] = useState<{ title: string; url: string; favicon?: string } | null>(null);
  const [librarySearch, setLibrarySearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyFilter, setHistoryFilter] = useState<"all" | "in-progress" | "finished">("all");
  const [learnView, setLearnView] = useState<"hub" | "summary" | "keypoints" | "flashcards" | "quiz" | "quiz-result">("hub");
  const [cardIndex, setCardIndex] = useState(0);
  const [cardFlipped, setCardFlipped] = useState(false);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<boolean[]>([]);
  const [quizAnswerValues, setQuizAnswerValues] = useState<string[]>([]);
  const [quizSelected, setQuizSelected] = useState<number | null>(null);
  const [speechSource, setSpeechSource] = useState<SpeechSource>("cloud");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const audioObjectUrlRef = useRef<string | null>(null);
  const fallbackUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const playbackRunRef = useRef(0);
  const autoPlayNextChunksRef = useRef(true);
  const pendingChunkActionRef = useRef<ActiveAction>(null);
  const chunksRef = useRef<ReadingChunk[]>([]);
  const settingsRef = useRef<ExtensionSettings | null>(null);
  const authRef = useRef<AuthSession | null>(null);
  const playerRef = useRef(player);
  const lastHighlightKeyRef = useRef<string | null>(null);
  const processedReadRequestIdsRef = useRef(new Set<string>());
  const activeReadableTabIdRef = useRef<number | null>(null);
  const pendingReadTabIdRef = useRef<number | null>(null);
  const loadedSourceUrlRef = useRef<string | null>(null);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);
  const pdfDownloadAbortControllerRef = useRef<AbortController | null>(null);
  const pendingPdfUploadRef = useRef<PendingPdfUpload | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    chunksRef.current = chunks;
  }, [chunks]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!settings?.apiBaseUrl || !auth?.token) {
      setEntitlement(null);
      return;
    }
    let disposed = false;
    getRemoteEntitlement(settings.apiBaseUrl, auth.token)
      .then((next) => {
        if (!disposed) setEntitlement(next);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [settings?.apiBaseUrl, auth?.token]);

  useEffect(() => {
    authRef.current = auth;
  }, [auth]);

  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  useEffect(() => {
    Promise.all([loadSettings(), getAuthSession()])
      .then(([loadedSettings, session]) => {
        setSettings(loadedSettings);
        setAuth(session);
        refreshHistory(loadedSettings.apiBaseUrl, session.token).catch(() => undefined);
      })
      .catch((caught) => {
        console.warn("ReadMate startup fell back to local defaults.", caught);
        setSettings(DEFAULT_SETTINGS);
        setAuth({ isSignedIn: false, token: null, userName: "Anonymous reader" });
        setError("ReadMate started with local defaults because extension storage was not available.");
      });
  }, []);

  useEffect(() => {
    if (!clerk?.isConfigured || !clerk.isLoaded) return;
    clerk
      .getToken()
      .then((token) => {
        const session: AuthSession = {
          isSignedIn: clerk.isSignedIn,
          userName: clerk.userName,
          avatarUrl: clerk.avatarUrl,
          token
        };
        setAuth(session);
        if (settings && token) {
          getRemoteSettings(settings.apiBaseUrl, token)
            .then((remoteSettings) => {
              setSettings(remoteSettings);
              settingsRef.current = remoteSettings;
              return saveSettings(remoteSettings);
            })
            .catch(() => undefined);
          refreshHistory(settings.apiBaseUrl, token).catch(() => undefined);
        }
      })
      .catch((caught) => {
        console.warn("ReadMate Clerk session lookup failed; using local auth mode.", caught);
      });
  }, [clerk?.isConfigured, clerk?.isLoaded, clerk?.isSignedIn, clerk?.userName, settings?.apiBaseUrl]);

  useEffect(() => {
    let disposed = false;

    async function refreshActiveTabInfo(
      options: { clearStaleContent: boolean },
      target: { preferredTabId?: number; preferredWindowId?: number } = {}
    ) {
      const activeTab = await resolveActiveTab(target);
      const pdfSourceUrl = pdfSourceUrlFromTab(activeTab);
      const tab = activeTab && (canInjectIntoUrl(activeTab.url ?? "") || pdfSourceUrl)
        ? ({ ...activeTab, url: pdfSourceUrl ?? activeTab.url } as chrome.tabs.Tab)
        : undefined;
      if (disposed) return;
      activeReadableTabIdRef.current = tab?.id ?? null;
      const nextTabInfo = tabInfoFromTab(tab);
      setCurrentTabInfo(nextTabInfo);
      if (nextTabInfo) {
        setError((current) => isProtectedTabMessage(current) ? null : current);
        setNotice((current) => isProtectedTabMessage(current) ? null : current);
      }
      if (options.clearStaleContent && shouldResetLoadedArticleForTabChange(loadedSourceUrlRef.current, nextTabInfo?.url)) {
        resetLoadedArticleAfterTabChange(nextTabInfo);
      }
    }

    void refreshActiveTabInfo({ clearStaleContent: false });

    const handleActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      void refreshActiveTabInfo(
        { clearStaleContent: true },
        { preferredTabId: activeInfo.tabId, preferredWindowId: activeInfo.windowId }
      );
    };
    const handleUpdated = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      // A protected tab can navigate to a readable URL while its readable-tab
      // ref is null. URL changes must therefore re-resolve the current window.
      if (tabId !== activeReadableTabIdRef.current && !changeInfo.url) return;
      if (changeInfo.url || changeInfo.title || changeInfo.status === "loading" || changeInfo.status === "complete") {
        void refreshActiveTabInfo(
          { clearStaleContent: true },
          tabId === activeReadableTabIdRef.current ? { preferredTabId: tabId } : {}
        );
      }
    };
    const handleFocusChanged = (windowId: number) => {
      if (windowId === chrome.windows.WINDOW_ID_NONE) return;
      void refreshActiveTabInfo({ clearStaleContent: true }, { preferredWindowId: windowId });
    };

    chrome.tabs.onActivated.addListener(handleActivated);
    chrome.tabs.onUpdated.addListener(handleUpdated);
    chrome.windows?.onFocusChanged?.addListener(handleFocusChanged);

    return () => {
      disposed = true;
      chrome.tabs.onActivated.removeListener(handleActivated);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      chrome.windows?.onFocusChanged?.removeListener(handleFocusChanged);
    };
  }, []);

  useEffect(() => {
    const handleMessage = (message: unknown, sender: chrome.runtime.MessageSender) => {
      const request = parsePendingReadRequest(message);
      if (request) processReadRequest({ ...request, sourceTabId: sender.tab?.id ?? request.sourceTabId });
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [settings?.speed, settings?.voice, auth?.token]);

  useEffect(() => {
    chrome.storage.local.get(PENDING_READ_REQUEST_KEY)
      .then((stored) => processReadRequest(stored[PENDING_READ_REQUEST_KEY] as PendingReadRequest | undefined))
      .catch(() => undefined);

    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") return;
      const pendingRead = changes[PENDING_READ_REQUEST_KEY]?.newValue as PendingReadRequest | undefined;
      processReadRequest(pendingRead);
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, [settings?.speed, settings?.voice, auth?.token]);

  useEffect(() => {
    let disposed = false;

    const applyRequestedRoute = (value: unknown) => {
      const route = parseSidePanelRoute(value);
      if (!disposed && route) setActiveTab(route.tab);
      void chrome.storage.local.remove(SIDE_PANEL_ROUTE_KEY);
    };

    chrome.storage.local.get(SIDE_PANEL_ROUTE_KEY)
      .then((stored) => applyRequestedRoute(stored[SIDE_PANEL_ROUTE_KEY]))
      .catch(() => undefined);

    const handleRouteChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local" || !changes[SIDE_PANEL_ROUTE_KEY]?.newValue) return;
      applyRequestedRoute(changes[SIDE_PANEL_ROUTE_KEY].newValue);
    };
    chrome.storage.onChanged.addListener(handleRouteChange);
    return () => {
      disposed = true;
      chrome.storage.onChanged.removeListener(handleRouteChange);
    };
  }, []);

  async function beginReading(
    nextChunks: ReadingChunk[],
    options: ReadingOptions = { autoPlay: true },
    syncedDocument?: ReadingDocument
  ) {
    if (options.action) setActiveAction(options.action);
    try {
      if (!nextChunks.length) {
        chunksRef.current = [];
        setChunks([]);
        setError("ReadMate could not find readable text on this page. Try selecting text or use Read screen text.");
        return;
      }
      chunksRef.current = nextChunks;
      loadedSourceUrlRef.current = nextChunks[0]?.pageUrl ?? null;
      lastHighlightKeyRef.current = null;
      setChunks(nextChunks);
      let documentId: string = syncedDocument?.id ?? crypto.randomUUID();
      let startIndex = syncedDocument
        ? Math.min(
            syncedDocument.progress.blockIndex ?? syncedDocument.progress.chunkIndex ?? 0,
            Math.max(nextChunks.length - 1, 0)
          )
        : 0;
      const activeSettings = settingsRef.current;
      const token = await getCurrentSyncToken();
      if (!syncedDocument && options.sync !== false && activeSettings && token) {
        try {
          const synced = await createSyncedDocument(activeSettings.apiBaseUrl, token, nextChunks, activeSettings);
          documentId = synced.id;
          startIndex = Math.min(synced.progress.blockIndex ?? synced.progress.chunkIndex ?? 0, Math.max(nextChunks.length - 1, 0));
          await refreshHistory(activeSettings.apiBaseUrl, token);
        } catch (caught) {
          console.info("ReadMate document sync fell back to local playback.", caught);
          setError(documentSyncFallbackMessage(caught));
        }
      }
      setPlayer((state) =>
        ({
          ...playerReducer(state, {
            type: "LOAD_DOCUMENT",
            documentId,
            voice: settings?.voice,
            speed: settings?.speed
          }),
          currentChunkIndex: startIndex
        })
      );
      sendToActiveTab({ type: "SHOW_FLOATING_PLAYER", visible: true }).catch(() => undefined);
      if (nextChunks.length > 0 && options.autoPlay !== false) {
        const runId = playbackRunRef.current + 1;
        playbackRunRef.current = runId;
        window.setTimeout(() => {
          void playChunkAtIndex(startIndex, runId);
        }, 50);
      } else if (options.autoPlay === false) {
        setNotice("Saved to Library. Open ReadMate mobile to continue, or press Play to listen here.");
      }
    } finally {
      if (options.action) setActiveAction(null);
    }
  }

  function processReadRequest(request: PendingReadRequest | undefined) {
    if (!request?.requestId || processedReadRequestIdsRef.current.has(request.requestId)) return;
    if (Date.now() - request.createdAt > 60_000) return;
    const expectedTabId = pendingReadTabIdRef.current ?? activeReadableTabIdRef.current;
    if (request.sourceTabId && expectedTabId && request.sourceTabId !== expectedTabId) return;
    processedReadRequestIdsRef.current.add(request.requestId);
    pendingReadTabIdRef.current = null;
    setError(null);
    setNotice(null);
    if (request.error) {
      setActiveAction(null);
      setError(request.error);
      return;
    }
    const autoPlay = autoPlayNextChunksRef.current;
    const action = pendingChunkActionRef.current;
    autoPlayNextChunksRef.current = true;
    pendingChunkActionRef.current = null;
    setActiveTab("read");
    void beginReading(request.chunks, { autoPlay, action });
  }

  const currentChunk = chunks[player.currentChunkIndex];
  const UserButton = clerk?.UserButton;
  const percent = player.duration ? Math.round((player.currentTime / player.duration) * 100) : 0;
  const remaining = player.duration ? Math.max(0, Math.round((player.duration - player.currentTime) / player.speed)) : 0;
  const hasLoadedContent = chunks.length > 0;
  const activeHistoryDocument = useMemo(
    () => history.find((item) => item.id === player.currentDocumentId),
    [history, player.currentDocumentId]
  );
  const learningTarget = resolveLearningTarget(history, player.currentDocumentId, studyPanel.documentId);
  const syncState = deriveSyncState(auth, activeAction, error);
  const providerRouteLabel = settings
    ? languageProviderLabel(settings.targetLanguage, settings.ttsProvider)
    : "";
  const extensionVersion = chrome.runtime.getManifest().version;
  const savedLibrary = useMemo(() => libraryEntries(history), [history]);
  const filteredLibrary = useMemo(
    () => savedLibrary.filter((item) => matchesLibrarySearch(item, librarySearch)),
    [savedLibrary, librarySearch]
  );
  const historyEntries = useMemo(() => readingHistoryEntries(history), [history]);
  const filteredHistory = useMemo(() => historyEntries.filter(item => {
    if (historySearch) {
      const q = historySearch.toLowerCase();
      if (!item.title?.toLowerCase().includes(q)) return false;
    }
    if (historyFilter === "in-progress") return (item.progress.percent ?? 0) > 0 && (item.progress.percent ?? 0) < 100;
    if (historyFilter === "finished") return (item.progress.percent ?? 0) >= 100;
    return true;
  }), [historyEntries, historySearch, historyFilter]);
  const displayedHistory = showAllHistory ? filteredHistory : filteredHistory.slice(0, 5);
  const quizOptions = useMemo(() => generateMCQOptions(studyPanel.quizQuestions ?? [], quizIndex), [studyPanel.quizQuestions, quizIndex]);
  const currentSource = sourceLabel(currentChunk?.pageUrl ?? activeHistoryDocument?.sourceUrl) ?? sourceLabelFromDocument(activeHistoryDocument) ?? contentTypeLabel(currentChunk?.sourceType ?? activeHistoryDocument?.sourceType);
  const currentTitle = currentChunk?.title ?? activeHistoryDocument?.title ?? "Choose content to read";
  const currentExcerpt = currentChunk?.text ?? "Read the current page, selected text, or upload a PDF.";
  const contentHint = contentDetectionHint(currentChunk, hasLoadedContent, player.status);
  const currentProgress = activeHistoryDocument?.progress.percent ?? percent;
  const remainingLabel = hasLoadedContent ? `${remaining}s remaining` : "Ready when you are";
  const currentTabIsPdf = Boolean(currentTabInfo?.url && isLikelyPdfUrl(currentTabInfo.url));
  const speechDisclosure = syntheticSpeechDisclosure(speechSource, providerRouteLabel);

  async function refreshHistory(apiBaseUrl = settings?.apiBaseUrl, token = auth?.token): Promise<ReadingDocument[]> {
    if (!apiBaseUrl) return [];
    if (token) {
      const documents = normalizeUploadedDocumentsForDisplay(await listLibrary(apiBaseUrl, token));
      setHistory(documents);
      return documents;
    } else {
      const local = await chrome.storage.local.get(LOCAL_HISTORY_KEY);
      const documents = normalizeUploadedDocumentsForDisplay((local[LOCAL_HISTORY_KEY] ?? []) as ReadingDocument[]);
      setHistory(documents);
      return documents;
    }
  }

  async function manageSync() {
    const activeSettings = settingsRef.current;
    if (!activeSettings) {
      setError("ReadMate settings are still loading. Try Manage sync again in a moment.");
      return;
    }

    try {
      setActiveAction("settings");
      setError(null);
      setNotice(null);
      const token = await getCurrentSyncToken(true);
      if (!token) throw new Error("Sign in again before refreshing Chrome and mobile sync.");

      const [remoteSettings, remoteDocuments, nextEntitlement] = await Promise.all([
        getRemoteSettings(activeSettings.apiBaseUrl, token),
        listLibrary(activeSettings.apiBaseUrl, token),
        getRemoteEntitlement(activeSettings.apiBaseUrl, token)
      ]);
      const documents = normalizeUploadedDocumentsForDisplay(remoteDocuments);
      settingsRef.current = remoteSettings;
      setSettings(remoteSettings);
      setHistory(documents);
      setEntitlement(nextEntitlement);
      await saveSettings(remoteSettings);
      setNotice(`Sync refreshed. ${documents.length} saved item${documents.length === 1 ? "" : "s"} available in Library.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ReadMate could not refresh sync.");
    } finally {
      setActiveAction(null);
    }
  }

  async function openMobileApp(item?: ReadingDocument) {
    try {
      setError(null);
      const url = mobileReadMateUrl(item?.id);
      await chrome.tabs.create({ url, active: true });
      setNotice(item
        ? `Opening “${item.title}” in ReadMate. If Chrome asks, allow it to open the app.`
        : "Opening ReadMate. If Chrome asks, allow it to open the app.");
    } catch {
      setError("Chrome could not open the ReadMate app link. Open ReadMate on your phone and choose Library instead.");
    }
  }

  async function openLibraryItem(item: ReadingDocument) {
    try {
      setError(null);
      const fullDocument = await hydrateLibraryDocument(item);
      if (fullDocument.sourceUrl) {
        await chrome.tabs.create({ url: fullDocument.sourceUrl, active: true });
        return;
      }
      await replayHistoryItem(fullDocument);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ReadMate could not open this saved item.");
    }
  }

  async function hydrateLibraryDocument(item: ReadingDocument): Promise<ReadingDocument> {
    if (item.blocks?.length || isLocalOnlyDocument(item)) return item;
    const activeSettings = settingsRef.current;
    const token = await getCurrentSyncToken();
    if (!activeSettings || !token) {
      throw new Error("Sign in again before opening this synced Library item.");
    }
    const fullDocument = await getRemoteDocument(activeSettings.apiBaseUrl, token, item.id);
    setHistory((current) => current.map((entry) => (entry.id === fullDocument.id ? fullDocument : entry)));
    return fullDocument;
  }

  async function readStudyTextAloud(text: string, label: string) {
    const activeSettings = settingsRef.current;
    const trimmed = text.trim();
    if (!activeSettings || !trimmed) {
      setError("This study card does not have readable text yet.");
      return;
    }

    const studyRunId = playbackRunRef.current + 1;
    try {
      setActiveAction("read-study");
      setError(null);
      setNotice(null);
      playbackRunRef.current = studyRunId;
      lastHighlightKeyRef.current = null;
      discardCurrentAudio();
      const stoppedPlayer = playerReducer(playerRef.current, { type: "STOP" });
      playerRef.current = stoppedPlayer;
      setPlayer(stoppedPlayer);
      sendToActiveTab({ type: "CLEAR_HIGHLIGHTS" }).catch(() => undefined);
      const blob = await requestCurrentTtsAudio(activeSettings, trimmed);
      if (playbackRunRef.current !== studyRunId) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playbackRate = activeSettings.speed;
      audioRef.current = audio;
      audioObjectUrlRef.current = url;
      setSpeechSource("cloud");
      audio.onended = () => {
        if (audioObjectUrlRef.current === url) {
          URL.revokeObjectURL(url);
          audioObjectUrlRef.current = null;
        }
        if (playbackRunRef.current !== studyRunId) return;
        if (audioRef.current === audio) audioRef.current = null;
      };
      audio.onerror = () => {
        if (audioObjectUrlRef.current === url) {
          URL.revokeObjectURL(url);
          audioObjectUrlRef.current = null;
        }
        if (playbackRunRef.current !== studyRunId) return;
        if (audioRef.current === audio) audioRef.current = null;
        setError(`ReadMate could not finish reading ${label.toLowerCase()}.`);
      };
      await audio.play();
      setNotice(`Reading ${label.toLowerCase()} with an AI-generated voice.`);
    } catch (caught) {
      if (playbackRunRef.current !== studyRunId) return;
      discardCurrentAudio();
      const message = caught instanceof Error ? caught.message : "Unable to generate speech.";
      if (shouldUseSpeechFallback(message, activeSettings.targetLanguage)) {
        const utterance = new SpeechSynthesisUtterance(trimmed);
        utterance.rate = activeSettings.speed;
        utterance.voice = await chooseBrowserVoice(activeSettings.voice);
        if (playbackRunRef.current !== studyRunId) return;
        fallbackUtteranceRef.current = utterance;
        setSpeechSource("browser");
        utterance.onend = () => {
          if (playbackRunRef.current === studyRunId && fallbackUtteranceRef.current === utterance) {
            fallbackUtteranceRef.current = null;
          }
        };
        utterance.onerror = (event) => {
          if (playbackRunRef.current !== studyRunId || event.error === "canceled" || event.error === "interrupted") return;
          if (fallbackUtteranceRef.current === utterance) fallbackUtteranceRef.current = null;
          setError(`ReadMate could not finish reading ${label.toLowerCase()}.`);
        };
        speechSynthesis.speak(utterance);
        setNotice(`Reading ${label.toLowerCase()} with Chrome's synthetic voice.`);
      } else {
        setError(playbackErrorMessage(message, activeSettings.targetLanguage));
      }
    } finally {
      setActiveAction(null);
    }
  }

  function skipFlashcard() {
    const count = studyPanel.flashcards?.length ?? 0;
    if (count <= 1) return;
    setCardIndex((current) => (current + 1) % count);
    setCardFlipped(false);
    setNotice("Flashcard skipped.");
  }

  async function copyStudyText(text: string, label: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(text);
      setError(null);
      setNotice(`${label} copied to the clipboard.`);
    } catch {
      setError(`ReadMate could not copy the ${label.toLowerCase()}. Select the text and copy it manually.`);
    }
  }

  async function openChromePermissions() {
    try {
      setError(null);
      await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}`, active: true });
      setNotice("Chrome opened ReadMate’s extension details, where you can review site access and permissions.");
    } catch {
      setError("Chrome could not open ReadMate’s permission page. Open chrome://extensions and select ReadMate.");
    }
  }

  async function getCurrentSyncToken(forceRefresh = false): Promise<string | null> {
    if (clerk?.isConfigured && clerk.isLoaded && clerk.isSignedIn) {
      try {
        const token = await clerk.getToken(forceRefresh ? { skipCache: true } : undefined);
        const session: AuthSession = {
          isSignedIn: true,
          userName: clerk.userName,
          avatarUrl: clerk.avatarUrl,
          token
        };
        authRef.current = session;
        setAuth(session);
        return token;
      } catch (caught) {
        console.warn("ReadMate Clerk token refresh failed; falling back to cached session.", caught);
      }
    }
    return authRef.current?.token ?? null;
  }

  async function previewSelectedVoice() {
    const activeSettings = settingsRef.current;
    if (!activeSettings || previewingVoice) return;
    setPreviewingVoice(true);
    try {
      previewAudioRef.current?.pause();
      const blob = await requestCurrentTtsAudio(activeSettings, "Hi, this is how ReadMate will sound when it reads to you.");
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playbackRate = activeSettings.speed;
      audio.onended = () => URL.revokeObjectURL(url);
      previewAudioRef.current = audio;
      await audio.play();
    } catch (caught) {
      setError(caught instanceof Error && caught.message !== AUTH_REQUIRED_ERROR
        ? caught.message
        : "Sign in to preview voices.");
    } finally {
      setPreviewingVoice(false);
    }
  }

  async function requestCurrentTtsAudio(activeSettings: ExtensionSettings, text: string): Promise<Blob> {
    try {
      return await requestTtsAudio(activeSettings, await getCurrentSyncToken(), text);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      if (message !== AUTH_REQUIRED_ERROR && message !== TTS_AUTH_REQUIRED_ERROR) throw caught;
      const refreshedToken = await getCurrentSyncToken(true);
      if (!refreshedToken) throw caught;
      return requestTtsAudio(activeSettings, refreshedToken, text);
    }
  }

  async function clearHistoryItem(item: ReadingDocument) {
    if (!window.confirm(`Clear "${item.title}" from history? This keeps the item in your library.`)) return;
    const activeSettings = settingsRef.current;
    const token = await getCurrentSyncToken();
    try {
      setActiveAction("history");
      setError(null);
      setNotice(null);
      if (activeSettings && token) {
        const updated = normalizeUploadedDocumentForDisplay(
          await clearRemoteDocumentHistory(activeSettings.apiBaseUrl, token, item.id)
        );
        setHistory((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
        setStudyPanel((current) => clearStudyPanelForDocument(current, item));
        setNotice("Removed from reading history. The saved item remains in your Library.");
        return;
      }
      const local = await chrome.storage.local.get(LOCAL_HISTORY_KEY);
      const docs = ((local[LOCAL_HISTORY_KEY] ?? []) as ReadingDocument[]).map((entry) =>
        entry.id === item.id ? clearLocalDocumentHistory(entry) : entry
      );
      await chrome.storage.local.set({ [LOCAL_HISTORY_KEY]: docs });
      setHistory(normalizeUploadedDocumentsForDisplay(docs));
      setStudyPanel((current) => clearStudyPanelForDocument(current, item));
      setNotice("Removed from reading history. The saved item remains in your Library.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not clear this history item.");
    } finally {
      setActiveAction(null);
    }
  }

  async function clearAllHistory() {
    if (!window.confirm("Clear all reading history? Your saved library items will not be deleted.")) return;
    const activeSettings = settingsRef.current;
    const token = await getCurrentSyncToken();
    try {
      setActiveAction("history");
      setError(null);
      setNotice(null);
      if (activeSettings && token) {
        await clearRemoteHistory(activeSettings.apiBaseUrl, token);
        const documents = await refreshHistory(activeSettings.apiBaseUrl, token);
        if (readingHistoryEntries(documents).length > 0) {
          throw new Error("Some reading-history items are still present. Please try again.");
        }
        setStudyPanel({});
        setShowAllHistory(false);
        setNotice("Reading history cleared. Saved items remain in your Library.");
        return;
      }
      const local = await chrome.storage.local.get(LOCAL_HISTORY_KEY);
      const docs = clearAllLocalHistory((local[LOCAL_HISTORY_KEY] ?? []) as ReadingDocument[]);
      await chrome.storage.local.set({ [LOCAL_HISTORY_KEY]: docs });
      setHistory(normalizeUploadedDocumentsForDisplay(docs));
      setStudyPanel({});
      setShowAllHistory(false);
      setNotice("Reading history cleared. Saved items remain in your Library.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not clear reading history.");
    } finally {
      setActiveAction(null);
    }
  }

  async function deleteLibraryItem(item: ReadingDocument) {
    if (!window.confirm("Delete this item from your library? This will remove it from all devices.")) return;
    const activeSettings = settingsRef.current;
    const token = await getCurrentSyncToken();
    try {
      setActiveAction("history");
      setError(null);
      setNotice(null);
      if (activeSettings && token && !isLocalOnlyDocument(item)) {
        await deleteRemoteLearningData(activeSettings.apiBaseUrl, token, item.id).catch(() => undefined);
        await deleteRemoteDocument(activeSettings.apiBaseUrl, token, item.id);
      }
      await removeLocalHistoryItem(item.id);
      setHistory((current) => current.filter((entry) => entry.id !== item.id));
      setStudyPanel((current) => clearStudyPanelForDocument(current, item));
      setLearningError((current) => current?.documentId === item.id ? null : current);
      setNotice("Deleted from your Library and removed from all devices.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete this library item.");
    } finally {
      setActiveAction(null);
    }
  }

  async function sendToStudy(item: ReadingDocument) {
    setActiveTab("learn");
    setStudyPanel((current) => studyPanelForDocument(current, item));
    const activeSettings = settingsRef.current;
    const token = await getCurrentSyncToken();
    if (!activeSettings || !token) {
      setLearningError({ message: "Sign in to send this item to Study.", documentId: item.id, mode: "study" });
      return;
    }
    try {
      setActiveAction("study");
      setError(null);
      setLearningError(null);
      setNotice(null);
      const generated = await generateDocumentLearning(activeSettings.apiBaseUrl, token, item.id, {
        ...learningCounts,
        targetLanguage: activeSettings.targetLanguage
      });
      const updated = generated.document;
      const review = generated.syncPending
        ? null
        : await getDocumentLearningReview(activeSettings.apiBaseUrl, token, updated.id).catch(() => null);
      const displayDocument = normalizeUploadedDocumentForDisplay(updated);
      setHistory((current) => current.map((entry) => (entry.id === displayDocument.id ? displayDocument : entry)));
      setStudyPanel((current) => ({
        ...current,
        documentId: updated.id,
        mode: "study",
        summary: updated.summary,
        keyPoints: review?.keyPoints ?? updated.keyPoints ?? current.keyPoints,
        flashcards: review ? flashcardsFromReview(review) : (updated.flashcards ?? current.flashcards),
        quizQuestions: review ? quizQuestionsFromReview(review) : (updated.quizQuestions ?? current.quizQuestions)
      }));
      setNotice(generated.syncPending
        ? "Study material is ready. Review progress is still syncing."
        : "Study material is ready. Open ReadMate mobile Study for flashcards, quiz, notes, and review.");
    } catch (caught) {
      setLearningError({
        message: caught instanceof Error ? caught.message : "Could not generate Study material.",
        documentId: item.id,
        mode: "study"
      });
    } finally {
      setActiveAction(null);
    }
  }

  function getActiveStudyTarget(): ReadingDocument | undefined {
    return learningTarget;
  }

  async function loadStudyReview(apiBaseUrl: string, token: string, document: ReadingDocument): Promise<Pick<StudyPanelState, "keyPoints" | "flashcards" | "quizQuestions">> {
    const review = await getDocumentLearningReview(apiBaseUrl, token, document.id);
    return {
      keyPoints: review.keyPoints,
      flashcards: flashcardsFromReview(review),
      quizQuestions: quizQuestionsFromReview(review)
    };
  }

  async function summarizeActiveDocument(mode: LearningActionMode = "summary", targetItem?: ReadingDocument) {
    const item = targetItem ?? getActiveStudyTarget();
    if (!item) {
      setError("Read or save a page before using Learn.");
      return;
    }
    const activeSettings = settingsRef.current;
    const token = await getCurrentSyncToken();
    if (!activeSettings || !token) {
      setActiveTab("learn");
      setLearningError({ message: "Sign in to use Learn.", documentId: item.id, mode });
      return;
    }
    try {
      setActiveAction("study");
      setActiveTab("learn");
      setStudyPanel((current) => studyPanelForDocument(current, item));
      setError(null);
      setLearningError(null);
      setNotice(null);
      if (mode === "explain") {
        const result = await askDocumentQuestion(
          activeSettings.apiBaseUrl,
          token,
          item.id,
          "Explain this in simple terms.",
          activeSettings.targetLanguage
        );
        setStudyPanel((current) => ({
          ...current,
          documentId: item.id,
          mode,
          answer: result.answer,
          citedSections: result.citedSections,
          lastQuestion: "Explain this in simple terms."
        }));
        setNotice("Simple explanation is ready.");
        return;
      }
      const generated = await generateDocumentLearning(activeSettings.apiBaseUrl, token, item.id, {
        ...learningCounts,
        targetLanguage: activeSettings.targetLanguage,
        mode: mode === "flashcards" ? "flashcards" : mode === "quiz" ? "quiz" : "summary"
      });
      const updated = generated.document;
      const documentLearning = {
        keyPoints: updated.keyPoints ?? [],
        flashcards: updated.flashcards ?? [],
        quizQuestions: updated.quizQuestions ?? []
      };
      const review = generated.syncPending
        ? documentLearning
        : await loadStudyReview(activeSettings.apiBaseUrl, token, updated).catch(() => documentLearning);
      const displayDocument = normalizeUploadedDocumentForDisplay(updated);
      setHistory((current) => current.map((entry) => (entry.id === displayDocument.id ? displayDocument : entry)));
      setStudyPanel({
        documentId: updated.id,
        mode,
        summary: updated.summary,
        keyPoints: review.keyPoints,
        flashcards: review.flashcards,
        quizQuestions: review.quizQuestions,
        answer: studyPanel.answer,
        citedSections: studyPanel.citedSections,
        lastQuestion: studyPanel.lastQuestion
      });
      setNotice(generated.syncPending
        ? `${learnNoticeForMode(mode)} Review progress is still syncing.`
        : learnNoticeForMode(mode));
    } catch (caught) {
      setLearningError({
        message: caught instanceof Error ? caught.message : "Could not generate learning material.",
        documentId: item.id,
        mode
      });
    } finally {
      setActiveAction(null);
    }
  }

  function retryLearningRequest() {
    if (!learningError || activeAction !== null) return;
    const item = history.find((entry) => entry.id === learningError.documentId);
    if (!item) {
      setLearningError(null);
      setError("This item is no longer available in your library.");
      return;
    }
    const mode = learningError.mode;
    setLearningError(null);
    if (mode === "study") {
      void sendToStudy(item);
      return;
    }
    void summarizeActiveDocument(mode, item);
  }

  async function askActiveDocument() {
    const item = getActiveStudyTarget();
    const question = studyQuestion.trim();
    if (!item) {
      setError("Read or save a page before asking about it.");
      return;
    }
    if (!question) {
      setError("Enter a question about this page first.");
      return;
    }
    const activeSettings = settingsRef.current;
    const token = await getCurrentSyncToken();
    if (!activeSettings || !token) {
      setError("Sign in to use Ask AI.");
      return;
    }
    try {
      setActiveAction("ask");
      setActiveTab("learn");
      setError(null);
      setNotice(null);
      const result = await askDocumentQuestion(activeSettings.apiBaseUrl, token, item.id, question, activeSettings.targetLanguage);
      setStudyPanel((current) => ({ ...current, documentId: item.id, mode: "ask", answer: result.answer, citedSections: result.citedSections, lastQuestion: question }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to answer this question.");
    } finally {
      setActiveAction(null);
    }
  }

  async function saveHighlightFromSelection() {
    setNotice("Select text on the page, then use Read selection to save it as synced study content.");
    await readSelection();
  }

  function handleLearningAction(action: LearningComponentAction) {
    if (action === "save_note") {
      setNotice("This learning card is ready to save from the mobile Study tab.");
      return;
    }
    if (action === "create_flashcards") {
      void summarizeActiveDocument("flashcards");
      return;
    }
    if (action === "create_quiz") {
      void summarizeActiveDocument("quiz");
      return;
    }
    const item = getActiveStudyTarget();
    if (item) void sendToStudy(item);
    else setError("Read or save a page before sending it to Study.");
  }

  async function syncFlashcardReview(reviewStatus: "known" | "needs_review") {
    const card = studyPanel.flashcards?.[Math.min(cardIndex, Math.max(0, (studyPanel.flashcards?.length ?? 1) - 1))];
    const activeSettings = settingsRef.current;
    const token = await getCurrentSyncToken();
    if (!card?.id || !studyPanel.documentId || !activeSettings || !token) return;
    try {
      const updated = await markRemoteFlashcardReview(activeSettings.apiBaseUrl, token, studyPanel.documentId, card.id, reviewStatus);
      setStudyPanel((current) => ({
        ...current,
        flashcards: current.flashcards?.map((existing) => (
          existing.id === updated.id ? { ...existing, reviewStatus: updated.reviewStatus } : existing
        ))
      }));
      setNotice(reviewStatus === "known" ? "Flashcard marked known." : "Flashcard marked for review.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sync flashcard review.");
    }
  }

  async function syncQuizAttempt(answerValues: string[]) {
    const activeSettings = settingsRef.current;
    const token = await getCurrentSyncToken();
    if (!studyPanel.documentId || !activeSettings || !token || !studyPanel.quizQuestions?.length) return;
    const answers = studyPanel.quizQuestions.reduce<Record<string, string>>((acc, question, index) => {
      if (question.id) acc[question.id] = answerValues[index] ?? "";
      return acc;
    }, {});
    if (!Object.keys(answers).length) return;
    try {
      const attempt = await submitRemoteQuizAttempt(activeSettings.apiBaseUrl, token, studyPanel.documentId, answers);
      setNotice(`Quiz synced: ${attempt.correct}/${attempt.total} correct.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sync quiz result.");
    }
  }

  async function updateSettings(next: ExtensionSettings) {
    try {
      const previous = settingsRef.current;
      const wasPlaying = playerRef.current.status === "playing" || playerRef.current.status === "loading";
      const shouldRestartAudio = Boolean(previous && chunksRef.current.length && audioSettingsChanged(previous, next));
      setActiveAction("settings");
      settingsRef.current = next;
      setSettings(next);
      await saveSettings(next);
      const token = await getCurrentSyncToken();
      if (token) await saveRemoteSettings(next, token).catch(() => setError("Settings saved locally, but synced settings could not be updated."));
      setPlayer((state) => ({ ...state, voice: next.voice, speed: next.speed }));
      if (shouldRestartAudio) {
        discardCurrentAudio();
        if (wasPlaying) {
          const runId = playbackRunRef.current + 1;
          playbackRunRef.current = runId;
          window.setTimeout(() => {
            void playChunkAtIndex(playerRef.current.currentChunkIndex, runId);
          }, 0);
        }
      }
    } finally {
      setActiveAction(null);
    }
  }

  async function ensureCurrentPdfHostPermission(): Promise<boolean> {
    if (!currentTabIsPdf || !currentTabInfo?.url) return true;
    try {
      const source = new URL(currentTabInfo.url);
      const origins = [`${source.origin}/*`];
      if (!chrome.permissions?.contains || !chrome.permissions?.request) return true;
      if (await chrome.permissions.contains({ origins })) return true;
      const granted = await chrome.permissions.request({ origins });
      if (granted) return true;
      setError(`Chrome needs access to ${source.hostname} to download and read this PDF. Select Read this page again and approve access.`);
      return false;
    } catch {
      setError("ReadMate could not verify access to this PDF. Open the original PDF URL or upload the file in the side panel.");
      return false;
    }
  }

  async function readCurrentPage() {
    try {
      setActiveTab("read");
      setActiveAction("read-page");
      setError(null);
      setNotice(null);
      autoPlayNextChunksRef.current = true;
      pendingChunkActionRef.current = "read-page";
      if (!await ensureCurrentPdfHostPermission()) {
        pendingChunkActionRef.current = null;
        return;
      }
      if (await readActivePdfTab({ autoPlay: true, action: "read-page" })) {
        pendingChunkActionRef.current = null;
        return;
      }
      const result = await sendToCurrentReadableTab({ type: "READ_CURRENT_PAGE" });
      if (!result.ok) pendingChunkActionRef.current = null;
      handleReadableTabResult(result);
    } finally {
      setActiveAction(null);
    }
  }

  async function readSelection() {
    try {
      setActiveTab("read");
      setActiveAction("read-selection");
      setError(null);
      setNotice(null);
      autoPlayNextChunksRef.current = true;
      pendingChunkActionRef.current = "read-selection";
      const result = await sendToCurrentReadableTab({ type: "READ_SELECTION" });
      if (!result.ok) pendingChunkActionRef.current = null;
      handleReadableTabResult(result);
    } finally {
      setActiveAction(null);
    }
  }

  async function saveCurrentPage() {
    try {
      setActiveTab("read");
      setActiveAction("save");
      setError(null);
      setNotice(null);
      autoPlayNextChunksRef.current = false;
      pendingChunkActionRef.current = "save";
      if (!await ensureCurrentPdfHostPermission()) {
        pendingChunkActionRef.current = null;
        return;
      }
      if (await readActivePdfTab({ autoPlay: false, action: "save" })) {
        pendingChunkActionRef.current = null;
        return;
      }
      const result = await sendToCurrentReadableTab({ type: "READ_CURRENT_PAGE" });
      if (!result.ok) pendingChunkActionRef.current = null;
      handleReadableTabResult(result);
    } finally {
      setActiveAction(null);
    }
  }

  async function replayHistoryItem(item: ReadingDocument) {
    setError(null);
    setLearningError(null);
    let playableItem: ReadingDocument;
    try {
      playableItem = await hydrateLibraryDocument(item);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ReadMate could not load this Library item.");
      return;
    }
    setStudyPanel((current) => studyPanelForDocument(current, playableItem));
    setActiveTab("read");
    const historyChunks = chunksFromDocument(playableItem);
    if (historyChunks.length > 0) {
      const nextSettings = settingsRef.current
        ? {
            ...settingsRef.current,
            ttsProvider: playableItem.provider ?? settingsRef.current.ttsProvider,
            voice: playableItem.voice,
            speed: playableItem.speed
          }
        : null;
      if (nextSettings) {
        setSettings(nextSettings);
        settingsRef.current = nextSettings;
        await saveSettings(nextSettings);
      }
      chunksRef.current = historyChunks;
      setChunks(historyChunks);
      const startIndex = Math.min(playableItem.progress.blockIndex ?? playableItem.progress.chunkIndex ?? 0, historyChunks.length - 1);
      setPlayer((state) => ({
        ...playerReducer(state, {
          type: "LOAD_DOCUMENT",
          documentId: playableItem.id,
          voice: playableItem.voice,
          speed: playableItem.speed
        }),
        currentChunkIndex: startIndex
      }));
      const runId = playbackRunRef.current + 1;
      playbackRunRef.current = runId;
      window.setTimeout(() => {
        void playChunkAtIndex(startIndex, runId);
      }, 50);
      return;
    }

    if (playableItem.sourceUrl) {
      await openSourceAndRead(playableItem.sourceUrl);
      return;
    }

    setError("This older history item does not include saved article text. Read the page again to make it replayable and sync it to mobile.");
  }

  async function playCurrentChunk() {
    speechSynthesis.resume();
    if (player.status === "paused") {
      if (audioRef.current) {
        await audioRef.current.play();
        setPlayer((state) => playerReducer(state, { type: "PLAY" }));
        return;
      }
      if (fallbackUtteranceRef.current) {
        speechSynthesis.resume();
        setPlayer((state) => playerReducer(state, { type: "PLAY" }));
        return;
      }
    }
    const runId = playbackRunRef.current + 1;
    playbackRunRef.current = runId;
    await playChunkAtIndex(playerRef.current.currentChunkIndex, runId);
  }

  async function playAdjacentChunk(direction: ChunkDirection) {
    const targetIndex = adjacentChunkIndex(
      playerRef.current.currentChunkIndex,
      direction,
      chunksRef.current.length
    );
    if (targetIndex === null) return;

    const runId = playbackRunRef.current + 1;
    playbackRunRef.current = runId;
    lastHighlightKeyRef.current = null;
    discardCurrentAudio();
    const nextPlayer = {
      ...playerRef.current,
      status: "loading" as const,
      currentChunkIndex: targetIndex,
      currentTime: 0,
      duration: 0,
      error: undefined
    };
    playerRef.current = nextPlayer;
    setPlayer(nextPlayer);
    await playChunkAtIndex(targetIndex, runId);
  }

  async function playChunkAtIndex(index: number, runId: number) {
    const activeSettings = settingsRef.current;
    const activeChunks = chunksRef.current;
    const chunk = activeChunks[index];
    if (!activeSettings || !chunk || playbackRunRef.current !== runId) return;
    lastHighlightKeyRef.current = null;
    discardCurrentAudio();
    try {
      setError(null);
      setPlayer((state) => ({
        ...playerReducer(state, { type: "PLAY" }),
        currentChunkIndex: index,
        currentTime: 0,
        duration: 0,
        voice: activeSettings.voice,
        speed: activeSettings.speed
      }));
      const blob = await requestCurrentTtsAudio(activeSettings, chunk.text);
      if (playbackRunRef.current !== runId) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playbackRate = activeSettings.speed;
      audioRef.current = audio;
      audioObjectUrlRef.current = url;
      setSpeechSource("cloud");
      audio.ontimeupdate = () => {
        if (playbackRunRef.current !== runId) return;
        const duration = audio.duration || 0;
        setPlayer((state) =>
          playerReducer(state, { type: "TIME_UPDATE", currentTime: audio.currentTime, duration })
        );
        void highlightCurrentChunk(chunk, { currentTime: audio.currentTime, duration });
      };
      audio.onended = () => {
        if (audioObjectUrlRef.current === url) {
          URL.revokeObjectURL(url);
          audioObjectUrlRef.current = null;
        }
        if (audioRef.current === audio) audioRef.current = null;
        if (playbackRunRef.current !== runId) return;
        if (index < chunksRef.current.length - 1) {
          setPlayer((state) => playerReducer(state, { type: "NEXT_CHUNK", totalChunks: chunksRef.current.length }));
          void playChunkAtIndex(index + 1, runId);
        } else {
          void saveLocalProgress(chunk, index, 100);
          setPlayer((state) => playerReducer(state, { type: "ENDED" }));
        }
      };
      await highlightCurrentChunk(chunk, { currentTime: 0, duration: 0 });
      await audio.play();
      await saveLocalProgress(chunk, index);
    } catch (caught) {
      if (playbackRunRef.current !== runId) return;
      discardCurrentAudio();
      const message = caught instanceof Error ? caught.message : "Unable to start audio.";
      if (shouldUseSpeechFallback(message, activeSettings.targetLanguage)) {
        setError(speechFallbackMessage(message));
        playWithBrowserSpeech(chunk, activeSettings, index, runId);
        await saveLocalProgress(chunk, index);
        return;
      }
      const userMessage = playbackErrorMessage(message, activeSettings.targetLanguage);
      setError(userMessage);
      setPlayer((state) => playerReducer(state, { type: "ERROR", error: userMessage }));
    }
  }

  async function playWithBrowserSpeech(chunk: ReadingChunk, activeSettings: ExtensionSettings, index: number, runId: number) {
    speechSynthesis.cancel();
    setSpeechSource("browser");
    await highlightCurrentChunk(chunk, { characterOffset: 0 });
    const browserSpeechSegments = splitBrowserSpeechSegments(chunk.text);
    if (!browserSpeechSegments.length) {
      if (index < chunksRef.current.length - 1) {
        setPlayer((state) => playerReducer(state, { type: "NEXT_CHUNK", totalChunks: chunksRef.current.length }));
        void playChunkAtIndex(index + 1, runId);
      } else {
        setPlayer((state) => playerReducer(state, { type: "ENDED" }));
      }
      return;
    }

    const browserVoice = await chooseBrowserVoice(activeSettings.voice);
    const estimatedDuration = estimateSpeechDuration(chunk.text, activeSettings.speed);
    setPlayer((state) =>
      playerReducer(state, {
        type: "TIME_UPDATE",
        currentTime: 0,
        duration: estimatedDuration
      })
    );

    const speakSegment = (segmentIndex: number) => {
      if (playbackRunRef.current !== runId) return;
      const segment = browserSpeechSegments[segmentIndex];
      if (!segment) {
        fallbackUtteranceRef.current = null;
        if (index < chunksRef.current.length - 1) {
          setPlayer((state) => playerReducer(state, { type: "NEXT_CHUNK", totalChunks: chunksRef.current.length }));
          void playChunkAtIndex(index + 1, runId);
        } else {
          void saveLocalProgress(chunk, index, 100);
          setPlayer((state) => playerReducer(state, { type: "ENDED" }));
        }
        return;
      }

      const utterance = new SpeechSynthesisUtterance(segment.text);
      utterance.rate = activeSettings.speed;
      utterance.voice = browserVoice;
      fallbackUtteranceRef.current = utterance;
      utterance.onboundary = (event) => {
        updateBrowserSpeechProgress(chunk, segment, estimatedDuration, event.charIndex ?? 0, runId);
      };
      utterance.onend = () => {
        if (playbackRunRef.current !== runId) return;
        speakSegment(segmentIndex + 1);
      };
      utterance.onerror = (event) => {
        if (playbackRunRef.current !== runId || event.error === "canceled" || event.error === "interrupted") return;
        const fallbackError = `Browser speech could not play this text${event.error ? ` (${event.error})` : ""}.`;
        console.warn("ReadMate browser speech failed.", { error: event.error, segmentLength: segment.text.length });
        fallbackUtteranceRef.current = null;
        setError(fallbackError);
        setPlayer((state) => playerReducer(state, { type: "ERROR", error: fallbackError }));
      };
      speechSynthesis.speak(utterance);
    };

    speakSegment(0);
  }

  function updateBrowserSpeechProgress(
    chunk: ReadingChunk,
    segment: BrowserSpeechSegment,
    estimatedDuration: number,
    segmentCharacterOffset: number,
    runId: number
  ) {
      if (playbackRunRef.current !== runId) return;
      const characterOffset = Math.min(chunk.text.length, segment.startOffset + Math.max(0, segmentCharacterOffset));
      const currentTime = chunk.text.length ? estimatedDuration * (characterOffset / chunk.text.length) : 0;
      setPlayer((state) =>
        playerReducer(state, { type: "TIME_UPDATE", currentTime, duration: estimatedDuration })
      );
      void highlightCurrentChunk(chunk, { characterOffset });
  }

  async function highlightCurrentChunk(chunk: ReadingChunk, position: HighlightPlaybackPosition = {}) {
    const activeSettings = settingsRef.current;
    if (!activeSettings) return;
    const target = getActiveHighlightTarget(chunk, activeSettings.highlightMode, position);
    if (!target) {
      if (lastHighlightKeyRef.current !== null) {
        lastHighlightKeyRef.current = null;
        await sendToActiveTab({ type: "CLEAR_HIGHLIGHTS" });
      }
      return;
    }
    if (lastHighlightKeyRef.current === target.key) return;
    lastHighlightKeyRef.current = target.key;
    await sendToActiveTab({
      type: "HIGHLIGHT_CHUNK",
      chunkId: chunk.id,
      selector: target.selector,
      selectors: target.selectors,
      text: target.text,
      settings: activeSettings
    });
  }

  async function saveLocalProgress(chunk: ReadingChunk, chunkIndex = playerRef.current.currentChunkIndex, percentOverride?: number) {
    const activeChunks = chunksRef.current;
    const activeSettings = settingsRef.current;
    const token = await getCurrentSyncToken();
    if (token && activeSettings && playerRef.current.currentDocumentId) {
      try {
        await updateSyncedProgress(
          activeSettings.apiBaseUrl,
          token,
          playerRef.current.currentDocumentId,
          chunkIndex,
          activeChunks.length,
          activeSettings,
          percentOverride
        );
        setHistory(normalizeUploadedDocumentsForDisplay(await listLibrary(activeSettings.apiBaseUrl, token)));
        return;
      } catch {
        // Keep playback usable offline or when a locally-started document has not synced yet.
      }
    }

    const doc: ReadingDocument = {
      id: playerRef.current.currentDocumentId ?? crypto.randomUUID(),
      userId: authRef.current?.isSignedIn ? "synced" : "anonymous",
      title: chunk.title ?? "Untitled reading",
      sourceType: chunk.sourceType,
      sourceUrl: chunk.pageUrl,
      thumbnailUrl: chunk.thumbnailUrl,
      author: chunk.author,
      description: chunk.description,
      estimatedListeningSeconds: estimateSpeechDuration(activeChunks.map((activeChunk) => activeChunk.text).join(" "), activeSettings?.speed ?? 1),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastReadAt: new Date().toISOString(),
      progress: {
        blockIndex: chunkIndex,
        characterOffset: 0,
        sentenceIndex: 0,
        chunkIndex,
        percent: percentOverride ?? (activeChunks.length ? Math.round((chunkIndex / activeChunks.length) * 100) : 0)
      },
      provider: activeSettings?.ttsProvider ?? "google",
      voice: activeSettings?.voice ?? DEFAULT_SETTINGS.voice,
      speed: activeSettings?.speed ?? 1,
      blocks: activeChunks.map((activeChunk, index) => ({
        id: activeChunk.id,
        orderIndex: index,
        blockType: index === 0 && activeChunk.text.length < 180 ? "heading" : "paragraph",
        text: activeChunk.text,
        sourceSelector: activeChunk.elementSelector
      }))
    };
    const local = await chrome.storage.local.get(LOCAL_HISTORY_KEY);
    const docs = normalizeUploadedDocumentsForDisplay([
      doc,
      ...((local[LOCAL_HISTORY_KEY] ?? []) as ReadingDocument[]).filter((item) => item.id !== doc.id)
    ]).slice(0, 20);
    await chrome.storage.local.set({ [LOCAL_HISTORY_KEY]: docs });
    setHistory(docs);
  }

  function pause() {
    audioRef.current?.pause();
    speechSynthesis.pause();
    setPlayer((state) => playerReducer(state, { type: "PAUSE" }));
  }

  function stop() {
    playbackRunRef.current += 1;
    lastHighlightKeyRef.current = null;
    discardCurrentAudio();
    setPlayer((state) => playerReducer(state, { type: "STOP" }));
    sendToActiveTab({ type: "CLEAR_HIGHLIGHTS" }).catch(() => undefined);
  }

  function discardCurrentAudio() {
    const currentAudio = audioRef.current;
    if (currentAudio) {
      currentAudio.ontimeupdate = null;
      currentAudio.onended = null;
      currentAudio.onerror = null;
      currentAudio.pause();
    }
    audioRef.current = null;
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
    fallbackUtteranceRef.current = null;
    speechSynthesis.cancel();
  }

  function resetLoadedArticleAfterTabChange(nextTabInfo: { title: string; url: string; favicon?: string } | null) {
    playbackRunRef.current += 1;
    lastHighlightKeyRef.current = null;
    discardCurrentAudio();
    chunksRef.current = [];
    loadedSourceUrlRef.current = null;
    setChunks([]);
    setStudyPanel({});
    setLearningError(null);
    setPlayer((state) => ({
      ...createInitialPlayerState(),
      voice: settingsRef.current?.voice ?? state.voice,
      speed: settingsRef.current?.speed ?? state.speed
    }));
    setNotice(nextTabInfo ? `Current tab changed to ${sourceLabel(nextTabInfo.url) ?? "a new page"}. Press Read current page to load it.` : null);
  }

  function audioSettingsChanged(previous: ExtensionSettings, next: ExtensionSettings): boolean {
    return previous.voice !== next.voice || previous.speed !== next.speed || previous.targetLanguage !== next.targetLanguage;
  }

  function seek(seconds: number) {
    const audio = audioRef.current;
    if (fallbackUtteranceRef.current) {
      setPlayer((state) => playerReducer(state, { type: "SEEK_RELATIVE", seconds }));
      return;
    }
    if (!audio) return;
    audio.currentTime = Math.min(Math.max(audio.currentTime + seconds, 0), audio.duration || 0);
    setPlayer((state) => playerReducer(state, { type: "SEEK_RELATIVE", seconds }));
  }

  function handleReadableTabResult(result: TabMessageResult) {
    if (result.ok) return;
    if (result.reason === "unsupported-tab") {
      setError(null);
      setNotice(result.message);
      return;
    }
    setError(result.message);
  }

  async function sendToCurrentReadableTab(message: ReadmateMessage): Promise<TabMessageResult> {
    const tab = await resolveActiveReadableTab({ preferredTabId: activeReadableTabIdRef.current });
    if (!tab?.id) {
      pendingReadTabIdRef.current = null;
      return sendToActiveTab(message, activeReadableTabIdRef.current);
    }
    activeReadableTabIdRef.current = tab.id;
    pendingReadTabIdRef.current = tab.id;
    setCurrentTabInfo(tabInfoFromTab(tab));
    return sendToTab(tab.id, message);
  }

  async function openSourceAndRead(sourceUrl: string) {
    const tab = await chrome.tabs.create({ url: sourceUrl, active: true });
    if (!tab.id) {
      setError("ReadMate could not open this saved article.");
      return;
    }
    await waitForTabComplete(tab.id);
    const result = await sendToTab(tab.id, { type: "READ_CURRENT_PAGE" });
    handleReadableTabResult(result);
  }

  async function handlePdf(file: File | undefined) {
    if (!file) return;
    try {
      setActiveTab("read");
      setActiveAction("upload-pdf");
      await readPdfFile(file, {}, { autoPlay: true, action: "upload-pdf" });
    } finally {
      setActiveAction(null);
    }
  }

  async function readActivePdfTab(options: ReadingOptions = { autoPlay: true }): Promise<boolean> {
    // The Chrome PDF viewer does not receive our content script. Resolve the
    // real browser tab first so PDF actions never fall through to HTML capture.
    const tab = await resolveActiveTab({ preferredTabId: activeReadableTabIdRef.current });
    const sourceUrl = pdfSourceUrlFromTab(tab);
    if (!sourceUrl) return false;
    const title = pdfTitleFromUrl(sourceUrl, tab?.title);
    const startedAt = Date.now();
    const controller = new AbortController();
    pendingPdfUploadRef.current = null;
    pdfDownloadAbortControllerRef.current = controller;
    setUploadStatus({
      phase: "downloading",
      fileName: title,
      fileSize: 0,
      startedAt,
      transferStartedAt: startedAt,
      loadedBytes: 0,
      totalBytes: 0,
      message: "ReadMate is downloading this PDF from the current tab before checking your Library limits."
    });
    try {
      setError(null);
      const response = await fetch(sourceUrl, { credentials: "include", signal: controller.signal });
      if (!response.ok) throw new Error(`PDF download failed with status ${response.status}.`);
      const sourceFile = await fileFromPdfResponse(response, title, {
        signal: controller.signal,
        onProgress: ({ loadedBytes, totalBytes }) => {
          setUploadStatus((current) => {
            if (!current || current.startedAt !== startedAt || current.phase !== "downloading") return current;
            const nextTotal = totalBytes > 0 ? totalBytes : current.totalBytes;
            if (uploadPercent(current.loadedBytes, current.totalBytes) === uploadPercent(loadedBytes, nextTotal)
              && current.loadedBytes === loadedBytes) return current;
            return {
              ...current,
              fileSize: nextTotal || current.fileSize,
              loadedBytes,
              totalBytes: nextTotal
            };
          });
        }
      });
      await readPdfFile(sourceFile, { title, pageUrl: sourceUrl }, options);
      return true;
    } catch (caught) {
      const cancelled = caught instanceof DOMException && caught.name === "AbortError";
      const message = cancelled
        ? "Download cancelled. Nothing was uploaded or saved."
        : caught instanceof Error
          ? caught.message
          : "Unable to read this PDF tab. Use Upload PDF if the site blocks direct download.";
      setUploadStatus((current) => current?.startedAt === startedAt ? {
        ...current,
        phase: cancelled ? "cancelled" : "failed",
        finishedAt: Date.now(),
        message
      } : current);
      if (!cancelled) setError(message);
      return true;
    } finally {
      if (pdfDownloadAbortControllerRef.current === controller) pdfDownloadAbortControllerRef.current = null;
    }
  }

  async function readPdfFile(file: File, metadata: { title?: string; pageUrl?: string } = {}, options: ReadingOptions = { autoPlay: true }) {
    const request: PendingPdfUpload = { file, metadata, options };
    pendingPdfUploadRef.current = request;
    setError(null);
    setNotice(null);

    const activeSettings = settingsRef.current;
    let token = await getCurrentSyncToken();
    if (!activeSettings || !token) {
      await readPdfLocally(request, "ReadMate opened this PDF in Chrome only because Library sync is not signed in.");
      return;
    }

    const startedAt = Date.now();
    let activeEntitlement = entitlement ?? undefined;
    let capacityVerified = false;
    setUploadStatus({
      phase: "checking",
      fileName: file.name,
      fileSize: file.size,
      startedAt,
      loadedBytes: 0,
      totalBytes: file.size,
      capacity: activeEntitlement
    });

    try {
      activeEntitlement = await getRemoteEntitlement(activeSettings.apiBaseUrl, token);
      setEntitlement(activeEntitlement);
      capacityVerified = true;
    } catch (caught) {
      if (caught instanceof Error && caught.message === AUTH_REQUIRED_ERROR) {
        const refreshedToken = await getCurrentSyncToken(true);
        if (!refreshedToken) {
          setUploadStatus((current) => current?.startedAt === startedAt ? {
            ...current,
            phase: "failed",
            finishedAt: Date.now(),
            message: "Your ReadMate session needs to be refreshed before this PDF can be saved to the Library."
          } : current);
          return;
        }
        token = refreshedToken;
        try {
          activeEntitlement = await getRemoteEntitlement(activeSettings.apiBaseUrl, token);
          setEntitlement(activeEntitlement);
          capacityVerified = true;
        } catch {
          activeEntitlement = entitlement ?? undefined;
        }
      }
    }

    if (activeEntitlement && capacityVerified) {
      const gate = evaluateUploadCapacity(file.size, activeEntitlement);
      if (gate.blocked) {
        setUploadStatus((current) => current?.startedAt === startedAt ? {
          ...current,
          phase: gate.upgradeRequired ? "gated" : "failed",
          finishedAt: Date.now(),
          capacity: activeEntitlement,
          message: gate.message
        } : current);
        return;
      }
    }

    const controller = new AbortController();
    uploadAbortControllerRef.current = controller;
    setUploadStatus((current) => current?.startedAt === startedAt ? {
      ...current,
      phase: "uploading",
      transferStartedAt: Date.now(),
      capacity: activeEntitlement,
      message: capacityVerified ? undefined : "ReadMate will verify your current plan limits while uploading."
    } : current);

    let document: ReadingDocument;
    try {
      document = normalizeUploadedDocumentForDisplay(await uploadPdfDocument(
        activeSettings.apiBaseUrl,
        token,
        file,
        activeSettings,
        metadata.title,
        {
          signal: controller.signal,
          onProgress: ({ loadedBytes, totalBytes }) => {
            setUploadStatus((current) => {
              if (!current || current.startedAt !== startedAt || current.phase !== "uploading") return current;
              if (uploadPercent(current.loadedBytes, current.totalBytes) === uploadPercent(loadedBytes, totalBytes)) return current;
              return { ...current, loadedBytes, totalBytes };
            });
          },
          onUploadComplete: () => {
            const processingStartedAt = Date.now();
            setUploadStatus((current) => {
              if (!current || current.startedAt !== startedAt || current.phase !== "uploading") return current;
              return {
                ...current,
                phase: "processing",
                processingStartedAt,
                loadedBytes: file.size,
                totalBytes: file.size,
                message: "Upload complete. ReadMate is extracting text and preparing your Library item."
              };
            });
          }
        }
      ));
    } catch (caught) {
      const finishedAt = Date.now();
      if (caught instanceof DOMException && caught.name === "AbortError") {
        setUploadStatus((current) => current?.startedAt === startedAt ? {
          ...current,
          phase: "cancelled",
          finishedAt,
          message: "Upload cancelled. The PDF was not added to your Library."
        } : current);
        return;
      }
      if (caught instanceof UploadRequestError && (caught.code === "PREMIUM_REQUIRED" || caught.feature === "large_documents")) {
        setUploadStatus((current) => current?.startedAt === startedAt ? {
          ...current,
          phase: "gated",
          finishedAt,
          message: uploadErrorDetail(caught.message)
        } : current);
        return;
      }
      const retryHint = caught instanceof UploadRequestError && caught.retryAfterSeconds
        ? ` Try again in about ${caught.retryAfterSeconds} seconds.`
        : "";
      const message = caught instanceof Error && caught.message === AUTH_REQUIRED_ERROR
        ? "Your ReadMate session expired. Retry to sign in and save this PDF."
        : `${caught instanceof Error ? uploadErrorDetail(caught.message) : "ReadMate could not upload this PDF."}${retryHint}`;
      setUploadStatus((current) => current?.startedAt === startedAt ? {
        ...current,
        phase: "failed",
        finishedAt,
        message
      } : current);
      return;
    } finally {
      if (uploadAbortControllerRef.current === controller) uploadAbortControllerRef.current = null;
    }

    const finishedAt = Date.now();
    setUploadStatus((current) => current?.startedAt === startedAt ? {
      ...current,
      phase: "ready",
      finishedAt,
      loadedBytes: file.size,
      totalBytes: file.size,
      message: "Ready in your Library and available on your other signed-in devices."
    } : current);
    setNotice("PDF uploaded successfully and added to your Library.");
    await refreshHistory(activeSettings.apiBaseUrl, token).catch(() => {
      setNotice("PDF uploaded successfully. Your Library list will refresh the next time it opens.");
    });
    // The upload endpoint already created the canonical Library item. Reuse
    // that record instead of posting a second URL-less document.
    await beginReading(chunksFromDocument(document), options, document);
  }

  async function retryPendingPdfUpload() {
    const pending = pendingPdfUploadRef.current;
    if (!pending) return;
    try {
      setActiveTab("read");
      setActiveAction("upload-pdf");
      await readPdfFile(pending.file, pending.metadata, pending.options);
    } finally {
      setActiveAction(null);
    }
  }

  async function readPendingPdfLocally() {
    const pending = pendingPdfUploadRef.current;
    if (!pending) return;
    try {
      setActiveTab("read");
      setActiveAction("upload-pdf");
      await readPdfLocally(pending, "Opened in Chrome only. This PDF was not added to your synced Library.");
    } finally {
      setActiveAction(null);
    }
  }

  async function readPdfLocally(pending: PendingPdfUpload, message: string) {
    try {
      const pdfChunks = await extractPdfChunks(pending.file, pending.metadata);
      if (!pdfChunks.length) throw new Error("PDF text could not be extracted. This PDF may be scanned or image-only.");
      await beginReading(pdfChunks, { ...pending.options, sync: false });
      setUploadStatus((current) => ({
        phase: "local",
        fileName: pending.file.name,
        fileSize: pending.file.size,
        startedAt: current?.fileName === pending.file.name ? current.startedAt : Date.now(),
        finishedAt: Date.now(),
        loadedBytes: 0,
        totalBytes: pending.file.size,
        capacity: current?.capacity ?? entitlement ?? undefined,
        message
      }));
      setNotice(message);
    } catch (caught) {
      setUploadStatus((current) => ({
        phase: "failed",
        fileName: pending.file.name,
        fileSize: pending.file.size,
        startedAt: current?.fileName === pending.file.name ? current.startedAt : Date.now(),
        finishedAt: Date.now(),
        loadedBytes: 0,
        totalBytes: pending.file.size,
        capacity: current?.capacity ?? entitlement ?? undefined,
        message: caught instanceof Error ? caught.message : "Unable to extract text from this PDF."
      }));
    }
  }

  const chunkLabel = useMemo(() => {
    if (!chunks.length) return "No document loaded";
    return `Chunk ${player.currentChunkIndex + 1} of ${chunks.length}`;
  }, [chunks.length, player.currentChunkIndex]);

  if (!settings || !auth || (clerk?.isConfigured && !clerk.isLoaded)) return <main className="shell">Loading ReadMate...</main>;

  if (!auth.isSignedIn) {
    return (
      <main className="shell">
        <section className="hero">
          <div>
            <h1>ReadMate</h1>
            <p>Sign in to sync reading, preferences, PDFs, feeds, and history with mobile.</p>
          </div>
          <ReadMateLogo size="large" />
        </section>
        <section className="panel">
          <h2>Account required</h2>
          <p className="muted">ReadMate keeps your saved content and listening preferences tied to your account so Chrome and mobile stay in sync.</p>
          <div className="auth-box">
            <p className="muted">The Chrome sign-in screen is not available in this build. Rebuild the extension with Clerk enabled, then reload it from Chrome extensions.</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="addon-header">
        <div className="brand-lockup">
          <ReadMateLogo />
          <div>
            <h1>ReadMate</h1>
            <p>{contentHint}</p>
          </div>
        </div>
        <div className="header-actions">
          <span className={`sync-pill ${syncState.kind}`}>
            {syncState.kind === "synced" ? <CheckCircle2 /> : syncState.kind === "offline" ? <WifiOff /> : syncState.kind === "syncing" ? <RefreshCw /> : <HelpCircle />}
            {syncState.label}
          </span>
          <button className="icon-button" aria-label="Minimize side panel" title="Minimize" onClick={() => {
            sendToActiveTab({ type: "SHOW_FLOATING_PLAYER", visible: true }).catch(() => undefined);
            window.close();
          }}><Minus /></button>
          <button className="icon-button" aria-label="Close side panel" title="Close" onClick={() => window.close()}><X /></button>
        </div>
      </header>

      <nav className="tab-bar" aria-label="ReadMate sections">
        {TAB_CONFIG.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={activeTab === id ? "active" : ""}
            aria-selected={activeTab === id}
            onClick={() => setActiveTab(id)}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {uploadStatus ? (
        <DocumentUploadCard
          status={uploadStatus}
          busy={activeAction !== null}
          retryAvailable={Boolean(pendingPdfUploadRef.current)}
          localReadingAvailable={Boolean(pendingPdfUploadRef.current && isPdfFile(pendingPdfUploadRef.current.file))}
          onCancel={() => {
            pdfDownloadAbortControllerRef.current?.abort();
            uploadAbortControllerRef.current?.abort();
          }}
          onRetry={() => void retryPendingPdfUpload()}
          onReadLocally={() => void readPendingPdfLocally()}
          onDismiss={() => setUploadStatus(null)}
        />
      ) : null}

      {activeTab === "read" && (
        <section className="tab-pane" aria-label="Read">
          {hasLoadedContent ? (
            <section className="player-card">
              <div className="player-card-top">
                <div className="player-thumb" aria-hidden="true">
                  {activeHistoryDocument?.thumbnailUrl || activeHistoryDocument?.coverImageUrl
                    ? <img src={activeHistoryDocument.thumbnailUrl ?? activeHistoryDocument.coverImageUrl} alt="" />
                    : <span>{contentTypeInitial(currentChunk?.sourceType ?? activeHistoryDocument?.sourceType)}</span>}
                </div>
                <div className="player-meta">
                  <span className="player-label">Now reading</span>
                  <h2 className="player-title">{currentTitle}</h2>
                  <p className="player-source">{currentSource ?? "No source selected"} · {statusLabel(player.status)}</p>
                </div>
                <span className={`player-status-pill status-${player.status}`}>{statusLabel(player.status)}</span>
              </div>

              <div className="player-progress">
                <div style={{ width: `${Math.max(0, Math.min(100, currentProgress))}%` }} />
              </div>

              <div className="player-time-row">
                <span>{Math.round(currentProgress)}%</span>
                <span>{chunkLabel}</span>
                <span>{remainingLabel}</span>
              </div>

              {currentExcerpt ? (
                <p className="player-excerpt">{currentExcerpt}</p>
              ) : null}

              <div className="player-speech-disclosure" role="note" aria-label="Synthetic voice disclosure">
                <Sparkles aria-hidden="true" />
                <span>{speechDisclosure}</span>
              </div>

              <div className="controls" aria-label="Playback controls">
                <button
                  onClick={() => void playAdjacentChunk(-1)}
                  disabled={player.currentChunkIndex <= 0}
                  title="Previous paragraph"
                  aria-label="Previous paragraph"
                ><SkipBack /></button>
                <button onClick={() => seek(-10)} title="Back 10 seconds" aria-label="Back 10 seconds"><Rewind /></button>
                {player.status === "playing" ? (
                  <button className="primary play-toggle" onClick={pause} title="Pause" aria-label="Pause"><Pause /></button>
                ) : (
                  <button className="primary play-toggle" onClick={playCurrentChunk} title="Play" aria-label="Play"><Play /></button>
                )}
                <button onClick={stop} title="Stop" aria-label="Stop"><Square /></button>
                <button onClick={() => seek(10)} title="Forward 10 seconds" aria-label="Forward 10 seconds"><FastForward /></button>
                <button
                  onClick={() => void playAdjacentChunk(1)}
                  disabled={player.currentChunkIndex >= chunks.length - 1}
                  title="Next paragraph"
                  aria-label="Next paragraph"
                ><SkipForward /></button>
              </div>
            </section>
          ) : (
            <>
              <section className="panel smart-detect" aria-label="Current page">
                <div className="detect-ready-label">
                  <div className={`detect-ready-dot ${currentTabInfo ? "" : "inactive"}`} />
                  {currentTabInfo ? "CURRENT TAB · READY TO READ" : "NO READABLE WEB PAGE"}
                </div>
                {currentTabInfo ? (
                  <div className="detect-article-row">
                    {currentTabInfo.favicon ? (
                      <img src={currentTabInfo.favicon} className="detect-favicon-lg" alt="" />
                    ) : (
                      <div className="detect-favicon-fallback">
                        {(sourceLabel(currentTabInfo.url) ?? "?").slice(0, 4)}
                      </div>
                    )}
                    <div className="detect-article-meta">
                      <h2 className="detect-title">{currentTabInfo.title}</h2>
                      <div className="detect-source">
                        <span className="detect-domain">{sourceLabel(currentTabInfo.url) ?? "Current page"}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="protected-tab-guidance">
                    <strong>This Chrome page is protected.</strong>
                    <span>Open a regular website to read it, or use the PDF button below.</span>
                  </div>
                )}
                <button className="read-cta" onClick={readCurrentPage} disabled={activeAction !== null || !currentTabInfo}>
                  <Play size={14} /> {currentTabInfo ? "Read this page aloud" : "Open a web page first"}
                </button>
                <div className="secondary-action-row">
                  <button onClick={readSelection} disabled={activeAction !== null || !currentTabInfo || currentTabIsPdf} title={currentTabIsPdf ? "Use Read this page for PDFs" : undefined}>
                    <Mic2 size={13} /> <span>Selection</span>
                  </button>
                  <button className="sec-upload" type="button" disabled={activeAction !== null} onClick={() => pdfInputRef.current?.click()}>
                    <Upload size={13} /> <span>PDF</span>
                  </button>
                  <input
                    ref={pdfInputRef}
                    className="upload-file-input"
                    type="file"
                    accept="application/pdf,.pdf"
                    disabled={activeAction !== null}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = "";
                      void handlePdf(file);
                    }}
                  />
                  <button onClick={saveCurrentPage} disabled={activeAction !== null || !currentTabInfo}>
                    <Library size={13} /> <span>Save</span>
                  </button>
                </div>
              </section>

              {history.length > 0 && (
                <section className="panel up-next-card" aria-label="Up next">
                  <div className="up-next-header">
                    <div>
                      <span className="up-next-title">Up next</span>
                      <span className="up-next-caption">Saved items ready to play</span>
                    </div>
                    <button className="up-next-library" onClick={() => setActiveTab("library")}>View Library →</button>
                  </div>
                  {history.slice(0, 2).map((item, idx) => (
                    <div key={item.id} className={`up-next-row ${idx === Math.min(history.length - 1, 1) ? "last" : ""}`}>
                      <div className={`up-next-thumb up-next-tone-${idx % 2 === 0 ? "warm" : "sea"}`}>
                        {contentTypeInitial(item.sourceType)}
                      </div>
                      <div className="up-next-meta">
                        <div className="up-next-item-title">{item.title ?? "Untitled"}</div>
                        <div className="up-next-item-source">{sourceLabelFromDocument(item) ?? contentTypeLabel(item.sourceType)}</div>
                      </div>
                      <button className="up-next-play-btn" onClick={() => void replayHistoryItem(item)} aria-label={`Play ${item.title}`}>
                        <Play size={12} />
                      </button>
                    </div>
                  ))}
                </section>
              )}

              <section className="panel power-tip-card" aria-label="Tip">
                <div className="power-tip-icon"><Sparkles size={14} /></div>
                <div className="power-tip-text">
                  Right-click any text → <strong>Read with ReadMate</strong>.<br />
                  Or press <kbd>Alt</kbd><kbd>Shift</kbd><kbd>R</kbd> on any page.
                </div>
              </section>
            </>
          )}
        </section>
      )}

      {activeTab === "learn" && (
        <section className="tab-pane learn-pane" aria-label="Learn">

          {learningError && (
            <div className="learning-error-card" role="alert">
              <div className="learning-error-copy">
                <strong>Couldn’t generate {learningModeLabel(learningError.mode)}.</strong>
                <span>{learningErrorDetail(learningError.message)}</span>
              </div>
              <button onClick={retryLearningRequest} disabled={activeAction !== null}>Retry</button>
            </div>
          )}

          {/* ── HUB ── */}
          {learnView === "hub" && (
            <>
              {/* Context + Ask AI */}
              <section className="panel learn-context-card">
                <div className="learn-from-header">
                  <span className="learn-from-label">Learning from</span>
                  <button className="learn-change-btn" onClick={() => setActiveTab("history")}>
                    Change <ChevronDown size={11} />
                  </button>
                </div>
                <div className="learn-article-title">{learningTarget?.title ?? currentTitle}</div>
                <div className="learn-source-row">
                  <Rss size={11} />
                  <span className="learn-source-name">{sourceLabelFromDocument(learningTarget) ?? currentSource ?? "Current content"}</span>
                  <span className="learn-dot">·</span>
                  <span className="learn-ready">{learningTarget ? "Article ready" : "Read content first"}</span>
                </div>
                <div className="learn-ask-wrap">
                  <input
                    value={studyQuestion}
                    onChange={(event) => setStudyQuestion(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter" && studyQuestion.trim() && activeAction === null) void askActiveDocument(); }}
                    placeholder="Ask anything about this page…"
                    aria-label="Ask about this page"
                    className="learn-ask-input"
                  />
                  <button className="learn-ask-btn" onClick={askActiveDocument} disabled={activeAction !== null || !studyQuestion.trim()}>
                    <Send size={12} /> Ask
                  </button>
                </div>
                <div className="learn-prompt-chips">
                  {["Summarise in 3 lines", "Key takeaways", "ELI5"].map((prompt) => (
                    <button key={prompt} className="learn-prompt-chip" onClick={() => setStudyQuestion(prompt)}>{prompt}</button>
                  ))}
                </div>
              </section>

              {/* Generate grid */}
              <section className="panel learn-generate-card">
                <div className="generate-heading">Generate</div>
                <div className="generate-grid">
                  <button className="generate-tile" disabled={activeAction !== null} onClick={() => { setLearnView("summary"); void summarizeActiveDocument("summary"); }}>
                    <div className="generate-icon gen-blue"><BookOpen size={16} /></div>
                    <div className="generate-tile-body">
                      <div className="generate-tile-label">Summary</div>
                      <div className="generate-tile-note">{studyPanel.summary ? "Ready" : "~1 min"}</div>
                    </div>
                  </button>
                  <button className="generate-tile" disabled={activeAction !== null} onClick={() => { setLearnView("keypoints"); void summarizeActiveDocument("key-points"); }}>
                    <div className="generate-icon gen-amber"><List size={16} /></div>
                    <div className="generate-tile-body">
                      <div className="generate-tile-label">Key points</div>
                      <div className="generate-tile-note">{studyPanel.keyPoints?.length ? `${studyPanel.keyPoints.length} ready` : "Ready"}</div>
                    </div>
                  </button>
                  <button className="generate-tile" disabled={activeAction !== null} onClick={() => { setCardIndex(0); setCardFlipped(false); setLearnView("flashcards"); void summarizeActiveDocument("flashcards"); }}>
                    <div className="generate-icon gen-purple"><Layers size={16} /></div>
                    <div className="generate-tile-body">
                      <div className="generate-tile-label">Flashcards</div>
                      <div className="generate-tile-note">{studyPanel.flashcards?.length ? `${studyPanel.flashcards.length} cards` : `${learningCounts.flashcardCount} cards`}</div>
                    </div>
                  </button>
                  <button className="generate-tile" disabled={activeAction !== null} onClick={() => { setQuizIndex(0); setQuizAnswers([]); setQuizAnswerValues([]); setQuizSelected(null); setLearnView("quiz"); void summarizeActiveDocument("quiz"); }}>
                    <div className="generate-icon gen-green"><HelpCircle size={16} /></div>
                    <div className="generate-tile-body">
                      <div className="generate-tile-label">Quiz</div>
                      <div className="generate-tile-note">{studyPanel.quizQuestions?.length ? `${studyPanel.quizQuestions.length} questions` : `${learningCounts.quizCount} questions`}</div>
                    </div>
                  </button>
                </div>
              </section>

              <button className="mobile-study-btn" onClick={() => { const item = getActiveStudyTarget(); if (item) void sendToStudy(item); else setError("Read or save a page before sending it to Study."); }} disabled={activeAction !== null}>
                <ExternalLink size={13} /> Continue in mobile Study Mode
              </button>

              {learningTarget && (
                <div className="learn-source-mini">
                  <div className={`learn-source-mini-icon ${learningTarget.sourceType === "rss" ? "gen-amber" : "gen-blue"}`}>
                    {learningTarget.sourceType === "rss" ? <Rss size={12} /> : <FileText size={12} />}
                  </div>
                  <div className="learn-source-mini-body">
                    <div className="learn-source-mini-name">{sourceLabelFromDocument(learningTarget) ?? "Source"}</div>
                    <div className="learn-source-mini-meta">{learningTarget.progress?.percent ? `${Math.round(learningTarget.progress.percent)}% read` : "Not started"}</div>
                  </div>
                  <button className="learn-source-mini-ext" aria-label="Open source" onClick={() => { if (learningTarget.sourceUrl) chrome.tabs.create({ url: learningTarget.sourceUrl }); }}>
                    <ExternalLink size={13} />
                  </button>
                </div>
              )}
            </>
          )}

          {/* ── SUB-SCREENS ── */}
          {learnView !== "hub" && (
            <>
              {/* Shared GenHeader */}
              <div className="gen-header-wrap">
                <div className="gen-header">
                  <button className="gen-back-btn" onClick={() => setLearnView("hub")} aria-label="Back to Learn"><ChevronLeft size={14} /></button>
                  <span className="gen-breadcrumb">Learn</span>
                  <ChevronRight size={10} className="gen-sep" />
                  <span className={`gen-kind-badge gen-badge-${learnView === "quiz-result" ? "quiz" : learnView}`}>
                    {learnView === "summary" && <BookOpen size={11} />}
                    {learnView === "keypoints" && <List size={11} />}
                    {learnView === "flashcards" && <Layers size={11} />}
                    {(learnView === "quiz" || learnView === "quiz-result") && <HelpCircle size={11} />}
                    {learnView === "summary" ? "Summary" : learnView === "keypoints" ? "Key points" : learnView === "flashcards" ? "Flashcards" : "Quiz"}
                  </span>
                  <div style={{ flex: 1 }} />
                  <button className="gen-regen-btn" aria-label="Regenerate" disabled={activeAction !== null} onClick={() => {
                    const modeMap: Record<string, LearningActionMode> = { summary: "summary", keypoints: "key-points", flashcards: "flashcards", quiz: "quiz", "quiz-result": "quiz" };
                    const mode = modeMap[learnView] as LearningActionMode | undefined;
                    if (mode) void summarizeActiveDocument(mode);
                  }}><RefreshCw size={13} /></button>
                </div>

                <div className="gen-article-strip">
                  <div className={`gen-strip-thumb ${learningTarget?.sourceType === "rss" ? "gen-amber" : "gen-blue"}`}>
                    {learningTarget?.sourceType === "rss" ? <Rss size={11} /> : <FileText size={11} />}
                  </div>
                  <div className="gen-strip-meta">
                    <div className="gen-strip-title">{learningTarget?.title ?? currentTitle}</div>
                    <div className="gen-strip-sub">{sourceLabelFromDocument(learningTarget) ?? currentSource ?? "Source"}</div>
                  </div>
                  <button className="gen-strip-play" onClick={readCurrentPage} aria-label="Listen to article">
                    <Play size={11} />
                  </button>
                </div>
              </div>

              {/* Loading */}
              {activeAction === "study" && (
                <div className="gen-loading">
                  <RefreshCw size={16} className="gen-loading-spin" /> Generating…
                </div>
              )}

              {/* ── SUMMARY ── */}
              {learnView === "summary" && activeAction !== "study" && (
                studyPanel.summary ? (
                  <>
                    <div className="gen-card">
                      <div className="gen-tldr-label">TL;DR</div>
                      <p className="gen-tldr-text">{studyPanel.summary.split(/\.\s+/)[0]}.</p>
                      <div className="gen-divider" />
                      <div className="gen-full-label">Full summary</div>
                      <p className="gen-full-text">{studyPanel.summary}</p>
                    </div>
                    <div className="gen-action-row">
                      <button
                        className="gen-action-btn primary"
                        disabled={activeAction !== null}
                        onClick={() => void readStudyTextAloud(studyPanel.summary!, "Summary")}
                      ><Headphones size={13} /> Listen</button>
                      <button
                        className="gen-action-btn"
                        disabled={activeAction !== null}
                        onClick={() => void copyStudyText(studyPanel.summary!, "Summary")}
                      >Copy</button>
                      <span className="gen-action-status" role="status"><CheckCircle2 size={13} /> Saved with Study</span>
                    </div>
                    <div className="gen-footer-text">{STUDY_AI_DISCLOSURE}</div>
                  </>
                ) : (
                  <div className="gen-empty">No summary yet — tap Regenerate above to generate it.</div>
                )
              )}

              {/* ── KEY POINTS ── */}
              {learnView === "keypoints" && activeAction !== "study" && (
                studyPanel.keyPoints?.length ? (
                  <>
                    <div className="gen-card gen-card-flush">
                      {studyPanel.keyPoints.map((point, idx) => {
                        const tones = ["amber", "blue", "purple", "green"] as const;
                        const tone = tones[idx % tones.length];
                        return (
                          <div key={idx} className={`kp-row${idx === 0 ? " first" : ""}`}>
                            <div className={`kp-num gen-${tone}`}>{idx + 1}</div>
                            <div className="kp-body">
                              <div className="kp-text">{point}</div>
                              <div className="kp-row-actions">
                                <span className={`kp-tag gen-tag-${tone}`}>Point {idx + 1}</span>
                                <button
                                  className="kp-mini-btn"
                                  disabled={activeAction !== null}
                                  onClick={() => void readStudyTextAloud(point, `Key point ${idx + 1}`)}
                                ><Play size={9} /> Play</button>
                                <span className="kp-mini-status"><Layers size={9} /> Study point</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="gen-action-row">
                      <button
                        className="gen-action-btn primary"
                        disabled={activeAction !== null}
                        onClick={() => void readStudyTextAloud(studyPanel.keyPoints!.join("\n\n"), "All key points")}
                      ><Headphones size={13} /> Listen to all</button>
                      <span className="gen-action-status" role="status"><CheckCircle2 size={13} /> Saved with Study</span>
                    </div>
                    <div className="gen-footer-text">{STUDY_AI_DISCLOSURE}</div>
                  </>
                ) : (
                  <div className="gen-empty">No key points yet — tap Regenerate above to generate them.</div>
                )
              )}

              {/* ── FLASHCARDS ── */}
              {learnView === "flashcards" && activeAction !== "study" && (
                studyPanel.flashcards?.length ? (
                  <>
                    <div className="fc-progress-row">
                      <span className="fc-card-count">Card <strong>{Math.min(cardIndex + 1, studyPanel.flashcards.length)}</strong> of {studyPanel.flashcards.length}</span>
                      <div className="fc-progress-bar-wrap">
                        <div className="fc-progress-fill" style={{ width: `${(cardIndex / studyPanel.flashcards.length) * 100}%` }} />
                      </div>
                      <span className="fc-srs-badge">SRS</span>
                    </div>

                    <div className="fc-card-scene" role="button" aria-label={cardFlipped ? "Card showing answer, tap to flip back" : "Card showing question, tap to flip"} onClick={() => setCardFlipped(f => !f)}>
                      <div className={`fc-card-inner${cardFlipped ? " flipped" : ""}`}>
                        <div className="fc-card-face fc-card-front">
                          <div className="fc-side-badge">Question · Front</div>
                          <div className="fc-question-text">
                            {studyPanel.flashcards[Math.min(cardIndex, studyPanel.flashcards.length - 1)].front}
                          </div>
                          <div className="fc-flip-hint">↻ Tap card to reveal answer</div>
                        </div>
                        <div className="fc-card-face fc-card-back">
                          <div className="fc-side-badge fc-side-back">Answer · Back</div>
                          <div className="fc-question-text">
                            {studyPanel.flashcards[Math.min(cardIndex, studyPanel.flashcards.length - 1)].back}
                          </div>
                        </div>
                      </div>
                    </div>

                    {cardFlipped && (
                      <div className="srs-row">
                        {([
                          { label: "Again", sub: "<1m", cls: "srs-again", reviewStatus: "needs_review" },
                          { label: "Hard",  sub: "10m",  cls: "srs-hard", reviewStatus: "needs_review" },
                          { label: "Good",  sub: "1d",   cls: "srs-good", reviewStatus: "known" },
                          { label: "Easy",  sub: "4d",   cls: "srs-easy", reviewStatus: "known" },
                        ] as const).map(({ label, sub, cls, reviewStatus }) => (
                          <button key={label} className={`srs-btn ${cls}`} onClick={() => {
                            void syncFlashcardReview(reviewStatus);
                            const next = cardIndex + 1;
                            if (next >= studyPanel.flashcards!.length) {
                              setCardIndex(0);
                            } else {
                              setCardIndex(next);
                            }
                            setCardFlipped(false);
                          }}>
                            <span>{label}</span><span className="srs-sub">{sub}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="gen-action-row">
                      <button
                        className="gen-action-btn"
                        disabled={activeAction !== null}
                        onClick={() => {
                          const card = studyPanel.flashcards?.[Math.min(cardIndex, studyPanel.flashcards.length - 1)];
                          if (card) void readStudyTextAloud(cardFlipped ? card.back : card.front, cardFlipped ? "Flashcard answer" : "Flashcard question");
                        }}
                      ><Headphones size={13} /> {activeAction === "read-study" ? "Starting…" : "Read aloud"}</button>
                      <button
                        className="gen-action-btn"
                        disabled={(studyPanel.flashcards?.length ?? 0) <= 1 || activeAction !== null}
                        title={(studyPanel.flashcards?.length ?? 0) <= 1 ? "There is only one flashcard" : "Move to the next flashcard without grading it"}
                        onClick={skipFlashcard}
                      >Skip</button>
                      <button className="gen-action-btn" onClick={() => void openMobileApp(learningTarget)}><ExternalLink size={13} /> Mobile</button>
                    </div>
                    <div className="gen-footer-text">{studyPanel.flashcards.length} cards · synced to mobile</div>
                  </>
                ) : (
                  <div className="gen-empty">No flashcards yet — tap Regenerate above to generate them.</div>
                )
              )}

              {/* ── QUIZ ── */}
              {learnView === "quiz" && activeAction !== "study" && (
                studyPanel.quizQuestions?.length ? (
                  <>
                    <div className="quiz-progress-row">
                      <div className="quiz-bars">
                        {studyPanel.quizQuestions.map((_, i) => (
                          <div key={i} className={`quiz-bar${i < quizIndex ? (quizAnswers[i] ? " correct" : " wrong") : i === quizIndex ? " current" : ""}`} />
                        ))}
                      </div>
                      <div className="quiz-timer">00:00</div>
                    </div>

                    {quizIndex < studyPanel.quizQuestions.length ? (
                      <>
                        <div className="gen-card">
                          <div className="quiz-q-header">
                            <span className="quiz-q-num">{quizIndex + 1} of {studyPanel.quizQuestions.length}</span>
                            <span className="quiz-q-type">MULTIPLE CHOICE</span>
                          </div>
                          <div className="quiz-question-text">{studyPanel.quizQuestions[quizIndex].question}</div>
                          <div className="quiz-options">
                            {quizOptions.map((opt, i) => (
                              <button
                                key={opt.letter}
                                className={`quiz-option${quizSelected === i ? " selected" : ""}`}
                                onClick={() => setQuizSelected(i)}
                              >
                                <div className={`quiz-option-letter${quizSelected === i ? " selected" : ""}`}>{opt.letter}</div>
                                <div className="quiz-option-text">{opt.text}</div>
                                {quizSelected === i && <CheckCircle2 size={14} className="quiz-option-check" />}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="gen-action-row">
                          <button
                            className="gen-action-btn primary"
                            disabled={quizSelected === null}
                            onClick={() => {
                              const selectedAnswer = quizOptions[quizSelected!].text;
                              const isCorrect = quizOptions[quizSelected!].isCorrect;
                              const next = [...quizAnswers]; next[quizIndex] = isCorrect; setQuizAnswers(next);
                              const nextValues = [...quizAnswerValues]; nextValues[quizIndex] = selectedAnswer; setQuizAnswerValues(nextValues);
                              setQuizSelected(null);
                              if (quizIndex + 1 >= studyPanel.quizQuestions!.length) { setLearnView("quiz-result"); void syncQuizAttempt(nextValues); } else { setQuizIndex(quizIndex + 1); }
                            }}
                          >Submit answer</button>
                          <button className="gen-action-btn" onClick={() => {
                            const next = [...quizAnswers]; next[quizIndex] = false; setQuizAnswers(next);
                            const nextValues = [...quizAnswerValues]; nextValues[quizIndex] = ""; setQuizAnswerValues(nextValues);
                            setQuizSelected(null);
                            if (quizIndex + 1 >= studyPanel.quizQuestions!.length) { setLearnView("quiz-result"); void syncQuizAttempt(nextValues); } else { setQuizIndex(quizIndex + 1); }
                          }}>Skip</button>
                        </div>
                        <div className="gen-footer-text">{studyPanel.quizQuestions.length} questions · {quizIndex} answered</div>
                      </>
                    ) : null}
                  </>
                ) : (
                  <div className="gen-empty">No quiz questions yet — tap Regenerate above to generate them.</div>
                )
              )}

              {/* ── QUIZ RESULT ── */}
              {learnView === "quiz-result" && (() => {
                const total = studyPanel.quizQuestions?.length ?? 0;
                const correct = quizAnswers.filter(Boolean).length;
                const pct = total ? Math.round((correct / total) * 100) : 0;
                return (
                  <>
                    <div className="qr-score-card">
                      <div className="qr-donut" style={{ background: `conic-gradient(var(--rm-green) 0% ${pct}%, var(--rm-bg-alt) ${pct}% 100%)` }}>
                        <div className="qr-donut-inner">
                          <div className="qr-donut-percent">{pct}%</div>
                          <div className="qr-donut-frac">{correct} / {total}</div>
                        </div>
                      </div>
                      <div className="qr-title">{pct >= 80 ? "Strong recall" : pct >= 60 ? "Good progress" : "Keep practicing"}</div>
                      <div className="qr-sub">{correct < total ? `${total - correct} question${total - correct === 1 ? "" : "s"} to review.` : "Perfect! Try again later to reinforce memory."}</div>
                    </div>

                    {studyPanel.quizQuestions?.length ? (
                      <div className="gen-card gen-card-flush">
                        {studyPanel.quizQuestions.map((q, i) => (
                          <div key={i} className={`qr-row${i === 0 ? " first" : ""}`}>
                            <div className={`qr-status${quizAnswers[i] ? " correct" : " wrong"}`}>
                              {quizAnswers[i] ? <CheckCircle2 size={12} /> : <X size={11} />}
                            </div>
                            <div className="qr-q-body">
                              <div className="qr-q-text"><span className="qr-q-num">Q{i + 1}.</span> {q.question}</div>
                              {!quizAnswers[i] && <div className="qr-correct-ans">✓ {q.answer}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className="gen-action-row">
                      <button className="gen-action-btn primary" onClick={() => { setQuizIndex(0); setQuizAnswers([]); setQuizAnswerValues([]); setQuizSelected(null); setLearnView("quiz"); }}><RefreshCw size={13} /> Retry</button>
                      <button className="gen-action-btn" onClick={() => { setCardIndex(0); setCardFlipped(false); setLearnView("flashcards"); }}><Layers size={13} /> Cards</button>
                      <button className="gen-action-btn" onClick={() => void openMobileApp(learningTarget)}><ExternalLink size={13} /> Mobile</button>
                    </div>
                    <div className="gen-footer-text">Best score {pct}% · Completed</div>
                  </>
                );
              })()}
            </>
          )}
        </section>
      )}

      {activeTab === "library" && (
        <section className="tab-pane" aria-label="Library">
          <section className="panel library-panel">
            <div className="library-heading">
              <div>
                <h2>Your Library</h2>
                <p className="source-line">Every saved item, including unread content.</p>
              </div>
              <span className="library-count" aria-label={`${savedLibrary.length} saved items`}>{savedLibrary.length}</span>
            </div>
            <div className="history-search-bar">
              <Search size={14} className="history-search-icon" />
              <input
                value={librarySearch}
                onChange={(event) => setLibrarySearch(event.target.value)}
                placeholder="Search saved items…"
                aria-label="Search Library"
                className="history-search-input"
              />
            </div>
            <div className="library-list" aria-live="polite">
              {filteredLibrary.length ? filteredLibrary.map((item) => (
                <article className="library-row" key={item.id}>
                  <div className="thumb" aria-hidden="true">
                    {item.thumbnailUrl || item.coverImageUrl
                      ? <img src={item.thumbnailUrl ?? item.coverImageUrl} alt="" />
                      : contentTypeInitial(item.sourceType)}
                  </div>
                  <div className="library-main">
                    <strong title={item.title}>{item.title}</strong>
                    <span>{sourceLabelFromDocument(item) ?? contentTypeLabel(item.sourceType)} · {libraryStatusLabel(item)}</span>
                  </div>
                  <div className="library-row-actions" aria-label={`Actions for ${item.title}`}>
                    <button
                      type="button"
                      disabled={activeAction !== null}
                      onClick={() => void openLibraryItem(item)}
                      aria-label={`Open ${item.title}`}
                      title="Open"
                    ><FolderOpen /></button>
                    <button
                      type="button"
                      className="library-play"
                      disabled={activeAction !== null}
                      onClick={() => void replayHistoryItem(item)}
                      aria-label={`Play ${item.title}`}
                      title="Play"
                    ><Play /></button>
                    <button
                      type="button"
                      className="library-delete"
                      disabled={activeAction !== null}
                      onClick={() => void deleteLibraryItem(item)}
                      aria-label={`Delete ${item.title} from Library`}
                      title="Delete from Library"
                    ><Trash2 /></button>
                  </div>
                </article>
              )) : (
                <div className="library-empty">
                  <Library aria-hidden="true" />
                  <strong>{savedLibrary.length ? "No matching saved items" : "Your Library is empty"}</strong>
                  <span>{savedLibrary.length ? "Try a different title, author, source, or content type." : "Save a page or upload a PDF to see it here."}</span>
                  {savedLibrary.length ? <button type="button" onClick={() => setLibrarySearch("")}>Clear search</button> : null}
                </div>
              )}
            </div>
          </section>
        </section>
      )}

      {activeTab === "history" && (
        <section className="tab-pane" aria-label="History">
          <section className="panel">
            <div className="history-search-bar">
              <Search size={14} className="history-search-icon" />
              <input
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="Search history…"
                aria-label="Search history"
                className="history-search-input"
              />
            </div>
            <div className="filter-chips">
              {([
                { id: "all" as const,         label: `All${historyEntries.length ? ` · ${historyEntries.length}` : ""}` },
                { id: "in-progress" as const, label: "In progress" },
                { id: "finished" as const,    label: "Finished" },
              ]).map(chip => (
                <button
                  key={chip.id}
                  className={`filter-chip ${historyFilter === chip.id ? "active" : ""}`}
                  onClick={() => setHistoryFilter(chip.id)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <div className="history-toolbar">
              <div>
                <h2>History</h2>
                <p className="source-line">{filteredHistory.length ? `${filteredHistory.length} started or finished item${filteredHistory.length === 1 ? "" : "s"}` : "No reading activity"}</p>
              </div>
              {historyEntries.length ? <button className="history-clear" onClick={clearAllHistory}>Clear all</button> : null}
            </div>
            <div className="history-list compact-history">
              {filteredHistory.length ? displayedHistory.map((item) => (
                <div className="history-row" key={item.id}>
                  <div className="thumb" aria-hidden="true">{item.thumbnailUrl || item.coverImageUrl ? <img src={item.thumbnailUrl ?? item.coverImageUrl} alt="" /> : contentTypeInitial(item.sourceType)}</div>
                  <button className="history-main compact-main" onClick={() => replayHistoryItem(item)}>
                    <strong>{item.title}</strong>
                    <span>{sourceLabelFromDocument(item) ?? contentTypeLabel(item.sourceType)} · {item.progress.percent}% complete</span>
                  </button>
                  <button className="resume-button" onClick={() => replayHistoryItem(item)}>{item.progress.percent >= 100 ? "Replay" : "Resume"}</button>
                  <details className="overflow-menu">
                    <summary aria-label={`More actions for ${item.title}`}><MoreVertical /></summary>
                    <div className="menu-popover">
                      <button onClick={() => item.sourceUrl ? openSourceAndRead(item.sourceUrl) : replayHistoryItem(item)}>Open</button>
                      <button onClick={() => clearHistoryItem(item)}>Clear from history</button>
                      <button onClick={() => sendToStudy(item)}>Study</button>
                      <button className="danger" onClick={() => deleteLibraryItem(item)}>Delete from library</button>
                    </div>
                  </details>
                </div>
              )) : <p className="muted">{historyEntries.length ? "No matching items." : "No reading history yet. Saved items remain in your Library."}</p>}
              {filteredHistory.length > 5 ? <button className="view-all" onClick={() => setShowAllHistory((value) => !value)}>{showAllHistory ? "Show latest 5" : "View all history"}</button> : null}
            </div>
          </section>
        </section>
      )}

      {activeTab === "settings" && (
        <section className="tab-pane" aria-label="Settings">
          {/* Account card */}
          <section className="panel">
            <div className="settings-account-row">
              {auth.avatarUrl ? (
                <img src={auth.avatarUrl} alt="Avatar" className="settings-avatar-img" />
              ) : (
                <div className="settings-avatar-initials">
                  {auth.userName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="settings-account-info">
                <div className="settings-account-name">{auth.isSignedIn ? auth.userName : "Guest"}</div>
                <div className="settings-account-sub">{auth.isSignedIn ? "ReadMate account" : "Not signed in"}</div>
              </div>
              {auth.isSignedIn ? (
                <div className="settings-plus-badge"><Sparkles size={9} /> {entitlement?.isPremium ? "Premium" : entitlement ? "Free" : "Checking plan"}</div>
              ) : null}
            </div>
            <div className="settings-mini-row">
              <button className="settings-mini-btn" disabled={activeAction !== null} onClick={() => void manageSync()}>
                <RefreshCw size={12} /> {activeAction === "settings" ? "Syncing…" : "Manage sync"}
              </button>
              <button className="settings-mini-btn" disabled={activeAction !== null} onClick={() => void openMobileApp(activeHistoryDocument ?? learningTarget)}>
                <ExternalLink size={12} /> Mobile
              </button>
              <button className="settings-mini-btn settings-mini-danger" onClick={async () => {
                if (clerk?.signOut) await clerk.signOut();
                await clearManualSession();
                setAuth({ isSignedIn: false, token: null, userName: "Anonymous reader" });
              }}>
                <LogOut size={12} /> Sign out
              </button>
            </div>
          </section>

          {/* Voice card */}
          <section className="panel">
            <div className="settings-card-header">
              <div className="settings-card-icon settings-icon-blue"><Volume2 size={13} /></div>
              <div className="settings-card-title">Voice</div>
            </div>
            <div className="settings-field-label">Reading language</div>
            <div className="settings-picker-wrap" style={{ marginBottom: 10 }} title={providerRouteLabel}>
              <div className="settings-picker-value">{languageLabel(settings.targetLanguage)}</div>
              <div
                id="reading-language-route"
                className="settings-muted-inline"
                title={providerRouteLabel}
              >
                {providerRouteLabel}
              </div>
              <ChevronDown size={12} style={{ color: "var(--rm-muted)", flexShrink: 0 }} />
              <select
                className="settings-overlay-select"
                aria-label="Reading language"
                aria-describedby="reading-language-route"
                value={settings.targetLanguage}
                onChange={(event) => {
                  const targetLanguage = event.target.value as ExtensionSettings["targetLanguage"];
                  updateSettings({
                    ...settings,
                    targetLanguage,
                    voice: targetLanguage === "tw"
                      ? "ghananlp-asante-twi"
                      : settings.voice.startsWith("ghananlp-")
                        ? DEFAULT_VOICE_BY_PROVIDER[settings.ttsProvider]
                        : settings.voice
                  });
                }}
              >
                {TARGET_LANGUAGES.map((language) => (
                  <option key={language} value={language}>{languageLabel(language)}</option>
                ))}
              </select>
            </div>
            {settings.targetLanguage === "en" ? (
              <>
                <div className="settings-field-label">Voice provider</div>
                <div className="settings-picker-wrap" style={{ marginBottom: 10 }}>
                  <div className="settings-picker-value">{PROVIDER_LABELS[settings.ttsProvider]}</div>
                  <ChevronDown size={12} style={{ color: "var(--rm-muted)", flexShrink: 0 }} />
                  <select
                    className="settings-overlay-select"
                    value={settings.ttsProvider}
                    onChange={(event) => {
                      const provider = event.target.value as ExtensionSettings["ttsProvider"];
                      updateSettings({ ...settings, ttsProvider: provider, voice: DEFAULT_VOICE_BY_PROVIDER[provider] });
                    }}
                  >
                    {TTS_PROVIDERS.map((provider) => (
                      <option
                        key={provider}
                        value={provider}
                        disabled={isPremiumProvider(provider) && !entitlement?.isPremium && settings.ttsProvider !== provider}
                      >
                        {PROVIDER_LABELS[provider]}{isPremiumProvider(provider) && !entitlement?.isPremium ? " (upgrade on mobile)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : settings.targetLanguage === "tw" ? (
              <>
                <div className="settings-field-label">Twi variety</div>
                <div className="settings-picker-wrap" style={{ marginBottom: 10 }}>
                  <div className="settings-picker-value">{settings.voice === "ghananlp-akuapem-twi" ? "Akuapem Twi" : "Asante Twi"}</div>
                  <ChevronDown size={12} style={{ color: "var(--rm-muted)", flexShrink: 0 }} />
                  <select
                    className="settings-overlay-select"
                    value={settings.voice === "ghananlp-akuapem-twi" ? settings.voice : "ghananlp-asante-twi"}
                    onChange={(event) => updateSettings({ ...settings, voice: event.target.value })}
                  >
                    <option value="ghananlp-akuapem-twi">Akuapem Twi</option>
                    <option value="ghananlp-asante-twi">Asante Twi</option>
                  </select>
                </div>
              </>
            ) : null}
            {settings.targetLanguage === "en" ? <div className="settings-voice-row">
              <div style={{ flex: 1 }}>
                <div className="settings-field-label">Voice</div>
                <div className="settings-picker-wrap">
                  <div className="settings-voice-swatch" />
                  <div className="settings-picker-value">{VOICE_LABELS[settings.voice] ?? settings.voice}</div>
                  <button type="button" className="settings-voice-play" aria-label="Preview voice" disabled={previewingVoice} onClick={() => void previewSelectedVoice()}><Play size={10} /></button>
                  <ChevronDown size={12} style={{ color: "var(--rm-muted)", flexShrink: 0 }} />
                  <select
                    className="settings-overlay-select"
                    value={settings.voice}
                    onChange={(event) => updateSettings({ ...settings, voice: event.target.value })}
                  >
                    {voicesForProvider(settings.ttsProvider).map((voice) => (
                      <option key={voice} value={voice}>{VOICE_LABELS[voice] ?? voice}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div> : null}
            <div className="settings-field-label" style={{ marginTop: 8 }}>Speed</div>
            <div className="settings-picker-wrap" style={{ marginBottom: 10 }}>
              <div className="settings-picker-value">{settings.speed}×</div>
              <ChevronDown size={12} style={{ color: "var(--rm-muted)", flexShrink: 0 }} />
              <select
                className="settings-overlay-select"
                value={settings.speed}
                onChange={(event) => updateSettings({ ...settings, speed: Number(event.target.value) })}
              >
                {SPEEDS.map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
              </select>
            </div>
          </section>

          {/* Reading card */}
          <section className="panel">
            <div className="settings-card-header">
              <div className="settings-card-icon settings-icon-amber"><BookOpen size={13} /></div>
              <div className="settings-card-title">Reading</div>
            </div>
            <div className="settings-toggle-row">
              <div className="settings-toggle-label">Auto-scroll page as I listen</div>
              <button
                role="switch"
                aria-checked={settings.autoScroll}
                className={`settings-toggle ${settings.autoScroll ? "on" : ""}`}
                onClick={() => updateSettings({ ...settings, autoScroll: !settings.autoScroll })}
              ><div className="settings-toggle-thumb" /></button>
            </div>
            <div className="settings-toggle-row">
              <div>
                <div className="settings-toggle-label">Highlight what's being read</div>
                <div className="settings-toggle-sub-row">
                  <button className="settings-sub-chip" onClick={() => {
                    const next: ExtensionSettings["highlightMode"] = settings.highlightMode === "sentence" ? "paragraph" : settings.highlightMode === "paragraph" ? "none" : "sentence";
                    updateSettings({ ...settings, highlightMode: next });
                  }}>
                    {settings.highlightMode === "sentence" ? "By sentence" : settings.highlightMode === "paragraph" ? "By paragraph" : "Off"} <ChevronDown size={10} />
                  </button>
                </div>
              </div>
              <button
                role="switch"
                aria-checked={settings.highlightMode !== "none"}
                className={`settings-toggle ${settings.highlightMode !== "none" ? "on" : ""}`}
                onClick={() => updateSettings({ ...settings, highlightMode: settings.highlightMode !== "none" ? "none" : "sentence" })}
              ><div className="settings-toggle-thumb" /></button>
            </div>
            <div className="settings-info-row">
              <div>
                <div className="settings-toggle-label">Saved article playback</div>
                <div className="settings-info-copy">Saved items wait for you to press Play, preventing unexpected audio.</div>
              </div>
              <span className="settings-static-pill">Manual</span>
            </div>
          </section>

          {/* Privacy card */}
          <section className="panel">
            <div className="settings-card-header">
              <div className="settings-card-icon settings-icon-green"><Lock size={12} /></div>
              <div className="settings-card-title">Privacy</div>
            </div>
            <p className="settings-privacy-text">ReadMate only reads pages when you explicitly ask. We don't track your browsing.</p>
            <p className="settings-privacy-text">When you press Play, the text being read is sent to ReadMate and to {languageProviderLabel(settings.targetLanguage, settings.ttsProvider)} to generate AI audio.</p>
            <div className="settings-data-actions">
              <button className="settings-manage-btn" onClick={() => setActiveTab("library")}>
                <Library size={12} /> Review saved data
              </button>
              <button className="settings-manage-btn" onClick={() => void openChromePermissions()}>
                <ExternalLink size={12} /> Chrome permissions
              </button>
            </div>
          </section>

          <div className="settings-version">Version {extensionVersion} · ReadMate</div>
        </section>
      )}

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}
    </main>
  );
}

function DocumentUploadCard({
  status,
  busy,
  retryAvailable,
  localReadingAvailable,
  onCancel,
  onRetry,
  onReadLocally,
  onDismiss
}: {
  status: DocumentUploadStatus;
  busy: boolean;
  retryAvailable: boolean;
  localReadingAvailable: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onReadLocally: () => void;
  onDismiss: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const active = status.phase === "downloading" || status.phase === "checking" || status.phase === "uploading" || status.phase === "processing";
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active, status.startedAt]);

  const elapsedSeconds = uploadElapsedSeconds(status, now);
  const progress = status.phase === "checking"
    ? 0
    : status.phase === "processing" || status.phase === "ready"
      ? 100
      : uploadPercent(status.loadedBytes, status.totalBytes);
  const eta = status.phase === "uploading" || status.phase === "downloading"
    ? estimateUploadRemainingSeconds(status.loadedBytes, status.totalBytes, status.transferStartedAt, now)
    : null;
  const title = uploadPhaseTitle(status);
  const showProgress = status.phase === "downloading" || status.phase === "checking" || status.phase === "uploading" || status.phase === "processing" || status.phase === "ready";
  const canRetry = retryAvailable && (status.phase === "failed" || status.phase === "cancelled" || status.phase === "gated");
  const canReadLocally = localReadingAvailable && (status.phase === "failed" || status.phase === "cancelled" || status.phase === "gated");
  const role = status.phase === "failed" || status.phase === "gated" ? "alert" : undefined;
  const indeterminate = status.phase === "checking" || status.phase === "processing" || (status.phase === "downloading" && status.totalBytes <= 0);

  return (
    <section className={`upload-status-card upload-${status.phase}`} role={role} aria-busy={active}>
      {role !== "alert" ? <span className="sr-only" role="status" aria-live="polite">{uploadPhaseAnnouncement(status)}</span> : null}
      <div className="upload-status-header">
        <div className="upload-status-icon" aria-hidden="true">
          {status.phase === "ready" ? <CheckCircle2 /> : status.phase === "gated" ? <Lock /> : status.phase === "failed" ? <HelpCircle /> : <Upload />}
        </div>
        <div className="upload-status-heading">
          <span className="upload-status-kicker">{status.phase === "downloading" ? "PDF from this tab" : "Document upload"}</span>
          <h2 aria-live="polite">{title}</h2>
        </div>
        {status.phase === "uploading" || status.phase === "downloading" ? (
          <button type="button" className="upload-status-dismiss" onClick={onCancel}>Cancel</button>
        ) : status.phase !== "checking" && status.phase !== "processing" ? (
          <button type="button" className="upload-status-close" aria-label="Dismiss upload status" onClick={onDismiss}><X /></button>
        ) : null}
      </div>

      <p className="upload-file-name" title={status.fileName}>{status.fileName}</p>

      {showProgress ? (
        <>
          <div
            className={`upload-progress-track ${indeterminate ? "indeterminate" : ""}`}
            role="progressbar"
            aria-label={status.phase === "downloading" ? "PDF download progress" : status.phase === "processing" ? "Upload complete; processing document" : "Document upload progress"}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={status.phase === "checking" || (status.phase === "downloading" && status.totalBytes <= 0) ? undefined : progress}
            aria-valuetext={status.phase === "downloading"
              ? status.totalBytes > 0 ? `${progress}% downloaded` : `${formatBytes(status.loadedBytes)} downloaded; total size unknown`
              : status.phase === "checking"
              ? "Checking file and plan limits."
              : status.phase === "processing"
                ? "Upload complete. Processing document."
                : `${progress}% uploaded`}
          >
            <div style={{ width: status.phase === "checking" ? "35%" : `${progress}%` }} />
          </div>
          <div className="upload-progress-meta">
            <span>{status.phase === "downloading" ? status.totalBytes > 0 ? `${progress}%` : formatBytes(status.loadedBytes) : status.phase === "uploading" ? `${progress}%` : status.phase === "checking" ? "Checking" : status.phase === "processing" ? "Uploaded" : "100%"}</span>
            <span>{uploadTimingLabel(status, elapsedSeconds, eta)}</span>
          </div>
        </>
      ) : null}

      <div className="upload-capacity-row">
        <span>{status.fileSize > 0
          ? `${formatBytes(status.fileSize)} file`
          : status.phase === "downloading" && status.loadedBytes > 0
            ? `${formatBytes(status.loadedBytes)} downloaded`
            : "File size checking"}</span>
        <span>{uploadPlanSummary(status.capacity, status.phase)}</span>
      </div>

      {status.message ? <p className="upload-status-message">{status.message}</p> : null}

      {status.phase === "processing" ? (
        <p className="upload-processing-note">The transfer is finished. Processing time depends on the PDF length, so ReadMate shows elapsed time instead of a misleading percentage.</p>
      ) : null}

      {status.phase === "gated" ? (
        <p className="upload-processing-note">To upgrade, open ReadMate mobile and choose More → Upgrade to Premium. If you already upgraded, select Check again.</p>
      ) : null}

      {canRetry || canReadLocally ? (
        <div className="upload-status-actions">
          {canRetry ? <button type="button" className="upload-retry" disabled={busy} onClick={onRetry}>{status.phase === "gated" ? "Check again" : "Retry upload"}</button> : null}
          {canReadLocally ? <button type="button" disabled={busy} onClick={onReadLocally}>Read locally</button> : null}
          <button type="button" disabled={busy} onClick={onDismiss}>Dismiss</button>
        </div>
      ) : status.phase === "local" || status.phase === "ready" ? (
        <div className="upload-status-actions"><button type="button" onClick={onDismiss}>Dismiss</button></div>
      ) : null}
    </section>
  );
}

function uploadPhaseTitle(status: DocumentUploadStatus): string {
  if (status.phase === "downloading") return status.totalBytes > 0 ? `Downloading from this tab · ${uploadPercent(status.loadedBytes, status.totalBytes)}%` : "Downloading PDF from this tab";
  if (status.phase === "checking") return "Checking your file and plan";
  if (status.phase === "uploading") return `Uploading · ${uploadPercent(status.loadedBytes, status.totalBytes)}%`;
  if (status.phase === "processing") return "Upload complete · Processing document";
  if (status.phase === "ready") return "Ready in your Library";
  if (status.phase === "gated") return "Premium is required for this document";
  if (status.phase === "cancelled") return "Upload cancelled";
  if (status.phase === "local") return "Reading locally in Chrome";
  return "Upload needs attention";
}

function uploadPhaseAnnouncement(status: DocumentUploadStatus): string {
  if (status.phase === "downloading") return "Downloading PDF from the current tab.";
  if (status.phase === "checking") return "Checking the file and account plan.";
  if (status.phase === "uploading") return "Uploading document to ReadMate.";
  if (status.phase === "processing") return "Upload complete. Processing document.";
  if (status.phase === "ready") return "Document is ready in your Library.";
  if (status.phase === "cancelled") return "Document upload cancelled.";
  if (status.phase === "local") return "Document opened locally in Chrome.";
  return "Document upload needs attention.";
}

function uploadTimingLabel(status: DocumentUploadStatus, elapsedSeconds: number, eta: number | null): string {
  if (status.phase === "downloading") {
    const transferred = status.totalBytes > 0
      ? `${formatBytes(status.loadedBytes)} of ${formatBytes(status.totalBytes)}`
      : `${formatBytes(status.loadedBytes)} downloaded`;
    return eta ? `${transferred} · about ${formatDuration(eta)} left` : `${transferred} · ${formatDuration(elapsedSeconds)} elapsed`;
  }
  if (status.phase === "uploading") {
    const transferred = `${formatBytes(status.loadedBytes)} of ${formatBytes(status.fileSize)}`;
    return eta ? `${transferred} · about ${formatDuration(eta)} left` : `${transferred} · ${formatDuration(elapsedSeconds)} elapsed`;
  }
  if (status.phase === "processing") return `Processing for ${formatDuration(elapsedSeconds)}`;
  if (status.phase === "ready") return `Completed in ${formatDuration(elapsedSeconds)}`;
  return `${formatDuration(elapsedSeconds)} elapsed`;
}

function tabLabel(tab: ExtensionTab): string {
  if (tab === "read") return "Read";
  if (tab === "learn") return "Learn";
  if (tab === "library") return "Library";
  if (tab === "history") return "History";
  return "Settings";
}

function learnNoticeForMode(mode: LearningActionMode): string {
  if (mode === "key-points") return "Key points are ready.";
  if (mode === "flashcards") return "Flashcards are ready.";
  if (mode === "quiz") return "Quiz questions are ready.";
  if (mode === "study") return "Study material is ready.";
  return "Short summary is ready.";
}

function uploadErrorDetail(message: string): string {
  return message.replace(/^Unable to upload this PDF[.:]?\s*/i, "").trim() || "ReadMate could not upload this PDF.";
}

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function clampStudyCount(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function buildLearningComponents(panel: StudyPanelState, target: ReadingDocument | undefined): LearningUiComponent[] {
  const components: LearningUiComponent[] = [];
  if (panel.answer) {
    components.push({
      component: panel.mode === "explain" ? "ExplanationCard" : "AnswerCard",
      title: panel.mode === "explain" ? "Simple explanation" : panel.lastQuestion || "Answer",
      body: panel.answer
    });
  }
  if (panel.summary) {
    components.push({ component: "SummaryCard", title: "Summary", body: panel.summary });
  }
  if (panel.keyPoints?.length) {
    components.push({ component: "KeyPointsList", title: "Key points", items: panel.keyPoints.slice(0, 6) });
  }
  if (panel.flashcards?.length) {
    components.push({ component: "FlashcardPreview", title: `Flashcards (${panel.flashcards.length})`, cards: panel.flashcards });
  }
  if (panel.quizQuestions?.length) {
    components.push({ component: "QuizQuestionCard", title: `Quiz questions (${panel.quizQuestions.length})`, questions: panel.quizQuestions });
  }
  if (panel.citedSections?.length) {
    components.push({ component: "SourceCard", title: "Based on", items: panel.citedSections.slice(0, 3) });
  } else if (target) {
    components.push({
      component: "SourceCard",
      title: "Source",
      items: [sourceLabelFromDocument(target) ?? contentTypeLabel(target.sourceType), `${target.progress.percent}% complete`]
    });
  }
  if (components.length) {
    components.push({
      component: "ActionButtonGroup",
      actions: [
        { label: "Save to notes", action: "save_note" },
        { label: "Create flashcards", action: "create_flashcards" },
        { label: "Create quiz", action: "create_quiz" },
        { label: "Send to Study Mode", action: "send_to_study" }
      ]
    });
  }
  return components;
}

function clearStudyPanelForDocument(panel: StudyPanelState, item: ReadingDocument): StudyPanelState {
  if (panel.documentId && panel.documentId !== item.id) return panel;
  return {};
}

function studyPanelForDocument(panel: StudyPanelState, item: ReadingDocument): StudyPanelState {
  if (panel.documentId === item.id) return panel;
  return {
    documentId: item.id,
    summary: item.summary,
    keyPoints: item.keyPoints,
    flashcards: item.flashcards,
    quizQuestions: item.quizQuestions
  };
}

function flashcardsFromReview(review: LearningReview): StudyFlashcard[] {
  return review.flashcards.map((card) => ({
    id: card.id,
    front: card.question,
    back: card.answer,
    reviewStatus: card.reviewStatus
  }));
}

function quizQuestionsFromReview(review: LearningReview): StudyQuizQuestion[] {
  return review.quizQuestions.map((question) => ({
    id: question.id,
    question: question.question,
    answer: question.correctAnswer,
    options: question.options,
    correctAnswer: question.correctAnswer,
    explanation: question.explanation
  }));
}

function renderLearningComponent(component: LearningUiComponent, index: number, onAction: (action: LearningComponentAction) => void) {
  const key = `${component.component}-${index}`;
  if (component.component === "AnswerCard" || component.component === "SummaryCard" || component.component === "ExplanationCard") {
    return (
      <article className="learning-card" key={key}>
        <span className="component-label">{learningComponentLabel(component.component)}</span>
        <h3>{component.title}</h3>
        <p>{component.body}</p>
      </article>
    );
  }
  if (component.component === "KeyPointsList" || component.component === "SourceCard") {
    return (
      <article className="learning-card" key={key}>
        <span className="component-label">{learningComponentLabel(component.component)}</span>
        <h3>{component.title}</h3>
        <ul className="key-points">
          {component.items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </article>
    );
  }
  if (component.component === "FlashcardPreview") {
    return (
      <article className="learning-card" key={key}>
        <span className="component-label">{learningComponentLabel(component.component)}</span>
        <h3>{component.title}</h3>
        <div className="preview-stack">
          {component.cards.map((card) => (
            <div className="preview-card" key={card.front}>
              <strong>{card.front}</strong>
              <p>{card.back}</p>
            </div>
          ))}
        </div>
      </article>
    );
  }
  if (component.component === "QuizQuestionCard") {
    return (
      <article className="learning-card" key={key}>
        <span className="component-label">{learningComponentLabel(component.component)}</span>
        <h3>{component.title}</h3>
        <div className="preview-stack">
          {component.questions.map((question) => (
            <div className="preview-card" key={question.question}>
              <strong>{question.question}</strong>
              <p>{question.answer}</p>
            </div>
          ))}
        </div>
      </article>
    );
  }
  return (
    <article className="learning-card action-card" key={key}>
      <span className="component-label">{learningComponentLabel(component.component)}</span>
      <div className="component-actions">
        {component.actions.map((action) => (
          <button key={action.action} onClick={() => onAction(action.action)}>{action.label}</button>
        ))}
      </div>
    </article>
  );
}

function learningComponentLabel(component: LearningUiComponent["component"]): string {
  if (component === "AnswerCard") return "Answer";
  if (component === "SummaryCard") return "Summary";
  if (component === "KeyPointsList") return "Key points";
  if (component === "ExplanationCard") return "Explanation";
  if (component === "FlashcardPreview") return "Flashcards";
  if (component === "QuizQuestionCard") return "Quiz";
  if (component === "SourceCard") return "Source";
  return "Actions";
}

function statusLabel(status: string): string {
  if (status === "idle") return "Ready";
  if (status === "ended") return "Completed";
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}

function libraryStatusLabel(document: ReadingDocument): string {
  if (document.status === "completed" || document.progress.percent >= 100) return "Finished";
  if (document.status === "in_progress" || document.progress.percent > 0 || document.lastReadAt) {
    return `${Math.round(document.progress.percent)}% complete`;
  }
  return "Unread";
}

function learningModeLabel(mode: LearningActionMode): string {
  if (mode === "summary") return "Summary";
  if (mode === "key-points") return "Key points";
  if (mode === "flashcards") return "Flashcards";
  if (mode === "quiz") return "Quiz";
  if (mode === "explain") return "Explanation";
  return "Study material";
}

function learningErrorDetail(message: string): string {
  return message
    .replace(/^(?:(?:Unable to|Could not) send this item to Study|(?:Unable to|Could not) generate (?:Study|learning) material)\.?\s*:\s*/i, "")
    .replace(/^(?:(?:Unable to|Could not) send this item to Study|(?:Unable to|Could not) generate (?:Study|learning) material)\.?$/i, "Please try again.");
}

function contentDetectionHint(chunk: ReadingChunk | undefined, hasLoadedContent: boolean, status: string): string {
  if (hasLoadedContent && chunk?.sourceType === "pdf") return "PDF detected and ready.";
  if (hasLoadedContent && chunk?.sourceType === "selection") return "Selected text ready.";
  if (hasLoadedContent && status === "playing") return "Playing and syncing progress.";
  if (hasLoadedContent) return "Article ready.";
  return "Capture, read, save, and continue.";
}

function contentTypeLabel(sourceType: ReadingDocument["sourceType"] | undefined): string {
  if (sourceType === "pdf") return "PDF";
  if (sourceType === "selection") return "Selection";
  if (sourceType === "rss" || sourceType === "news") return "Feed";
  if (sourceType === "webpage" || sourceType === "url") return "Web";
  if (sourceType === "ocr") return "Screen text";
  return "Document";
}

function contentTypeInitial(sourceType: ReadingDocument["sourceType"]): string {
  return contentTypeLabel(sourceType).slice(0, 1).toUpperCase();
}

function sourceLabel(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function sourceLabelFromDocument(document: ReadingDocument | undefined): string | undefined {
  return document?.sourceLabel ?? sourceLabel(document?.sourceUrl);
}

function shouldUseSpeechFallback(message: string, targetLanguage: ExtensionSettings["targetLanguage"]): boolean {
  if (targetLanguage !== "en") return false;
  return message === AUTH_REQUIRED_ERROR || message === TTS_AUTH_REQUIRED_ERROR || /insufficient_quota|quota|billing|Failed to fetch|API key is not configured|credentials are not configured|Google TTS|Unable to generate speech/i.test(message);
}

function speechFallbackMessage(message: string): string {
  if (message === AUTH_REQUIRED_ERROR || message === TTS_AUTH_REQUIRED_ERROR) {
    return "ReadMate is using this browser's local speech voice because the synced TTS session is not available. Open Account and sign in again if you want cloud voices.";
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return "ReadMate could not reach the cloud voice service, so it is using this browser's local speech voice to keep playback going.";
  }
  if (/quota|billing|API has not been used|API is disabled|not enabled/i.test(message)) {
    return "Google voice needs a Cloud Text-to-Speech project or billing fix, so ReadMate is using this browser's local speech voice for now.";
  }
  return "Google voice is temporarily unavailable, so ReadMate is using this browser's local speech voice to keep playback going.";
}

function playbackErrorMessage(message: string, targetLanguage: ExtensionSettings["targetLanguage"]): string {
  if (message === AUTH_REQUIRED_ERROR || message === TTS_AUTH_REQUIRED_ERROR) {
    const language = languageLabel(targetLanguage);
    return `Your ReadMate session needs to be refreshed before ${language} cloud audio can play. Reopen ReadMate or sign in again, then press Play.`;
  }
  return message;
}

function documentSyncFallbackMessage(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : "";
  if (message === AUTH_REQUIRED_ERROR || message === TTS_AUTH_REQUIRED_ERROR) {
    return "This reading started locally because your ReadMate sign-in session expired. Open Account, sign out, then sign in again to sync across devices.";
  }
  return message
    ? `This reading started locally because document sync failed: ${message}`
    : "This reading started locally because document sync failed. Try again after checking your connection.";
}

function pdfTitleFromUrl(url: string, fallback?: string): string {
  try {
    const title = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "").trim();
    return title || fallback || "Uploaded PDF";
  } catch {
    return fallback || "Uploaded PDF";
  }
}

async function removeLocalHistoryItem(documentId: string) {
  const local = await chrome.storage.local.get(LOCAL_HISTORY_KEY);
  const docs = ((local[LOCAL_HISTORY_KEY] ?? []) as ReadingDocument[]).filter((entry) => entry.id !== documentId);
  await chrome.storage.local.set({ [LOCAL_HISTORY_KEY]: docs });
}

function isLocalOnlyDocument(document: ReadingDocument): boolean {
  return document.userId === "anonymous" || isUuid(document.id);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function chooseBrowserVoice(preferredName: string): Promise<SpeechSynthesisVoice | null> {
  const voices = await loadBrowserVoices();
  return (
    voices.find((voice) => voice.name.toLowerCase().includes(preferredName.toLowerCase())) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) ??
    null
  );
}

function loadBrowserVoices(timeoutMs = 700): Promise<SpeechSynthesisVoice[]> {
  const voices = speechSynthesis.getVoices();
  if (voices.length) return Promise.resolve(voices);

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      speechSynthesis.onvoiceschanged = null;
      resolve(speechSynthesis.getVoices());
    }, timeoutMs);
    speechSynthesis.onvoiceschanged = () => {
      window.clearTimeout(timeout);
      speechSynthesis.onvoiceschanged = null;
      resolve(speechSynthesis.getVoices());
    };
  });
}

function languageLabel(language: ExtensionSettings["targetLanguage"]): string {
  if (language === "tw") return "Twi";
  if (language === "ee") return "Ewe";
  if (language === "gaa") return "Ga";
  return "English";
}

function estimateSpeechDuration(text: string, speed: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round((words / 160) * 60 / speed));
}

function chunksFromDocument(document: ReadingDocument): ReadingChunk[] {
  return (document.blocks ?? [])
    .filter((block) => typeof block.text === "string" && block.text.trim().length > 0)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((block, index) => ({
      id: block.id ?? `${document.id}-${index}`,
      text: block.text,
      sourceType: document.sourceType,
      pageUrl: document.sourceUrl,
      title: document.title,
      thumbnailUrl: document.thumbnailUrl,
      author: document.author,
      description: document.description,
      elementSelector: block.sourceSelector,
      elementSelectors: block.sourceSelector ? [block.sourceSelector] : undefined,
      pageNumber: block.sourcePageNumber
    }));
}

function deterministicShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.abs(seed * 31 + i * 17) % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function generateMCQOptions(
  questions: StudyQuizQuestion[],
  index: number
): Array<{ letter: string; text: string; isCorrect: boolean }> {
  if (!questions.length) return [];
  const question = questions[index];
  const correct = question?.correctAnswer ?? question?.answer ?? "";
  const distractors = question?.options?.length
    ? question.options.filter((option) => option !== correct)
    : questions
        .filter((_, i) => i !== index)
        .map(q => q.correctAnswer ?? q.answer);
  const fillers = ["None of the above", "It cannot be determined", "All of the above"];
  while (distractors.length < 3) distractors.push(fillers[distractors.length % fillers.length]);
  const opts = [correct, ...distractors.slice(0, 3)];
  const shuffled = deterministicShuffle(opts, index);
  return shuffled.map((text, i) => ({
    letter: ["A", "B", "C", "D"][i],
    text,
    isCorrect: text === correct,
  }));
}

function tabInfoFromTab(tab: chrome.tabs.Tab | undefined): { title: string; url: string; favicon?: string } | null {
  if (!tab?.url || !canInjectIntoUrl(tab.url)) return null;
  return {
    title: tab.title ?? "Current page",
    url: tab.url,
    favicon: tab.favIconUrl
  };
}

function shouldResetLoadedArticleForTabChange(loadedUrl: string | null, activeTabUrl: string | undefined): boolean {
  if (!loadedUrl || !activeTabUrl) return false;
  const loaded = normalizeComparablePageUrl(loadedUrl);
  const active = normalizeComparablePageUrl(activeTabUrl);
  return Boolean(loaded && active && loaded !== active);
}

function isProtectedTabMessage(message: string | null): boolean {
  return Boolean(message && /Chrome protects this page|cannot access this (?:tab|browser page)/i.test(message));
}

function normalizeComparablePageUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.sort();
    return url.href.replace(/\/$/, "");
  } catch {
    return value.trim().replace(/#.*$/, "").replace(/\/$/, "");
  }
}

function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(done, 8_000);
    function done() {
      window.clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") done();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function createReadRequestId(): string {
  return crypto.randomUUID?.() ?? `readmate-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
