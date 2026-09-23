import { useAuth } from "@clerk/expo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from "expo-audio";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { Platform } from "react-native";
import { ApiError } from "@/api/client";
import { createSpeechAudioFile, createSpeechCastUrl, getDocument, getUserSettings, updateDocumentProgress } from "@/api/documents";
import { needsFullDocument, withKnownBlocks } from "@/utils/document-blocks";
import { addOutputStateListener, loadOutputMedia, sendOutputCommand, showOutputPicker as presentOutputPicker, type OutputMedia, type OutputState } from "@/native/output";
import { AI_AUDIO_DISCLOSURE_TITLE, aiAudioMetadataSubtitle } from "@/playback/ai-audio-disclosure";
import { endPlaybackLiveActivity, updatePlaybackLiveActivity } from "@/playback/live-activity";
import type { ReadMatePlaybackActivityProps } from "@/widgets/readmate-playback-activity";
import type { ReadingDocument, UserSettings } from "@/types";

export type PlaybackState = "idle" | "loading" | "ready" | "playing" | "paused" | "buffering" | "completed" | "error";

type PlaybackManagerValue = {
  activeDocument?: ReadingDocument;
  state: PlaybackState;
  activeBlockIndex: number;
  percent: number;
  currentTime: number;
  duration: number;
  error: string | null;
  outputState: OutputState;
  selectDocument: (document: ReadingDocument, options?: { resetPlayback?: boolean }) => void;
  playDocument: (document: ReadingDocument, blockIndex?: number) => Promise<void>;
  toggleDocument: (document: ReadingDocument) => Promise<void>;
  pause: () => Promise<void>;
  stop: () => Promise<void>;
  seekBy: (seconds: number) => Promise<void>;
  skipToBlock: (blockIndex: number) => Promise<void>;
  showOutputPicker: (document: ReadingDocument) => Promise<void>;
};

type AudioPlayerWithStatusEvents = AudioPlayer & {
  addListener(eventName: "playbackStatusUpdate", listener: (status: AudioStatus) => void): { remove: () => void };
};

type SegmentBlock = {
  blockIndex: number;
  startWord: number;
  wordCount: number;
  text: string;
  startCharacter: number;
  endCharacter: number;
};

type PlaybackSegment = {
  segmentIndex: number;
  startBlockIndex: number;
  endBlockIndex: number;
  text: string;
  cacheKey: string;
  blocks: SegmentBlock[];
  totalWords: number;
};

type PrefetchedSegment = {
  documentId: string;
  provider: UserSettings["provider"];
  voice: string;
  speed: number;
  targetLanguage: UserSettings["targetLanguage"];
  segmentIndex: number;
  uri: string;
};

type ProgressSnapshot = {
  blockIndex: number;
  characterOffset: number;
  sentenceIndex: number;
  percent: number;
};

type PlaybackAudioSettings = {
  provider: UserSettings["provider"];
  voice: string;
  speed: number;
  targetLanguage: UserSettings["targetLanguage"];
};

const PlaybackManagerContext = createContext<PlaybackManagerValue | null>(null);
// Keep every mobile request below Google TTS's per-request limit. The API also
// splits defensively, but doing this here protects older deployments and lets a
// single unusually long paragraph continue as multiple playback segments.
const TARGET_SEGMENT_BYTES = 3_500;
const LOCAL_LANGUAGE_SEGMENT_BYTES = 500;

export function PlaybackManagerProvider({ children }: PropsWithChildren) {
  const { getToken, isSignedIn, userId } = useAuth();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: async () => getUserSettings(await getToken()),
    enabled: Boolean(isSignedIn)
  });
  const playerRef = useRef<AudioPlayer | null>(null);
  const subscriptionRef = useRef<{ remove: () => void } | null>(null);
  const runIdRef = useRef(0);
  const finishedRef = useRef(false);
  const activeDocumentRef = useRef<ReadingDocument | undefined>(undefined);
  const activeBlockIndexRef = useRef(0);
  const activeSegmentRef = useRef<PlaybackSegment | null>(null);
  const currentAudioUriRef = useRef<string | null>(null);
  const outputStateRef = useRef<OutputState>({ connected: false, platform: "local", isScreen: false });
  const prefetchedSegmentRef = useRef<PrefetchedSegment | null>(null);
  const progressRef = useRef<ProgressSnapshot>({ blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 });
  const playbackSettingsRef = useRef<PlaybackAudioSettings>({ provider: "google", voice: "en-US-Neural2-F", speed: 1, targetLanguage: "en" });
  const [activeDocument, setActiveDocument] = useState<ReadingDocument | undefined>(undefined);
  const [state, setState] = useState<PlaybackState>("idle");
  const [activeBlockIndex, setActiveBlockIndex] = useState(0);
  const [percent, setPercent] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [outputState, setOutputState] = useState<OutputState>(outputStateRef.current);

  const isRemoteOutputConnected = () => outputStateRef.current.connected && outputStateRef.current.platform !== "local";

  useEffect(() => {
    activeDocumentRef.current = activeDocument;
  }, [activeDocument]);

  useEffect(() => {
    activeBlockIndexRef.current = activeBlockIndex;
  }, [activeBlockIndex]);

  useEffect(() => {
    const nextSettings = playbackAudioSettings(settingsQuery.data);
    const previousSettings = playbackSettingsRef.current;
    const changed = audioSettingsChanged(previousSettings, nextSettings);
    playbackSettingsRef.current = nextSettings;
    if (!changed) return;
    prefetchedSegmentRef.current = null;
    const document = activeDocumentRef.current;
    if (!document) return;
    if (["loading", "playing", "buffering"].includes(state)) {
      void playSegmentForBlock(document, activeBlockIndexRef.current, "buffering");
      return;
    }
    if (state === "paused") {
      // A paused player still owns the old language's audio file. Discard it
      // so the next tap requests the newly selected translation instead of
      // resuming English from memory.
      runIdRef.current += 1;
      if (isRemoteOutputConnected()) sendOutputCommand("stop");
      stopCurrentPlayer({ clearLockScreen: false });
      activeSegmentRef.current = null;
      setCurrentTime(0);
      setDuration(0);
      setError(null);
      setState("ready");
      syncPlaybackLiveActivity(document, progressRef.current, "ready", 0, 0);
    }
  }, [settingsQuery.data?.provider, settingsQuery.data?.voice, settingsQuery.data?.speed, settingsQuery.data?.targetLanguage]);

  useEffect(() => {
    const subscription = addOutputStateListener((nextOutput) => {
      const wasRemoteOutputConnected = outputStateRef.current.connected && outputStateRef.current.platform !== "local";
      outputStateRef.current = nextOutput;
      setOutputState(nextOutput);
      if (nextOutput.error) setError(nextOutput.error);
      if (nextOutput.platform === "local" || !nextOutput.connected) {
        if (wasRemoteOutputConnected) {
          setState("paused");
          const document = activeDocumentRef.current;
          if (document) {
            syncPlaybackLiveActivity(
              document,
              progressRef.current,
              "paused",
              playerRef.current?.currentTime ?? 0,
              playerRef.current?.duration ?? 0
            );
          }
        }
        return;
      }
      // AirPlay and Chromecast both get a native output player. That keeps the
      // on-device controls, remote output, and progress state in one path.
      playerRef.current?.pause();
      if (typeof nextOutput.currentTime === "number") setCurrentTime(nextOutput.currentTime);
      if (typeof nextOutput.duration === "number" && nextOutput.duration > 0) setDuration(nextOutput.duration);
      if (nextOutput.playbackState === "playing") setState("playing");
      else if (nextOutput.playbackState === "loading") setState("buffering");
      else if (nextOutput.playbackState === "paused") setState("paused");
      else if (nextOutput.playbackState === "error") setState("error");

      const document = activeDocumentRef.current;
      const segment = activeSegmentRef.current;
      if (document && segment && typeof nextOutput.currentTime === "number") {
        const remoteDuration = nextOutput.duration || playerRef.current?.duration || 0;
        const nextProgress = progressSnapshotForSegment(document, segment, nextOutput.currentTime, remoteDuration);
        setProgressState(nextProgress);
        syncPlaybackLiveActivity(document, nextProgress, nextOutput.playbackState === "playing" ? "playing" : "paused", nextOutput.currentTime, remoteDuration);
      }
      if (nextOutput.playbackState === "completed" && document && segment && !finishedRef.current) {
        finishedRef.current = true;
        void advanceAfterSegment(document, segment, runIdRef.current);
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      endPlaybackLiveActivity();
      stopCurrentPlayer({ clearLockScreen: true });
    };
  }, []);

  /**
   * Library lists carry a summary without reading blocks. Load the full
   * document (shared with the document screen's query cache) before playback.
   */
  async function loadFullDocument(document: ReadingDocument): Promise<ReadingDocument> {
    const known = activeDocumentRef.current;
    if (!needsFullDocument(document)) return document;
    if (known?.id === document.id && known.blocks.length) return withKnownBlocks(document, known);
    return queryClient.fetchQuery({
      queryKey: ["document", document.id],
      queryFn: async () => getDocument(document.id, await getToken()),
      staleTime: 30_000
    });
  }

  async function playDocument(requested: ReadingDocument, blockIndex?: number) {
    await stop({ saveProgress: activeDocumentRef.current?.id !== requested.id });
    let document = requested;
    if (needsFullDocument(requested)) {
      const runId = runIdRef.current;
      activeDocumentRef.current = withKnownBlocks(requested, activeDocumentRef.current);
      setActiveDocument(activeDocumentRef.current);
      setState("loading");
      setError(null);
      try {
        document = await loadFullDocument(requested);
      } catch (caught) {
        if (runId !== runIdRef.current) return;
        setError(playbackErrorMessage(caught));
        setState("ready");
        return;
      }
      // Another document was chosen while this one was loading.
      if (runId !== runIdRef.current) return;
    }
    activeDocumentRef.current = document;
    setActiveDocument(document);
    const resumeFromSavedPosition = blockIndex === undefined;
    const safeIndex = clamp(blockIndex ?? normalizedBlockIndex(document), 0, Math.max(0, document.blocks.length - 1));
    const savedCharacterOffset = resumeFromSavedPosition ? document.progress.characterOffset : 0;
    const blockLength = document.blocks[safeIndex]?.text.length ?? 0;
    const initialProgress = progressSnapshotForBlock(
      document,
      safeIndex,
      blockLength > 0 ? clamp(savedCharacterOffset / blockLength, 0, 1) : 0
    );
    setProgressState(initialProgress);
    const segment = segmentForPosition(document, safeIndex, savedCharacterOffset, playbackSettingsRef.current.targetLanguage);
    if (segment) await playSegment(document, segment, "loading");
  }

  function selectDocument(selected: ReadingDocument, options: { resetPlayback?: boolean } = {}) {
    const currentDocument = activeDocumentRef.current;
    // A summary list item must never replace text that is already loaded.
    const document = withKnownBlocks(selected, currentDocument);
    const sameDocument = currentDocument?.id === document.id;
    if (needsFullDocument(document)) void hydrateSelectedDocument(document, options);
    if (sameDocument && !options.resetPlayback) {
      activeDocumentRef.current = document;
      setActiveDocument(document);
      return;
    }

    // Preserve the previous article's progress before switching the global
    // selection, but make the new article immediately visible on every screen.
    if (!sameDocument) void saveCurrentProgress();
    runIdRef.current += 1;
    finishedRef.current = false;
    if (isRemoteOutputConnected()) sendOutputCommand("stop");
    stopCurrentPlayer({ clearLockScreen: true });
    activeSegmentRef.current = null;
    prefetchedSegmentRef.current = null;
    activeDocumentRef.current = document;
    setActiveDocument(document);
    setProgressState(needsFullDocument(document) && !options.resetPlayback
      ? document.progress
      : progressSnapshotForBlock(document, options.resetPlayback ? 0 : normalizedBlockIndex(document)));
    setCurrentTime(0);
    setDuration(0);
    setError(null);
    setState("ready");
    endPlaybackLiveActivity();
  }

  async function hydrateSelectedDocument(document: ReadingDocument, options: { resetPlayback?: boolean }) {
    try {
      const full = await loadFullDocument(document);
      const current = activeDocumentRef.current;
      if (current?.id !== full.id || !needsFullDocument(current)) return;
      activeDocumentRef.current = full;
      setActiveDocument(full);
      if (state === "ready" || state === "idle") {
        setProgressState(progressSnapshotForBlock(full, options.resetPlayback ? 0 : normalizedBlockIndex(full)));
      }
    } catch {
      // Play retries the fetch and reports a failure to the listener.
    }
  }

  async function toggleDocument(document: ReadingDocument) {
    const isActiveDocument = activeDocumentRef.current?.id === document.id;
    if (isActiveDocument && isRemoteOutputConnected()) {
      const shouldPause = state === "playing" || state === "buffering";
      sendOutputCommand(shouldPause ? "pause" : "play");
      setState(shouldPause ? "paused" : "playing");
      return;
    }
    if (isActiveDocument && state === "playing") {
      await pause();
      return;
    }
    if (isActiveDocument && state === "paused" && playerRef.current) {
      playerRef.current.play();
      setState("playing");
      syncPlaybackLiveActivity(document, progressRef.current, "playing", currentTime, duration);
      return;
    }
    await playDocument(document, isActiveDocument ? activeBlockIndexRef.current : undefined);
  }

  async function pause() {
    if (isRemoteOutputConnected()) {
      sendOutputCommand("pause");
    } else {
      playerRef.current?.pause();
    }
    setState("paused");
    const document = activeDocumentRef.current;
    if (document) syncPlaybackLiveActivity(document, progressRef.current, "paused", currentTime, duration);
    await saveCurrentProgress();
  }

  async function stop(options: { saveProgress?: boolean } = { saveProgress: true }) {
    runIdRef.current += 1;
    if (options.saveProgress !== false) await saveCurrentProgress();
    if (isRemoteOutputConnected()) {
      sendOutputCommand("stop");
    }
    stopCurrentPlayer({ clearLockScreen: true });
    activeSegmentRef.current = null;
    prefetchedSegmentRef.current = null;
    setCurrentTime(0);
    setDuration(0);
    setState(activeDocumentRef.current ? "ready" : "idle");
    endPlaybackLiveActivity(activeDocumentRef.current ? liveActivityProps(activeDocumentRef.current, progressRef.current, "ready", 0, 0, playbackSettingsRef.current.targetLanguage) : undefined);
  }

  async function seekBy(seconds: number) {
    if (isRemoteOutputConnected()) {
      sendOutputCommand("seekBy", seconds);
      return;
    }
    const player = playerRef.current;
    if (!player) return;
    await player.seekTo(Math.max(0, player.currentTime + seconds));
    setCurrentTime(player.currentTime);
    const document = activeDocumentRef.current;
    const segment = activeSegmentRef.current;
    if (document && segment) {
      setProgressState(progressSnapshotForSegment(document, segment, player.currentTime, player.duration || duration));
    }
    await saveCurrentProgress();
  }

  async function skipToBlock(blockIndex: number) {
    const document = activeDocumentRef.current;
    if (!document?.blocks.length) return;
    const wasPlaying = state === "playing" || state === "loading" || state === "buffering";
    const safeIndex = clamp(blockIndex, 0, document.blocks.length - 1);
    await saveCurrentProgress();
    setProgressState(progressSnapshotForBlock(document, safeIndex));
    if (wasPlaying) await playSegmentForBlock(document, safeIndex, "buffering");
    else {
      stopCurrentPlayer({ clearLockScreen: false });
      setState("ready");
      syncPlaybackLiveActivity(document, progressSnapshotForBlock(document, safeIndex), "ready", 0, duration);
    }
  }

  async function playSegmentForBlock(document: ReadingDocument, blockIndex: number, loadingState: ReadMatePlaybackActivityProps["status"]) {
    const segment = segmentForBlock(document, blockIndex, playbackSettingsRef.current.targetLanguage);
    if (!segment) return;
    await playSegment(document, segment, loadingState);
  }

  async function playSegment(document: ReadingDocument, segment: PlaybackSegment, loadingState: ReadMatePlaybackActivityProps["status"]) {
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    finishedRef.current = false;
    stopCurrentPlayer({ clearLockScreen: false });
    activeSegmentRef.current = segment;
    setState(loadingState);
    setError(null);
    setActiveDocument(document);
    setCurrentTime(0);
    setDuration(0);
    const segmentStartProgress = progressSnapshotForSegmentStart(document, segment);
    setProgressState(segmentStartProgress);
    syncPlaybackLiveActivity(document, segmentStartProgress, loadingState, 0, 0);

    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        // expo-audio requires exclusive focus for lock-screen controls to own
        // the system media session reliably.
        interruptionMode: "doNotMix",
        allowsRecording: false,
        shouldPlayInBackground: true,
        shouldRouteThroughEarpiece: false
      });
      const useSecureCastUrl = Platform.OS === "android" && isRemoteOutputConnected();
      const uri = useSecureCastUrl
        ? await requestCastSegmentUri(document, segment, runId)
        : await uriForSegment(document, segment, runId);
      if (runId !== runIdRef.current) return;
      currentAudioUriRef.current = uri;
      const settings = playbackSettingsForDocument(document);

      const player = createAudioPlayer({ uri, name: document.title }, { updateInterval: 500 });
      // A cast receiver plays the URL itself, so cast audio carries the speed
      // from synthesis; local audio is neutral-rate and sped up here.
      player.setPlaybackRate(useSecureCastUrl ? 1 : settings.speed);
      player.setActiveForLockScreen(
        true,
        {
          title: document.title,
          artist: aiAudioMetadataSubtitle(document.sourceLabel ?? contentTypeLabel(document.sourceType)),
          artworkUrl: document.coverImageUrl ?? document.thumbnailUrl
        },
        { showSeekBackward: true, showSeekForward: true, isLiveStream: false }
      );
      subscriptionRef.current = (player as AudioPlayerWithStatusEvents).addListener("playbackStatusUpdate", (status) => {
        if (status.error) {
          setError(status.error);
          setState("error");
          endPlaybackLiveActivity();
          return;
        }
        if (isRemoteOutputConnected()) return;
        const nextCurrentTime = status.currentTime || 0;
        const nextDuration = status.duration || 0;
        const nextProgress = progressSnapshotForSegment(document, segment, nextCurrentTime, nextDuration);
        const nextState = status.isBuffering ? "buffering" : status.playing ? "playing" : liveActivityStatusForPlaybackState(state);
        setCurrentTime(nextCurrentTime);
        setDuration(nextDuration);
        setProgressState(nextProgress);
        syncPlaybackLiveActivity(document, nextProgress, nextState, nextCurrentTime, nextDuration);
        if (status.isBuffering) setState("buffering");
        else if (status.playing) setState("playing");
        if (status.didJustFinish && !finishedRef.current) {
          finishedRef.current = true;
          void advanceAfterSegment(document, segment, runId);
        }
      });
      playerRef.current = player;
      if (isRemoteOutputConnected()) {
        loadOutputMedia(outputMediaFor(document, uri, 0, 0));
        player.pause();
      } else {
        player.play();
      }
      setState("playing");
      syncPlaybackLiveActivity(document, segmentStartProgress, "playing", 0, 0);
      if (!useSecureCastUrl) void prefetchNextSegment(document, segment, runId);
      await saveProgress(segmentStartProgress, document);
    } catch (caught) {
      if (runId !== runIdRef.current) return;
      setError(playbackErrorMessage(caught));
      setState("error");
      endPlaybackLiveActivity();
      stopCurrentPlayer({ clearLockScreen: true });
    }
  }

  async function advanceAfterSegment(document: ReadingDocument, completedSegment: PlaybackSegment, runId: number) {
    const segments = buildPlaybackSegments(document, playbackSettingsRef.current.targetLanguage);
    const nextSegment = segments[completedSegment.segmentIndex + 1];
    const isComplete = !nextSegment;
    const nextProgress = isComplete
      ? { blockIndex: Math.max(0, document.blocks.length - 1), characterOffset: 0, sentenceIndex: 0, percent: 100 }
      : progressSnapshotForSegmentStart(document, nextSegment);
    setProgressState(nextProgress);
    await saveProgress(nextProgress, document);

    if (runId !== runIdRef.current) return;
    if (isComplete) {
      stopCurrentPlayer({ clearLockScreen: true });
      activeSegmentRef.current = null;
      setState("completed");
      endPlaybackLiveActivity(liveActivityProps(document, nextProgress, "completed", duration, duration, playbackSettingsRef.current.targetLanguage), "default");
      return;
    }
    await playSegment(document, nextSegment, "buffering");
  }

  async function uriForSegment(document: ReadingDocument, segment: PlaybackSegment, runId: number): Promise<string> {
    const prefetched = prefetchedSegmentRef.current;
    const settings = playbackSettingsForDocument(document);
    if (
      prefetched &&
      prefetched.documentId === document.id &&
      prefetched.provider === settings.provider &&
      prefetched.voice === settings.voice &&
      prefetched.speed === settings.speed &&
      prefetched.targetLanguage === settings.targetLanguage &&
      prefetched.segmentIndex === segment.segmentIndex
    ) {
      prefetchedSegmentRef.current = null;
      return prefetched.uri;
    }
    return requestSegmentUri(document, segment, runId);
  }

  async function prefetchNextSegment(document: ReadingDocument, segment: PlaybackSegment, runId: number) {
    const settings = playbackSettingsForDocument(document);
    const next = buildPlaybackSegments(document, settings.targetLanguage)[segment.segmentIndex + 1];
    if (!next || runId !== runIdRef.current) return;
    try {
      const uri = await requestSegmentUri(document, next, runId);
      if (runId !== runIdRef.current) return;
      const settings = playbackSettingsForDocument(document);
      prefetchedSegmentRef.current = {
        documentId: document.id,
        provider: settings.provider,
        voice: settings.voice,
        speed: settings.speed,
        targetLanguage: settings.targetLanguage,
        segmentIndex: next.segmentIndex,
        uri
      };
    } catch {
      // Playback can continue without prefetch; the next segment will request audio when needed.
    }
  }

  async function requestSegmentUri(document: ReadingDocument, segment: PlaybackSegment, runId: number): Promise<string> {
    const token = await getToken();
    const settings = playbackSettingsForDocument(document);
    if (runId !== runIdRef.current) throw new Error("Playback request was superseded.");
    // Local playback applies the listener's speed with setPlaybackRate, so the
    // file is synthesized at a neutral rate and stays reusable across speeds.
    return createSpeechAudioFile(token, {
      userId: userId ?? "signed-out",
      cacheKey: `${document.id}-${segment.cacheKey}-${settings.provider}-${settings.voice}-${settings.targetLanguage}`,
      text: segment.text,
      provider: settings.provider,
      voice: settings.voice,
      speed: 1,
      targetLanguage: settings.targetLanguage
    });
  }

  async function requestCastSegmentUri(document: ReadingDocument, segment: PlaybackSegment, runId: number): Promise<string> {
    const token = await getToken();
    const settings = playbackSettingsForDocument(document);
    if (runId !== runIdRef.current) throw new Error("Playback request was superseded.");
    return createSpeechCastUrl(token, {
      userId: userId ?? "signed-out",
      cacheKey: `${document.id}-${segment.cacheKey}-${settings.provider}-${settings.voice}-${settings.speed}-${settings.targetLanguage}`,
      text: segment.text,
      provider: settings.provider,
      voice: settings.voice,
      speed: settings.speed,
      targetLanguage: settings.targetLanguage
    });
  }

  function playbackSettingsForDocument(document: ReadingDocument): PlaybackAudioSettings {
    const settings = playbackSettingsRef.current;
    return {
      provider: settings.provider || document.provider,
      voice: settings.voice || document.voice,
      speed: settings.speed || document.speed,
      targetLanguage: settings.targetLanguage
    };
  }

  async function saveCurrentProgress() {
    const document = activeDocumentRef.current;
    if (!document?.blocks.length) return;
    await saveProgress(progressRef.current, document);
  }

  async function saveProgress(progress: ProgressSnapshot, document: ReadingDocument) {
    const safeProgress = {
      blockIndex: clamp(progress.blockIndex, 0, Math.max(0, document.blocks.length - 1)),
      characterOffset: Math.max(0, progress.characterOffset),
      sentenceIndex: Math.max(0, progress.sentenceIndex),
      percent: clamp(progress.percent, 0, 100)
    };
    setProgressState(safeProgress);
    try {
      const updated = withKnownBlocks(await updateDocumentProgress(document.id, await getToken(), safeProgress), document);
      if (updated.blocks.length) queryClient.setQueryData(["document", document.id], updated);
      queryClient.setQueryData<ReadingDocument[]>(["documents"], (current) =>
        current?.map((item) => (item.id === updated.id ? updated : item))
      );
      setActiveDocument(updated);
    } catch {
      // Playback should remain usable even if a progress sync write is temporarily unavailable.
    }
  }

  function setProgressState(progress: ProgressSnapshot) {
    progressRef.current = progress;
    setActiveBlockIndex(progress.blockIndex);
    setPercent(progress.percent);
  }

  function stopCurrentPlayer({ clearLockScreen }: { clearLockScreen: boolean }) {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    if (clearLockScreen) playerRef.current?.clearLockScreenControls();
    playerRef.current?.pause();
    playerRef.current?.remove();
    playerRef.current = null;
    currentAudioUriRef.current = null;
  }

  async function showOutputPicker(document: ReadingDocument) {
    const isCurrent = activeDocumentRef.current?.id === document.id;
    if (!isCurrent || !currentAudioUriRef.current) {
      await playDocument(document, isCurrent ? activeBlockIndexRef.current : undefined);
    }
    const active = activeDocumentRef.current ?? document;
    let uri = currentAudioUriRef.current;
    if (!uri) throw new Error("ReadMate could not prepare this audio for casting.");
    if (Platform.OS === "android") {
      const segment = activeSegmentRef.current;
      if (!segment) throw new Error("ReadMate could not identify the current audio segment for casting.");
      uri = await requestCastSegmentUri(active, segment, runIdRef.current);
    }
    presentOutputPicker(outputMediaFor(active, uri, playerRef.current?.currentTime ?? currentTime, playerRef.current?.duration ?? duration));
  }

  function syncPlaybackLiveActivity(
    document: ReadingDocument,
    progress: ProgressSnapshot,
    playbackState: ReadMatePlaybackActivityProps["status"],
    currentTime: number,
    duration: number
  ) {
    updatePlaybackLiveActivity(liveActivityProps(document, progress, playbackState, currentTime, duration, playbackSettingsRef.current.targetLanguage), deepLinkForDocument(document));
  }

  const value = useMemo<PlaybackManagerValue>(
    () => ({
      activeDocument,
      state,
      activeBlockIndex,
      percent,
      currentTime,
      duration,
      error,
      outputState,
      selectDocument,
      playDocument,
      toggleDocument,
      pause,
      stop,
      seekBy,
      skipToBlock,
      showOutputPicker
    }),
    [activeDocument, state, activeBlockIndex, percent, currentTime, duration, error, outputState]
  );

  return <PlaybackManagerContext.Provider value={value}>{children}</PlaybackManagerContext.Provider>;
}

export function usePlaybackManager(): PlaybackManagerValue {
  const value = useContext(PlaybackManagerContext);
  if (!value) throw new Error("usePlaybackManager must be used inside PlaybackManagerProvider.");
  return value;
}

function normalizedBlockIndex(document?: ReadingDocument): number {
  if (!document?.blocks.length) return 0;
  return clamp(document.progress.blockIndex, 0, document.blocks.length - 1);
}

function segmentForBlock(
  document: ReadingDocument,
  blockIndex: number,
  targetLanguage: UserSettings["targetLanguage"]
): PlaybackSegment | null {
  const segments = buildPlaybackSegments(document, targetLanguage);
  return segments.find((segment) => blockIndex >= segment.startBlockIndex && blockIndex <= segment.endBlockIndex) ?? null;
}

function segmentForPosition(
  document: ReadingDocument,
  blockIndex: number,
  characterOffset: number,
  targetLanguage: UserSettings["targetLanguage"]
): PlaybackSegment | null {
  const segments = buildPlaybackSegments(document, targetLanguage);
  return (
    segments.find((segment) =>
      segment.blocks.some(
        (block) =>
          block.blockIndex === blockIndex &&
          characterOffset >= block.startCharacter &&
          characterOffset < block.endCharacter
      )
    ) ?? segmentForBlock(document, blockIndex, targetLanguage)
  );
}

function buildPlaybackSegments(
  document: ReadingDocument,
  targetLanguage: UserSettings["targetLanguage"]
): PlaybackSegment[] {
  const segments: PlaybackSegment[] = [];
  const targetSegmentBytes = targetLanguage === "en" ? TARGET_SEGMENT_BYTES : LOCAL_LANGUAGE_SEGMENT_BYTES;
  let currentBlocks: SegmentBlock[] = [];
  let currentText = "";
  let currentStart = 0;
  let currentWords = 0;

  for (let index = 0; index < document.blocks.length; index += 1) {
    const block = document.blocks[index];
    const text = block.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    for (const slice of splitTextForPlayback(text, targetSegmentBytes)) {
      const nextText = currentText ? `${currentText}\n\n${slice.text}` : slice.text;
      if (currentBlocks.length && byteLength(nextText) > targetSegmentBytes) {
        segments.push(createSegment(segments.length, currentStart, currentBlocks, currentText));
        currentBlocks = [];
        currentText = "";
        currentWords = 0;
      }
      if (!currentBlocks.length) currentStart = index;
      const wordCount = wordCountForText(slice.text);
      currentBlocks.push({
        blockIndex: index,
        startWord: currentWords,
        wordCount,
        text: slice.text,
        startCharacter: slice.startCharacter,
        endCharacter: slice.endCharacter
      });
      currentWords += wordCount;
      currentText = currentText ? `${currentText}\n\n${slice.text}` : slice.text;
    }
  }

  if (currentBlocks.length) {
    segments.push(createSegment(segments.length, currentStart, currentBlocks, currentText));
  }
  return segments;
}

type TextSlice = { text: string; startCharacter: number; endCharacter: number };

function splitTextForPlayback(text: string, maxBytes: number): TextSlice[] {
  const slices: TextSlice[] = [];
  let offset = 0;

  while (offset < text.length) {
    while (offset < text.length && /\s/.test(text[offset])) offset += 1;
    if (offset >= text.length) break;

    let low = offset + 1;
    let high = text.length;
    let maxEnd = low;
    while (low <= high) {
      const midpoint = safeStringEnd(text, Math.floor((low + high) / 2));
      if (byteLength(text.slice(offset, midpoint)) <= maxBytes) {
        maxEnd = midpoint;
        low = midpoint + 1;
      } else {
        high = midpoint - 1;
      }
    }

    const end = maxEnd < text.length ? preferredBreakEnd(text, offset, maxEnd) : text.length;
    const chunk = text.slice(offset, end).trimEnd();
    if (!chunk) {
      offset = Math.max(offset + 1, end);
      continue;
    }
    slices.push({ text: chunk, startCharacter: offset, endCharacter: offset + chunk.length });
    offset = Math.max(end, offset + chunk.length);
  }

  return slices;
}

function preferredBreakEnd(text: string, start: number, maxEnd: number): number {
  const minimumUsefulEnd = start + Math.floor((maxEnd - start) * 0.55);
  const findBoundary = (pattern: RegExp) => {
    for (let index = maxEnd; index > minimumUsefulEnd; index -= 1) {
      if (pattern.test(text[index - 1]) && (index >= text.length || /\s/.test(text[index]))) return index;
    }
    return -1;
  };
  const sentenceEnd = findBoundary(/[.!?]/);
  if (sentenceEnd > 0) return sentenceEnd;
  const clauseEnd = findBoundary(/[,;:]/);
  if (clauseEnd > 0) return clauseEnd;
  for (let index = maxEnd; index > minimumUsefulEnd; index -= 1) {
    if (/\s/.test(text[index])) return index;
  }
  return maxEnd;
}

function safeStringEnd(text: string, end: number): number {
  if (end <= 0 || end >= text.length) return end;
  const previous = text.charCodeAt(end - 1);
  const next = text.charCodeAt(end);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? end + 1 : end;
}

function createSegment(segmentIndex: number, startBlockIndex: number, blocks: SegmentBlock[], text: string): PlaybackSegment {
  const endBlockIndex = blocks[blocks.length - 1]?.blockIndex ?? startBlockIndex;
  return {
    segmentIndex,
    startBlockIndex,
    endBlockIndex,
    text,
    cacheKey: `segment-${segmentIndex}-${startBlockIndex}-${endBlockIndex}`,
    blocks,
    totalWords: Math.max(1, blocks.reduce((sum, block) => sum + block.wordCount, 0))
  };
}

function progressSnapshotForSegment(
  document: ReadingDocument,
  segment: PlaybackSegment,
  currentTime: number,
  duration: number
): ProgressSnapshot {
  const ratio = duration > 0 ? clamp(currentTime / duration, 0, 1) : 0;
  const elapsedWords = ratio * segment.totalWords;
  const block =
    segment.blocks.find((candidate) => elapsedWords < candidate.startWord + candidate.wordCount) ??
    segment.blocks[segment.blocks.length - 1];
  if (!block) return progressSnapshotForBlock(document, segment.startBlockIndex);
  const sliceRatio = clamp((elapsedWords - block.startWord) / Math.max(1, block.wordCount), 0, 1);
  const normalizedBlockLength = document.blocks[block.blockIndex]?.text.replace(/\s+/g, " ").trim().length ?? 0;
  const blockRatio = normalizedBlockLength > 0
    ? clamp((block.startCharacter + (block.endCharacter - block.startCharacter) * sliceRatio) / normalizedBlockLength, 0, 1)
    : 0;
  return progressSnapshotForBlock(document, block.blockIndex, blockRatio);
}

function progressSnapshotForSegmentStart(document: ReadingDocument, segment: PlaybackSegment): ProgressSnapshot {
  const first = segment.blocks[0];
  if (!first) return progressSnapshotForBlock(document, segment.startBlockIndex);
  const normalizedBlockLength = document.blocks[first.blockIndex]?.text.replace(/\s+/g, " ").trim().length ?? 0;
  return progressSnapshotForBlock(
    document,
    first.blockIndex,
    normalizedBlockLength > 0 ? first.startCharacter / normalizedBlockLength : 0
  );
}

function progressSnapshotForBlock(document: ReadingDocument, blockIndex: number, blockRatio = 0): ProgressSnapshot {
  if (!document.blocks.length) return { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 };
  const safeIndex = clamp(blockIndex, 0, document.blocks.length - 1);
  const block = document.blocks[safeIndex];
  const ratio = clamp(blockRatio, 0, 1);
  return {
    blockIndex: safeIndex,
    characterOffset: Math.round(block.text.length * ratio),
    sentenceIndex: sentenceIndexForRatio(block.text, ratio),
    percent: Math.round(((safeIndex + ratio) / document.blocks.length) * 100)
  };
}

function sentenceIndexForRatio(text: string, ratio: number): number {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 1) return 0;
  return clamp(Math.floor(sentences.length * ratio), 0, sentences.length - 1);
}

function wordCountForText(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length || 1;
}

function byteLength(text: string): number {
  return encodeURIComponent(text).replace(/%[0-9A-F]{2}/gi, "x").length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function contentTypeLabel(sourceType: ReadingDocument["sourceType"]): string {
  if (sourceType === "pdf") return "PDF";
  if (sourceType === "rss" || sourceType === "news") return "RSS";
  if (sourceType === "selection") return "Selection";
  return "ReadMate";
}

function outputMediaFor(document: ReadingDocument, uri: string, currentTime: number, duration: number): OutputMedia {
  return {
    uri,
    title: document.title || "ReadMate",
    subtitle: aiAudioMetadataSubtitle(document.sourceLabel ?? document.author ?? contentTypeLabel(document.sourceType)),
    artworkUrl: document.coverImageUrl ?? document.thumbnailUrl,
    currentTime: Math.max(0, currentTime),
    duration: Math.max(0, duration)
  };
}

function liveActivityProps(
  document: ReadingDocument,
  progress: ProgressSnapshot,
  status: ReadMatePlaybackActivityProps["status"],
  currentTime: number,
  duration: number,
  targetLanguage: UserSettings["targetLanguage"]
): ReadMatePlaybackActivityProps {
  const remainingSeconds = duration > 0 ? Math.max(0, duration - currentTime) : 0;
  return {
    title: document.title || "ReadMate",
    subtitle: document.sourceLabel ?? contentTypeLabel(document.sourceType),
    status,
    percent: clamp(progress.percent, 0, 100),
    blockLabel: document.blocks.length ? `Block ${progress.blockIndex + 1} of ${document.blocks.length}` : "Ready to read",
    remainingLabel: duration > 0 ? `-${formatDuration(remainingSeconds)}` : `${Math.round(clamp(progress.percent, 0, 100))}%`,
    languageLabel: languageLabel(targetLanguage),
    disclosureLabel: AI_AUDIO_DISCLOSURE_TITLE
  };
}

function deepLinkForDocument(document: ReadingDocument): string {
  return `readmate://document/${encodeURIComponent(document.id)}`;
}

function liveActivityStatusForPlaybackState(state: PlaybackState): ReadMatePlaybackActivityProps["status"] {
  if (state === "loading") return "loading";
  if (state === "playing") return "playing";
  if (state === "paused") return "paused";
  if (state === "buffering") return "buffering";
  if (state === "completed") return "completed";
  return "ready";
}

function languageLabel(targetLanguage: UserSettings["targetLanguage"]): string {
  if (targetLanguage === "tw") return "Twi";
  if (targetLanguage === "ee") return "Ewe";
  if (targetLanguage === "gaa") return "Ga";
  return "English";
}

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function playbackAudioSettings(settings?: UserSettings): PlaybackAudioSettings {
  return {
    provider: settings?.provider ?? "google",
    voice: settings?.voice ?? "en-US-Neural2-F",
    speed: settings?.speed ?? 1,
    targetLanguage: settings?.targetLanguage ?? "en"
  };
}

function audioSettingsChanged(previous: PlaybackAudioSettings, next: PlaybackAudioSettings): boolean {
  return previous.provider !== next.provider || previous.voice !== next.voice || previous.speed !== next.speed || previous.targetLanguage !== next.targetLanguage;
}

function playbackErrorMessage(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : "";
  if (caught instanceof ApiError && [502, 503, 504].includes(caught.status)) {
    return "ReadMate audio is temporarily busy. Tap play to retry in a moment.";
  }
  if (/sentences? that are too long|content is too long|input.*too long|maximum.*(bytes|characters)|SSML sentence/i.test(message)) {
    return "This section was too long to prepare. Tap play to retry it in smaller parts.";
  }
  if (/credentials are not configured|GOOGLE_TTS_API_KEY|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_SERVICE_ACCOUNT_JSON|quota|billing/i.test(message)) {
    return "Google voice is temporarily unavailable. Try again in a moment.";
  }
  if (/401|403|unauthorized|forbidden|session|token/i.test(message)) {
    return "Your reading session needs to be refreshed. Open Settings, sign in again, then try playback.";
  }
  return message || "Could not start playback.";
}
