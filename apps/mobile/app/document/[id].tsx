import { useAuth } from "@clerk/expo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useReducer, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { askDocumentQuestion, createNote, generateDocumentLearning, getDocument, getHighlights, getLearningFlashcards, getLearningKeyPoints, getLearningQuiz, getLearningReview, getNotes, getUserSettings, markFlashcardReview, submitQuizAttempt, updateUserSettings } from "@/api/documents";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import { BottomNavigation, NavBackButton, Pill, Screen, SectionCard, SectionHeading, StatusPill, colors, displayText, tabBarBottomInset, useResponsiveLayout } from "@/components/mobile-design";
import { PlaybackBar } from "@/components/playback-bar";
import { usePlaybackManager } from "@/playback/playback-manager";
import { documentModeReducer, initialDocumentModeState, resolveDocumentModeRoute, visibleDocumentMode, type DetailMode } from "@/study/document-mode";
import { evaluateQuizAnswer, evidenceForKeyPoint, flashcardReviewStats, prioritizeFlashcards } from "@/study/session";
import type { AskAiAnswer, LearningFlashcard, LearningQuizAttempt, LearningQuizQuestion, LearningReview, ReadingDocument } from "@/types";

type AskMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  citedSections?: string[];
  fallback?: boolean;
};

export default function DocumentScreen() {
  const { id, mode: routeModeParam } = useLocalSearchParams<{ id: string; mode?: string }>();
  const { getToken } = useAuth();
  const playback = usePlaybackManager();
  const queryClient = useQueryClient();
  const routeMode = resolveDocumentModeRoute(id, routeModeParam);
  const [modeState, dispatchMode] = useReducer(documentModeReducer, routeMode, initialDocumentModeState);
  const mode = visibleDocumentMode(modeState, routeMode);
  const setMode = (nextMode: DetailMode) => dispatchMode({ type: "select", route: routeMode, mode: nextMode });
  const [activeBlockIndex, setActiveBlockIndex] = useState(0);
  const [noteDraft, setNoteDraft] = useState("");
  const [askQuestion, setAskQuestion] = useState("");
  const [askAnswer, setAskAnswer] = useState<AskAiAnswer | null>(null);
  const [askMessages, setAskMessages] = useState<AskMessage[]>([]);
  const [askError, setAskError] = useState<string | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizAttempt, setQuizAttempt] = useState<LearningQuizAttempt | null>(null);
  const [flippedFlashcards, setFlippedFlashcards] = useState<Record<string, boolean>>({});
  const [flashcardCount, setFlashcardCount] = useState("8");
  const [quizCount, setQuizCount] = useState("6");
  const documentQuery = useQuery({
    queryKey: ["document", id],
    queryFn: async () => getDocument(String(id), await getToken()),
    enabled: Boolean(id)
  });
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: async () => getUserSettings(await getToken())
  });
  const saveSettings = useMutation({
    mutationFn: async (next: Omit<NonNullable<typeof settingsQuery.data>, "userId" | "updatedAt">) => updateUserSettings(await getToken(), next),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: ["settings"] });
      const previous = queryClient.getQueryData(["settings"]);
      queryClient.setQueryData(["settings"], (current: typeof settingsQuery.data | undefined) => ({
        userId: current?.userId ?? "pending",
        updatedAt: current?.updatedAt ?? new Date().toISOString(),
        ...next
      }));
      return { previous };
    },
    onError: (_error, _next, context) => {
      if (context?.previous) queryClient.setQueryData(["settings"], context.previous);
    },
    onSuccess: (next) => queryClient.setQueryData(["settings"], next),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["settings"] })
  });
  const notesQuery = useQuery({
    queryKey: ["notes", id],
    queryFn: async () => getNotes(await getToken(), String(id)),
    enabled: Boolean(id)
  });
  const highlightsQuery = useQuery({
    queryKey: ["highlights", id],
    queryFn: async () => getHighlights(await getToken(), String(id)),
    enabled: Boolean(id)
  });
  const learningReviewQuery = useQuery({
    queryKey: ["learning-review", id],
    queryFn: async () => getLearningReview(await getToken(), String(id)),
    enabled: Boolean(id)
  });
  const keyPointsQuery = useQuery({
    queryKey: ["learning-key-points", id],
    queryFn: async () => getLearningKeyPoints(await getToken(), String(id)),
    enabled: Boolean(id) && mode === "highlights"
  });
  const flashcardsQuery = useQuery({
    queryKey: ["learning-flashcards", id],
    queryFn: async () => getLearningFlashcards(await getToken(), String(id)),
    enabled: Boolean(id) && mode === "flashcards"
  });
  const quizQuery = useQuery({
    queryKey: ["learning-quiz", id],
    queryFn: async () => getLearningQuiz(await getToken(), String(id)),
    enabled: Boolean(id) && mode === "quiz"
  });
  const addNote = useMutation({
    mutationFn: async () =>
      createNote(await getToken(), {
        documentId: String(id),
        noteText: noteDraft,
        blockIndex: activeBlockIndex
      }),
    onSuccess: () => {
      setNoteDraft("");
      queryClient.invalidateQueries({ queryKey: ["notes", id] });
    }
  });
  const reviewFlashcard = useMutation({
    mutationFn: async ({ flashcardId, reviewStatus }: { flashcardId: string; reviewStatus: "known" | "needs_review" }) =>
      markFlashcardReview(await getToken(), String(id), flashcardId, reviewStatus),
    onMutate: async ({ flashcardId, reviewStatus }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["learning-review", id] }),
        queryClient.cancelQueries({ queryKey: ["learning-flashcards", id] })
      ]);
      const previousReview = queryClient.getQueryData<LearningReview>(["learning-review", id]);
      const previousFlashcards = queryClient.getQueryData<LearningFlashcard[]>(["learning-flashcards", id]);
      const updateCard = (card: LearningFlashcard) => card.id === flashcardId ? { ...card, reviewStatus } : card;
      queryClient.setQueryData<LearningReview | undefined>(["learning-review", id], (current) => current ? { ...current, flashcards: current.flashcards.map(updateCard) } : current);
      queryClient.setQueryData<LearningFlashcard[] | undefined>(["learning-flashcards", id], (current) => current?.map(updateCard));
      return { previousReview, previousFlashcards };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousReview) queryClient.setQueryData(["learning-review", id], context.previousReview);
      if (context?.previousFlashcards) queryClient.setQueryData(["learning-flashcards", id], context.previousFlashcards);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["learning-review", id] });
      void queryClient.invalidateQueries({ queryKey: ["learning-flashcards", id] });
    }
  });
  const askAi = useMutation({
    mutationFn: async (question: string) => askDocumentQuestion(await getToken(), String(id), question, settingsQuery.data?.targetLanguage ?? "en"),
    onMutate: (question) => {
      const trimmedQuestion = question.trim();
      if (!trimmedQuestion) return;
      setAskError(null);
      setAskMessages((current) => [...current, { id: `user-${Date.now()}`, role: "user", text: trimmedQuestion }]);
      setAskQuestion("");
    },
    onSuccess: (answer) => {
      setAskAnswer(answer);
      setAskMessages((current) => [...current, { id: `assistant-${Date.now()}`, role: "assistant", text: answer.answer, citedSections: answer.citedSections, fallback: answer.fallback }]);
    },
    onError: (error, question) => {
      setAskQuestion(question);
      setAskError(askRequestErrorMessage(error));
    }
  });
  const saveQuizAttempt = useMutation({
    mutationFn: async () => submitQuizAttempt(await getToken(), String(id), quizAnswers),
    onSuccess: (attempt) => {
      setQuizAttempt(attempt);
      queryClient.invalidateQueries({ queryKey: ["learning-review", id] });
    }
  });
  const [studyFallbackNotice, setStudyFallbackNotice] = useState<string | null>(null);
  const generateStudySet = useMutation({
    mutationFn: async () =>
      generateDocumentLearning(await getToken(), String(id), {
        flashcardCount: boundedStudyCount(flashcardCount, 1, 24),
        quizCount: boundedStudyCount(quizCount, 1, 12),
        targetLanguage: settingsQuery.data?.targetLanguage ?? "en"
      }),
    onSuccess: ({ document: updatedDocument, fallback, preserved }) => {
      setStudyFallbackNotice(!fallback
        ? null
        : preserved
          ? "ReadMate AI is busy, so your saved study set was kept. Try again in a few minutes."
          : "ReadMate AI is busy, so these are quick study notes from the text. Try again in a few minutes for AI flashcards and quiz questions.");
      setQuizAnswers({});
      setQuizAttempt(null);
      setFlippedFlashcards({});
      queryClient.setQueryData(["document", id], updatedDocument);
      queryClient.removeQueries({ queryKey: ["learning-review", id], exact: true });
      queryClient.removeQueries({ queryKey: ["learning-key-points", id], exact: true });
      queryClient.removeQueries({ queryKey: ["learning-flashcards", id], exact: true });
      queryClient.removeQueries({ queryKey: ["learning-quiz", id], exact: true });
      void queryClient.invalidateQueries({ queryKey: ["learning-review", id] });
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
    }
  });

  useEffect(() => {
    if (documentQuery.data) setActiveBlockIndex(documentQuery.data.progress.blockIndex);
  }, [documentQuery.data?.id, documentQuery.data?.progress.blockIndex]);

  useEffect(() => {
    if (documentQuery.data) playback.selectDocument(documentQuery.data);
  }, [documentQuery.data?.id]);

  useEffect(() => {
    dispatchMode({ type: "route", route: routeMode });
  }, [routeMode.key]);

  if (documentQuery.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator />
        <BottomNavigation />
      </View>
    );
  }

  if (documentQuery.error || !documentQuery.data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: tabBarBottomInset, backgroundColor: colors.bg }}>
          <Text selectable style={{ color: colors.red, fontSize: 16, lineHeight: 24 }}>
            {documentQuery.error instanceof Error ? documentQuery.error.message : "Document could not be loaded."}
          </Text>
          <Pressable onPress={() => void documentQuery.refetch()} style={{ alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: 18, borderRadius: 999, backgroundColor: colors.player }}>
            <Text style={{ color: "#ffffff", fontSize: 14, fontWeight: "800" }}>Try again</Text>
          </Pressable>
        </ScrollView>
        <BottomNavigation />
      </View>
    );
  }

  const document = documentQuery.data;
  const activeLearningReview = mergeLearningReview(learningReviewQuery.data, {
    keyPoints: keyPointsQuery.data,
    flashcards: flashcardsQuery.data,
    quizQuestions: quizQuery.data
  });
  const learningStatusMessage = learningTabStatusMessage(
    mode,
    {
      keyPoints: keyPointsQuery,
      flashcards: flashcardsQuery,
      quiz: quizQuery
    },
    hasRenderableLearningContent(mode, document, activeLearningReview)
  );
  const activeLearningQuery = mode === "highlights" ? keyPointsQuery : mode === "flashcards" ? flashcardsQuery : mode === "quiz" ? quizQuery : null;

  return (
    <Screen bottomNavigation>
      <NavBackButton label="Back to previous screen" />
      <DocumentStudyHeader document={document} />

      <PlaybackBar
        document={document}
        variant="expanded"
        onActiveBlockChange={setActiveBlockIndex}
        settings={settingsQuery.data}
        onSettingsChange={(next) => saveSettings.mutate(next)}
        settingsSaving={saveSettings.isPending}
      />

      <StudyModeSwitcher mode={mode} setMode={setMode} document={document} review={activeLearningReview} />

      <StudyToolGrid activeMode={mode} document={document} review={activeLearningReview} onSelect={setMode} />

      {learningStatusMessage ? (
        <InlineStatusMessage
          message={learningStatusMessage}
          tone={learningStatusMessage.includes("couldn't") ? "error" : "loading"}
          onRetry={activeLearningQuery?.error ? () => void activeLearningQuery.refetch() : undefined}
        />
      ) : null}

      {generateStudySet.error ? (
        <InlineStatusMessage
          message={studyGenerationErrorMessage(generateStudySet.error)}
          tone="error"
          onRetry={() => generateStudySet.mutate()}
        />
      ) : null}

      {studyFallbackNotice && !generateStudySet.isPending ? (
        <InlineStatusMessage message={studyFallbackNotice} tone="notice" onRetry={() => generateStudySet.mutate()} />
      ) : null}

      <LearningSections document={document} mode={mode} review={activeLearningReview} hasReview={Boolean(activeLearningReview)} />

      <LearningActions
        mode={mode}
        review={activeLearningReview}
        askQuestion={askQuestion}
        setAskQuestion={setAskQuestion}
        askAnswer={askAnswer}
        askMessages={askMessages}
        askError={askError}
        asking={askAi.isPending}
        onAsk={() => askAi.mutate(askQuestion.trim())}
        quizAnswers={quizAnswers}
        setQuizAnswers={setQuizAnswers}
        quizAttempt={quizAttempt}
        submittingQuiz={saveQuizAttempt.isPending}
        onSubmitQuiz={() => saveQuizAttempt.mutate()}
        onResetQuiz={() => {
          setQuizAnswers({});
          setQuizAttempt(null);
        }}
        flippedFlashcards={flippedFlashcards}
        onToggleFlashcard={(flashcardId) => setFlippedFlashcards((current) => ({ ...current, [flashcardId]: !current[flashcardId] }))}
        onReviewFlashcard={(flashcardId, reviewStatus) => reviewFlashcard.mutate({ flashcardId, reviewStatus })}
        reviewingFlashcard={reviewFlashcard.isPending}
        onResetFlashcards={() => setFlippedFlashcards({})}
      />

      <StudyDepthControls
        flashcardCount={flashcardCount}
        setFlashcardCount={setFlashcardCount}
        quizCount={quizCount}
        setQuizCount={setQuizCount}
        generating={generateStudySet.isPending}
        onGenerate={() => generateStudySet.mutate()}
      />

      {mode === "notes" ? (
        <NotesAndHighlightsSection
          noteDraft={noteDraft}
          setNoteDraft={setNoteDraft}
          saving={addNote.isPending}
          onSave={() => addNote.mutate()}
          notes={notesQuery.data ?? []}
          highlights={highlightsQuery.data ?? []}
        />
      ) : null}

      {mode === "text" ? <View style={{ gap: 12 }}>
        <SectionHeading title="Article text" subtitle="The current chunk is highlighted while playback runs." />
        {document.blocks.map((block) => {
          const isCurrent = block.orderIndex === activeBlockIndex;
          return (
            <View key={block.id} style={{ padding: 16, gap: 6, borderRadius: 18, borderCurve: "continuous", backgroundColor: isCurrent ? colors.amberSoft : colors.surface, borderWidth: 1, borderColor: isCurrent ? "#e7b84f" : colors.border }}>
              <Text selectable style={{ fontSize: block.blockType === "heading" ? 20 : 16, lineHeight: block.blockType === "heading" ? 26 : 24, fontWeight: block.blockType === "heading" ? "800" : "400", color: colors.ink }}>
                {block.text}
              </Text>
            </View>
          );
        })}
      </View> : null}

    </Screen>
  );
}

function LearningActions({
  mode,
  review,
  askQuestion,
  setAskQuestion,
  askAnswer,
  askMessages,
  askError,
  asking,
  onAsk,
  quizAnswers,
  setQuizAnswers,
  quizAttempt,
  submittingQuiz,
  onSubmitQuiz,
  onResetQuiz,
  flippedFlashcards,
  onToggleFlashcard,
  onReviewFlashcard,
  reviewingFlashcard,
  onResetFlashcards
}: {
  mode: DetailMode;
  review?: LearningReview;
  askQuestion: string;
  setAskQuestion: (value: string) => void;
  askAnswer: AskAiAnswer | null;
  askMessages: AskMessage[];
  askError: string | null;
  asking: boolean;
  onAsk: () => void;
  quizAnswers: Record<string, string>;
  setQuizAnswers: (answers: Record<string, string>) => void;
  quizAttempt: LearningQuizAttempt | null;
  submittingQuiz: boolean;
  onSubmitQuiz: () => void;
  onResetQuiz: () => void;
  flippedFlashcards: Record<string, boolean>;
  onToggleFlashcard: (flashcardId: string) => void;
  onReviewFlashcard: (flashcardId: string, reviewStatus: "known" | "needs_review") => void;
  reviewingFlashcard: boolean;
  onResetFlashcards: () => void;
}) {
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [quizIndex, setQuizIndex] = useState(0);
  const [checkedQuizAnswers, setCheckedQuizAnswers] = useState<Record<string, boolean>>({});
  const rawFlashcards = review?.flashcards ?? [];
  const flashcardIds = rawFlashcards.map((card) => card.id).join("|");
  const flashcards = useMemo(() => prioritizeFlashcards(rawFlashcards), [review?.documentId, flashcardIds]);
  const flashcardStats = flashcardReviewStats(rawFlashcards);
  const quizQuestions = review?.quizQuestions ?? [];
  const activeFlashcard = flashcards[flashcardIndex];
  const activeQuizQuestion = quizQuestions[Math.min(quizIndex, Math.max(0, quizQuestions.length - 1))];
  const activeQuizAnswer = activeQuizQuestion ? quizAnswers[activeQuizQuestion.id]?.trim() ?? "" : "";
  const activeQuizChecked = activeQuizQuestion ? Boolean(checkedQuizAnswers[activeQuizQuestion.id]) : false;
  const activeQuizFeedback = activeQuizQuestion && activeQuizChecked ? evaluateQuizAnswer(activeQuizQuestion, activeQuizAnswer) : null;
  useEffect(() => {
    setFlashcardIndex(0);
    setQuizIndex(0);
    setCheckedQuizAnswers({});
  }, [mode, review?.documentId, flashcardIds]);
  if (!review) return null;
  const quizComplete = review.quizQuestions.every((question) => Boolean(quizAnswers[question.id]?.trim()));
  const rateFlashcard = (reviewStatus: "known" | "needs_review") => {
    if (!activeFlashcard || !flippedFlashcards[activeFlashcard.id] || reviewingFlashcard) return;
    onReviewFlashcard(activeFlashcard.id, reviewStatus);
    setFlashcardIndex((value) => value + 1);
  };
  const messages = askMessages.length
    ? askMessages
    : askAnswer
      ? [{ id: "assistant-initial", role: "assistant" as const, text: askAnswer.answer, citedSections: askAnswer.citedSections, fallback: askAnswer.fallback }]
      : [];

  return (
    <View style={{ gap: 12 }}>
      {mode === "ask" ? (
        <SectionCard>
          <View style={{ gap: 3 }}>
            <Text selectable style={{ color: colors.ink, fontSize: 14, fontWeight: "800" }}>Ask about this article</Text>
            <Text selectable numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>ReadMate uses this document as context.</Text>
          </View>
          <View style={{ gap: 12 }}>
            {messages.map((message) => (
              <View key={message.id} style={{ maxWidth: message.role === "user" ? "84%" : "90%", alignSelf: message.role === "user" ? "flex-end" : "flex-start", gap: 6 }}>
                {message.role === "assistant" ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><AppIcon name="sparkles" size={14} color={colors.purple} /><Text selectable style={{ color: colors.purple, fontSize: 11, fontWeight: "800" }}>READMATE AI</Text></View>
                ) : null}
                <View style={{ gap: 8, padding: 14, borderRadius: 18, borderCurve: "continuous", backgroundColor: message.role === "user" ? colors.blue : colors.surfaceSoft, borderBottomRightRadius: message.role === "user" ? 5 : 18, borderBottomLeftRadius: message.role === "assistant" ? 5 : 18 }}>
                  <Text selectable style={{ color: message.role === "user" ? "#ffffff" : colors.ink, fontSize: 14, lineHeight: 21 }}>
                    {message.text}
                  </Text>
                  {message.fallback ? <Text selectable style={{ color: colors.amber, fontSize: 12, lineHeight: 18 }}>Using saved document excerpts while AI reconnects.</Text> : null}
                  {message.citedSections?.length ? (
                    <Text selectable style={{ color: colors.purple, fontSize: 12, lineHeight: 18 }}>
                      Cited: {message.citedSections.join(" · ")}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
            {messages.length === 0 ? (
              <View style={{ gap: 8, padding: 14, borderRadius: 18, borderCurve: "continuous", backgroundColor: colors.surfaceSoft }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><AppIcon name="sparkles" size={14} color={colors.purple} /><Text selectable style={{ color: colors.purple, fontSize: 11, fontWeight: "800" }}>READMATE AI</Text></View>
                <Text selectable style={bodyTextStyle}>Ask a question and ReadMate will answer from this document with cited sections.</Text>
              </View>
            ) : null}
            {asking ? <Text selectable style={{ color: colors.muted, fontSize: 13 }}>ReadMate is thinking...</Text> : null}
            {askError ? (
              <View style={{ gap: 8, padding: 12, borderRadius: 14, backgroundColor: colors.redSoft }}>
                <Text selectable style={{ color: colors.red, fontSize: 13, lineHeight: 19 }}>{askError}</Text>
                <Pressable disabled={asking || !askQuestion.trim()} onPress={onAsk}>
                  <Text style={{ color: colors.red, fontSize: 13, fontWeight: "800" }}>Try again</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 8, borderRadius: 999, borderCurve: "continuous", backgroundColor: colors.surfaceSoft }}>
            <TextInput
              value={askQuestion}
              onChangeText={setAskQuestion}
              placeholder="Ask anything about this article..."
              returnKeyType="send"
              onSubmitEditing={() => { if (askQuestion.trim() && !asking) onAsk(); }}
              style={{ flex: 1, minHeight: 38, paddingHorizontal: 10, color: colors.ink }}
            />
            <Pressable disabled={asking || !askQuestion.trim()} onPress={onAsk} style={{ width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: askQuestion.trim() && !asking ? colors.blue : "#9aa8bd" }}>
              <AppIcon name="arrow.up" size={18} color="#ffffff" weight="bold" />
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {["Summarize in 1 line", "What are the key risks?", "Make a quiz question"].map((suggestion) => (
              <Pressable key={suggestion} onPress={() => setAskQuestion(suggestion)} style={{ minHeight: 32, justifyContent: "center", paddingHorizontal: 11, borderRadius: 999, backgroundColor: colors.surfaceSoft }}>
                <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700" }}>{suggestion}</Text>
              </Pressable>
            ))}
          </View>
        </SectionCard>
      ) : null}

      {mode === "flashcards" && flashcards.length > 0 && !activeFlashcard ? (
        <SectionCard>
          <View style={{ alignItems: "center", gap: 12, paddingVertical: 18 }}>
            <View style={{ width: 54, height: 54, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: colors.greenSoft }}>
              <AppIcon name="checkmark" size={28} color={colors.green} weight="bold" />
            </View>
            <Text selectable style={{ color: colors.ink, fontSize: 22, fontWeight: "800" }}>Review complete</Text>
            <Text selectable style={{ color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: "center" }}>You reviewed all {flashcards.length} cards. Nice work.</Text>
            <Pressable onPress={() => { onResetFlashcards(); setFlashcardIndex(0); }} style={{ minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, borderRadius: 999, backgroundColor: colors.blue }}>
              <Text style={{ color: "#ffffff", fontWeight: "800" }}>Review again</Text>
            </Pressable>
          </View>
        </SectionCard>
      ) : mode === "flashcards" && activeFlashcard ? (
        <SectionCard>
          <SectionHeading title="Flashcards" subtitle="Cards marked for review come first. Reveal the answer before rating your recall." />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <StatusPill label={`${flashcardStats.needs_review} to revisit`} tone={flashcardStats.needs_review ? "amber" : "navy"} />
            <StatusPill label={`${flashcardStats.new} new`} tone="blue" />
            <StatusPill label={`${flashcardStats.known} known`} tone="green" />
          </View>
          {(() => {
            const card = activeFlashcard;
            const flipped = Boolean(flippedFlashcards[card.id]);
            return <View key={card.id} style={{ gap: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Text selectable style={{ color: colors.muted, fontSize: 13, fontWeight: "700" }}>Card {flashcardIndex + 1} of {flashcards.length}</Text>
                  <View style={{ flex: 1, height: 5, borderRadius: 999, overflow: "hidden", backgroundColor: colors.bgAlt }}>
                    <View style={{ width: `${((flashcardIndex + 1) / flashcards.length) * 100}%`, height: "100%", borderRadius: 999, backgroundColor: colors.blue }} />
                  </View>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={flipped ? "Show flashcard question" : "Show flashcard answer"} onPress={() => onToggleFlashcard(card.id)} style={{ gap: 18, minHeight: 260, justifyContent: "space-between", padding: 24, borderRadius: 22, borderCurve: "continuous", backgroundColor: colors.surface, boxShadow: "0 1px 0 rgba(15,26,40,0.04), 0 14px 32px -18px rgba(15,26,40,0.18)" }}>
                  <View style={{ gap: 18 }}>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
                      <Text selectable style={{ color: flipped ? colors.green : colors.blue, backgroundColor: flipped ? colors.greenSoft : colors.blueChip, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>{flipped ? "Answer" : "Question"}</Text>
                      {card.topicTag ? <Text selectable style={{ color: colors.purple, backgroundColor: colors.purpleSoft, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, fontSize: 11, fontWeight: "800" }}>{card.topicTag}</Text> : null}
                      <Text selectable style={{ color: colors.muted, backgroundColor: colors.bgAlt, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, fontSize: 11, fontWeight: "800", textTransform: "capitalize" }}>{card.difficulty}</Text>
                    </View>
                    <Text selectable style={{ color: colors.ink, fontSize: 22, fontWeight: "700", lineHeight: 29 }}>
                      {flipped ? card.answer : card.question}
                    </Text>
                  </View>
                  <Text selectable style={{ textAlign: "center", color: colors.muted, fontSize: 12 }}>
                    {flipped ? "Tap to see question" : "Tap to flip"}
                  </Text>
                </Pressable>
                <Text selectable style={{ color: colors.faint, fontSize: 12 }}>Status: {card.reviewStatus.replace("_", " ")}</Text>
                {!flipped ? <Text selectable style={{ color: colors.muted, fontSize: 12, fontWeight: "700" }}>Flip the card to unlock the rating buttons.</Text> : null}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable disabled={!flipped || reviewingFlashcard} onPress={() => rateFlashcard("needs_review")} style={{ ...reviewButtonStyle(colors.redSoft), opacity: !flipped || reviewingFlashcard ? 0.45 : 1 }}>
                    <Text style={{ ...reviewButtonTextStyle, color: colors.red }}>Review again</Text>
                    <Text style={{ color: colors.red, opacity: 0.75, fontSize: 11, fontWeight: "700" }}>Keep in practice</Text>
                  </Pressable>
                  <Pressable disabled={!flipped || reviewingFlashcard} onPress={() => rateFlashcard("known")} style={{ ...reviewButtonStyle(colors.greenSoft), opacity: !flipped || reviewingFlashcard ? 0.45 : 1 }}>
                    <Text style={{ ...reviewButtonTextStyle, color: colors.green }}>I knew this</Text>
                    <Text style={{ color: colors.green, opacity: 0.75, fontSize: 11, fontWeight: "700" }}>Mark as known</Text>
                  </Pressable>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Pressable disabled={flashcardIndex === 0} onPress={() => setFlashcardIndex((value) => Math.max(0, value - 1))} style={{ minHeight: 42, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.bgAlt, opacity: flashcardIndex === 0 ? 0.4 : 1 }}><AppIcon name="chevron.left" size={17} color={colors.ink} /><Text style={{ color: colors.ink, fontWeight: "800" }}>Previous</Text></Pressable>
                  <Pressable disabled={flashcardIndex >= flashcards.length - 1} onPress={() => setFlashcardIndex((value) => Math.min(flashcards.length - 1, value + 1))} style={{ minHeight: 42, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.navy, opacity: flashcardIndex >= flashcards.length - 1 ? 0.4 : 1 }}><Text style={{ color: "#ffffff", fontWeight: "800" }}>Next</Text><AppIcon name="chevron.right" size={17} color="#ffffff" /></Pressable>
                </View>
              </View>;
          })()}
        </SectionCard>
      ) : null}

      {mode === "quiz" && activeQuizQuestion ? (
        <SectionCard>
          {quizAttempt ? (
            <QuizResults attempt={quizAttempt} questions={quizQuestions} onReset={() => { setCheckedQuizAnswers({}); setQuizIndex(0); onResetQuiz(); }} />
          ) : (
            <>
              <SectionHeading title="Quick quiz" subtitle={`Question ${quizIndex + 1} of ${quizQuestions.length} · ${Object.keys(quizAnswers).filter((key) => quizAnswers[key]?.trim()).length} answered`} />
              <View style={{ flexDirection: "row", gap: 4 }}>
                {quizQuestions.map((question) => (
                  <View key={question.id} style={{ flex: 1, height: 4, borderRadius: 999, backgroundColor: quizAnswers[question.id]?.trim() ? colors.blue : colors.bgAlt }} />
                ))}
              </View>
              {(() => { const question = activeQuizQuestion; return (
                <View key={question.id} style={{ gap: 14, padding: 18, borderRadius: 18, borderCurve: "continuous", backgroundColor: colors.surfaceSoft }}>
                  <Text selectable style={{ color: colors.blue, fontSize: 11, fontWeight: "700", letterSpacing: 0, textTransform: "uppercase" }}>{question.questionType.replace("_", " ")}</Text>
                  <Text selectable style={{ color: colors.ink, fontSize: 20, fontWeight: "800", lineHeight: 26 }}>{question.question}</Text>
                  {question.options.length ? (
                    <View style={{ gap: 8 }}>
                      {question.options.map((option, optionIndex) => (
                        <Pressable key={option} onPress={() => { setQuizAnswers({ ...quizAnswers, [question.id]: option }); setCheckedQuizAnswers((current) => ({ ...current, [question.id]: false })); }} style={{ minHeight: 50, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, borderRadius: 14, borderCurve: "continuous", backgroundColor: quizAnswers[question.id] === option ? colors.blueChip : colors.surface, borderWidth: 1.5, borderColor: quizAnswers[question.id] === option ? colors.blue : "transparent" }}>
                          <View style={{ width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: quizAnswers[question.id] === option ? colors.blue : colors.bgAlt }}>
                            <Text style={{ color: quizAnswers[question.id] === option ? "#ffffff" : colors.ink, fontSize: 13, fontWeight: "800" }}>{String.fromCharCode(65 + optionIndex)}</Text>
                          </View>
                          <Text selectable style={{ flex: 1, color: colors.ink, fontWeight: "600", lineHeight: 20 }}>{option}</Text>
                          {quizAnswers[question.id] === option ? <AppIcon name="checkmark.circle.fill" size={19} color={colors.blue} /> : null}
                        </Pressable>
                      ))}
                    </View>
                  ) : (
                    <TextInput
                      value={quizAnswers[question.id] ?? ""}
                      onChangeText={(value) => { setQuizAnswers({ ...quizAnswers, [question.id]: value }); setCheckedQuizAnswers((current) => ({ ...current, [question.id]: false })); }}
                      placeholder="Type your answer"
                      style={{ minHeight: 42, borderRadius: 12, borderCurve: "continuous", borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, color: colors.ink, backgroundColor: colors.surface }}
                    />
                  )}
                  {activeQuizFeedback ? (
                    <View style={{ gap: 7, padding: 13, borderRadius: 14, borderCurve: "continuous", backgroundColor: activeQuizFeedback.status === "correct" ? colors.greenSoft : activeQuizFeedback.status === "incorrect" ? colors.redSoft : colors.blueChip }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                        <AppIcon name={activeQuizFeedback.status === "correct" ? "checkmark.circle.fill" : activeQuizFeedback.status === "incorrect" ? "exclamationmark.triangle" : "sparkles"} size={18} color={activeQuizFeedback.status === "correct" ? colors.green : activeQuizFeedback.status === "incorrect" ? colors.red : colors.blue} />
                        <Text selectable style={{ color: activeQuizFeedback.status === "correct" ? colors.green : activeQuizFeedback.status === "incorrect" ? colors.red : colors.blue, fontSize: 13, fontWeight: "900" }}>
                          {activeQuizFeedback.status === "correct" ? "Correct" : activeQuizFeedback.status === "incorrect" ? "Not quite" : "Compare your answer"}
                        </Text>
                      </View>
                      {activeQuizFeedback.status !== "correct" ? <Text selectable style={{ color: colors.ink, fontSize: 13, lineHeight: 19 }}><Text style={{ fontWeight: "900" }}>Model answer: </Text>{activeQuizFeedback.correctAnswer}</Text> : null}
                      <Text selectable style={{ color: colors.text, fontSize: 13, lineHeight: 19 }}>{activeQuizFeedback.explanation}</Text>
                    </View>
                  ) : null}
                </View>
              ); })()}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable disabled={quizIndex === 0} onPress={() => setQuizIndex((value) => Math.max(0, value - 1))} style={{ minHeight: 46, minWidth: 110, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 999, backgroundColor: colors.bgAlt, opacity: quizIndex === 0 ? 0.4 : 1 }}><AppIcon name="chevron.left" size={18} color={colors.ink} /><Text style={{ color: colors.ink, fontWeight: "800" }}>Back</Text></Pressable>
                {!activeQuizChecked ? (
                  <Pressable disabled={!activeQuizAnswer} onPress={() => setCheckedQuizAnswers((current) => ({ ...current, [activeQuizQuestion.id]: true }))} style={{ flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: activeQuizAnswer ? colors.blue : "#9aa8bd" }}><Text style={{ color: "#ffffff", fontWeight: "800" }}>Check answer</Text></Pressable>
                ) : quizIndex < quizQuestions.length - 1 ? (
                  <Pressable onPress={() => setQuizIndex((value) => Math.min(quizQuestions.length - 1, value + 1))} style={{ flex: 1, minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 999, backgroundColor: colors.blue }}><Text style={{ color: "#ffffff", fontWeight: "800" }}>Next question</Text><AppIcon name="chevron.right" size={18} color="#ffffff" /></Pressable>
                ) : (
                  <Pressable disabled={submittingQuiz || !quizComplete} onPress={onSubmitQuiz} style={{ flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: quizComplete && !submittingQuiz ? colors.blue : "#9aa8bd" }}><Text style={{ color: "#ffffff", fontSize: 14, fontWeight: "800" }}>{submittingQuiz ? "Scoring…" : "Submit quiz"}</Text></Pressable>
                )}
              </View>
            </>
          )}
        </SectionCard>
      ) : null}
    </View>
  );
}

function QuizResults({ attempt, questions, onReset }: { attempt: LearningQuizAttempt; questions: LearningQuizQuestion[]; onReset: () => void }) {
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const resultIsScored = (result: LearningQuizAttempt["results"][number]) => result.isScored ?? questionById.get(result.questionId)?.questionType !== "short_answer";
  const scoredTotal = attempt.results.filter(resultIsScored).length;
  const reviewed = Math.max(0, attempt.total - scoredTotal);
  const correct = attempt.results.filter((result) => resultIsScored(result) && result.isCorrect).length;
  const wrong = Math.max(0, scoredTotal - correct);
  const score = scoredTotal ? Math.round((correct / scoredTotal) * 100) : 0;
  return (
    <View style={{ gap: 14 }}>
      <View style={{ alignItems: "center", gap: 8, padding: 18, borderRadius: 18, borderCurve: "continuous", backgroundColor: scoredTotal ? colors.greenSoft : colors.blueChip }}>
        <Text selectable style={{ color: scoredTotal ? colors.green : colors.blue, fontSize: scoredTotal ? 42 : 30, lineHeight: 46, fontWeight: "900", fontVariant: ["tabular-nums"] }}>{scoredTotal ? `${score}%` : "Reviewed"}</Text>
        <Text selectable style={{ color: colors.ink, fontSize: 17, fontWeight: "900" }}>{scoredTotal ? "Quiz results" : "Written review complete"}</Text>
        <Text selectable style={{ color: colors.muted, fontSize: 13, textAlign: "center" }}>
          {scoredTotal ? `${correct} correct · ${wrong} wrong${reviewed ? ` · ${reviewed} written review` : ""}` : `${reviewed} written ${reviewed === 1 ? "answer" : "answers"} compared with the model answers`}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {scoredTotal ? <MetricChip label="Correct" value={correct} tone="green" /> : null}
        {scoredTotal ? <MetricChip label="Wrong" value={wrong} tone="red" /> : null}
        {reviewed ? <MetricChip label="Written review" value={reviewed} tone="blue" /> : null}
      </View>
      {attempt.results.map((result, index) => {
        const isScored = resultIsScored(result);
        const resultTone = !isScored ? { bg: colors.blueChip, fg: colors.blue } : result.isCorrect ? { bg: colors.greenSoft, fg: colors.green } : { bg: colors.redSoft, fg: colors.red };
        return (
        <View key={result.questionId} style={{ gap: 8, padding: 14, borderRadius: 14, borderCurve: "continuous", backgroundColor: resultTone.bg }}>
          <Text selectable style={{ color: resultTone.fg, fontSize: 12, fontWeight: "900" }}>
            {!isScored ? "Review" : result.isCorrect ? "Correct" : "Wrong"} · Question {index + 1}
          </Text>
          <Text selectable style={{ color: colors.ink, fontSize: 15, lineHeight: 21, fontWeight: "800" }}>{result.question}</Text>
          <Text selectable style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>Your answer: {result.userAnswer || "No answer"}</Text>
          {!isScored || !result.isCorrect ? (
            <Text selectable style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>{isScored ? "Correct answer" : "Model answer"}: {result.correctAnswer}</Text>
          ) : null}
          <Text selectable style={{ color: colors.text, fontSize: 13, lineHeight: 19 }}>{result.explanation}</Text>
        </View>
      );})}
      <Pressable onPress={onReset} style={{ minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: colors.navy }}>
        <Text style={{ color: "#ffffff", fontSize: 14, fontWeight: "800" }}>Retake quiz</Text>
      </Pressable>
    </View>
  );
}

function MetricChip({ label, value, tone }: { label: string; value: number; tone: "green" | "red" | "blue" }) {
  const palette = tone === "green" ? { bg: colors.greenSoft, fg: colors.green } : tone === "red" ? { bg: colors.redSoft, fg: colors.red } : { bg: colors.blueChip, fg: colors.blue };
  return (
    <View style={{ flex: 1, gap: 2, padding: 12, borderRadius: 14, borderCurve: "continuous", backgroundColor: palette.bg }}>
      <Text selectable style={{ color: palette.fg, fontSize: 22, fontWeight: "900", fontVariant: ["tabular-nums"] }}>{value}</Text>
      <Text selectable style={{ color: palette.fg, fontSize: 12, fontWeight: "800" }}>{label}</Text>
    </View>
  );
}

function DocumentStudyHeader({ document }: { document: ReadingDocument }) {
  return (
    <View style={{ gap: 10, paddingHorizontal: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text selectable numberOfLines={1} style={{ flex: 1, color: colors.muted, fontSize: 13, fontWeight: "600" }}>
          {document.sourceLabel ?? "ReadMate"} · {document.category}
        </Text>
        <StatusPill label={document.status.replace("_", " ")} tone={document.status === "completed" ? "green" : document.progress.percent > 0 ? "blue" : "navy"} />
      </View>
      <Text selectable style={{ color: colors.muted, fontSize: 13 }}>{document.progress.percent}% complete · {document.blocks.length} sections</Text>
    </View>
  );
}

function StudyModeSwitcher({
  mode,
  setMode,
  document,
  review
}: {
  mode: DetailMode;
  setMode: (mode: DetailMode) => void;
  document: ReadingDocument;
  review?: LearningReview;
}) {
  const counts = {
    flashcards: review?.flashcards.length ?? document.flashcards?.length ?? 0,
    quiz: review?.quizQuestions.length ?? document.quizQuestions?.length ?? 0,
    highlights: review?.keyPoints.length ?? document.keyPoints?.length ?? 0
  };
  return (
    <View style={{ gap: 10 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <Pill label="Summary" selected={mode === "summary"} onPress={() => setMode("summary")} tone="blue" />
        <Pill label={`Highlights ${counts.highlights}`} selected={mode === "highlights"} onPress={() => setMode("highlights")} tone="blue" />
        <Pill label={`Flashcards ${counts.flashcards}`} selected={mode === "flashcards"} onPress={() => setMode("flashcards")} tone="blue" />
        <Pill label={`Quiz ${counts.quiz}`} selected={mode === "quiz"} onPress={() => setMode("quiz")} tone="blue" />
        <Pill label="AI Chat" selected={mode === "ask"} onPress={() => setMode("ask")} />
      </ScrollView>
    </View>
  );
}

function StudyDepthControls({
  flashcardCount,
  setFlashcardCount,
  quizCount,
  setQuizCount,
  generating,
  onGenerate
}: {
  flashcardCount: string;
  setFlashcardCount: (value: string) => void;
  quizCount: string;
  setQuizCount: (value: string) => void;
  generating: boolean;
  onGenerate: () => void;
}) {
  return (
    <SectionCard>
      <SectionHeading title="Generate study tools" subtitle="Choose how many flashcards and quiz questions ReadMate should create for this item." />
      <Text selectable style={bodyTextStyle}>
        Use larger sets for academic PDFs, research papers, and long articles.
      </Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <CountControl label="Flashcards" value={boundedStudyCount(flashcardCount, 1, 24)} max={24} onChange={(value) => setFlashcardCount(String(value))} />
        <CountControl label="Quiz questions" value={boundedStudyCount(quizCount, 1, 12)} max={12} onChange={(value) => setQuizCount(String(value))} />
      </View>
      <Pressable disabled={generating} onPress={onGenerate} style={{ minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: generating ? "#9aa8bd" : colors.blue }}>
        <Text style={{ color: "#ffffff", fontSize: 14, fontWeight: "700" }}>{generating ? "Generating..." : "Generate study set"}</Text>
      </Pressable>
    </SectionCard>
  );
}

function CountControl({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (value: number) => void }) {
  return (
    <View style={{ flex: 1, gap: 8, padding: 10, borderRadius: 16, borderCurve: "continuous", backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border }}>
      <Text selectable numberOfLines={1} style={fieldLabelStyle}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable
          disabled={value <= 1}
          onPress={() => onChange(Math.max(1, value - 1))}
          style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: value <= 1 ? "#eef2f7" : colors.bgAlt }}
        >
          <Text style={{ color: value <= 1 ? colors.faint : colors.text, fontSize: 18, fontWeight: "900" }}>-</Text>
        </Pressable>
        <Text selectable style={{ flex: 1, textAlign: "center", color: colors.ink, fontSize: 22, fontWeight: "900", fontVariant: ["tabular-nums"] }}>
          {value}
        </Text>
        <Pressable
          disabled={value >= max}
          onPress={() => onChange(Math.min(max, value + 1))}
          style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: value >= max ? "#eef2f7" : colors.blue }}
        >
          <Text style={{ color: "#ffffff", fontSize: 18, fontWeight: "900" }}>+</Text>
        </Pressable>
      </View>
      <Text selectable style={{ color: colors.faint, fontSize: 11, fontWeight: "700" }}>Max {max}</Text>
    </View>
  );
}

function NotesAndHighlightsSection({
  noteDraft,
  setNoteDraft,
  saving,
  onSave,
  notes,
  highlights
}: {
  noteDraft: string;
  setNoteDraft: (value: string) => void;
  saving: boolean;
  onSave: () => void;
  notes: Array<{ id: string; noteText: string; blockIndex?: number; createdAt: string }>;
  highlights: Array<{ id: string; highlightText: string; highlightType: string; blockIndex: number }>;
}) {
  return (
    <SectionCard>
      <SectionHeading title="Notes and highlights" />
      <View style={{ gap: 8 }}>
        <TextInput
          value={noteDraft}
          onChangeText={setNoteDraft}
          placeholder="Add a note for the current paragraph"
          multiline
          style={{ minHeight: 72, borderRadius: 14, borderCurve: "continuous", borderWidth: 1, borderColor: colors.border, padding: 12, color: colors.ink, backgroundColor: colors.surfaceSoft }}
        />
        <Pressable
          disabled={saving || !noteDraft.trim()}
          onPress={onSave}
          style={{ minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: noteDraft.trim() && !saving ? colors.navy : "#9aa8bd" }}
        >
          <Text style={{ color: "#ffffff", fontSize: 14, fontWeight: "900" }}>{saving ? "Saving..." : "Save note"}</Text>
        </Pressable>
      </View>
      {notes.length ? (
        <View style={{ gap: 8 }}>
          {notes.map((note) => (
            <View key={note.id} style={{ gap: 4, padding: 12, borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.surfaceSoft }}>
              <Text selectable style={bodyTextStyle}>{note.noteText}</Text>
              <Text selectable style={{ color: colors.faint, fontSize: 12 }}>Paragraph {(note.blockIndex ?? 0) + 1}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {highlights.length ? (
        <View style={{ gap: 8 }}>
          {highlights.map((highlight) => (
            <View key={highlight.id} style={{ gap: 4, padding: 12, borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.amberSoft }}>
              <Text selectable style={bodyTextStyle}>{highlight.highlightText}</Text>
              <Text selectable style={{ color: colors.amber, fontSize: 12 }}>{highlight.highlightType} highlight · paragraph {highlight.blockIndex + 1}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </SectionCard>
  );
}

function LearningSections({ document, mode, review, hasReview }: { document: ReadingDocument; mode: DetailMode; review?: LearningReview; hasReview: boolean }) {
  const { isTablet } = useResponsiveLayout();
  const hasLearningData = Boolean(document.summary || document.keyPoints?.length || document.flashcards?.length || document.quizQuestions?.length || review?.keyPoints.length || review?.flashcards.length || review?.quizQuestions.length);
  if (!hasLearningData) return null;
  if (hasReview && (mode === "flashcards" || mode === "quiz")) return null;
  const keyPoints = review?.keyPoints ?? document.keyPoints ?? [];

  return (
    <View style={{ gap: 12 }}>
      {mode === "summary" && document.summary ? (
        <SectionCard>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: colors.purpleSoft }}>
              <AppIcon name="sparkles" size={18} color={colors.purple} />
            </View>
            <Text selectable style={{ flex: 1, color: colors.ink, fontSize: 16, fontWeight: "800" }}>AI Summary</Text>
          </View>
          <Text selectable style={{ color: colors.ink, fontSize: 14.5, lineHeight: 23 }}>{document.summary}</Text>
          <View style={{ padding: 12, borderRadius: 12, borderCurve: "continuous", backgroundColor: colors.bgAlt }}>
            <Text selectable style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>
              Generated from this saved item · Summary style
            </Text>
          </View>
        </SectionCard>
      ) : null}

      {mode === "highlights" && keyPoints.length ? (
        <SectionCard>
          <SectionHeading title="Key highlights" subtitle={`${keyPoints.length} grounded takeaways, paired with the closest source section.`} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {keyPoints.map((point, index) => {
            const evidence = evidenceForKeyPoint(point, document.blocks);
            const accent = [colors.amber, colors.blue, colors.green, colors.purple][index % 4];
            const accentBackground = [colors.amberSoft, colors.blueChip, colors.greenSoft, colors.purpleSoft][index % 4];
            return (
              <View key={`${point}-${index}`} style={{ width: isTablet ? "48%" : "100%", flexGrow: isTablet ? 1 : 0, gap: 12, padding: 16, borderRadius: 18, borderCurve: "continuous", backgroundColor: colors.surfaceSoft }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: accentBackground }}>
                    <Text style={{ color: accent, fontSize: 13, fontWeight: "900" }}>{index + 1}</Text>
                  </View>
                  <Text selectable style={{ color: accent, fontSize: 11, fontWeight: "900", letterSpacing: 0.4 }}>AI KEY POINT</Text>
                </View>
                <Text selectable style={{ color: colors.ink, fontSize: 15.5, lineHeight: 23, fontWeight: "700" }}>{point}</Text>
                {evidence ? (
                  <View style={{ gap: 6, padding: 12, borderRadius: 13, borderCurve: "continuous", backgroundColor: colors.surface, borderLeftWidth: 3, borderLeftColor: accent }}>
                    <Text selectable style={{ color: accent, fontSize: 11, fontWeight: "900" }}>SOURCE · {evidence.label.toUpperCase()}</Text>
                    <Text selectable numberOfLines={4} style={{ color: colors.muted, fontSize: 12.5, lineHeight: 18 }}>“{evidence.excerpt}”</Text>
                  </View>
                ) : (
                  <Text selectable style={{ color: colors.faint, fontSize: 11 }}>Generated only from this saved document.</Text>
                )}
              </View>
            );
          })}
          </View>
        </SectionCard>
      ) : null}

      {mode === "flashcards" && document.flashcards?.length ? (
        <SectionCard>
          <SectionHeading title={`Flashcards (${document.flashcards.length})`} />
          {document.flashcards.map((card, index) => (
            <View key={`${card.front}-${index}`} style={{ gap: 5, padding: 12, borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.surfaceSoft }}>
              <Text selectable style={{ color: colors.ink, fontSize: 15, fontWeight: "900", lineHeight: 21 }}>{card.front}</Text>
              <Text selectable style={bodyTextStyle}>{card.back}</Text>
            </View>
          ))}
        </SectionCard>
      ) : null}

      {mode === "quiz" && document.quizQuestions?.length ? (
        <SectionCard>
          <SectionHeading title={`Quiz (${document.quizQuestions.length})`} />
          {document.quizQuestions.map((quiz, index) => (
            <View key={`${quiz.question}-${index}`} style={{ gap: 5, padding: 12, borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.surfaceSoft }}>
              <Text selectable style={{ color: colors.ink, fontSize: 15, fontWeight: "900", lineHeight: 21 }}>{quiz.question}</Text>
              <Text selectable style={bodyTextStyle}>{quiz.answer}</Text>
            </View>
          ))}
        </SectionCard>
      ) : null}
    </View>
  );
}

function mergeLearningReview(
  review: LearningReview | undefined,
  overrides: Partial<Pick<LearningReview, "keyPoints" | "flashcards" | "quizQuestions">>
): LearningReview | undefined {
  if (!review) return undefined;
  return {
    ...review,
    keyPoints: overrides.keyPoints ?? review.keyPoints,
    flashcards: overrides.flashcards ?? review.flashcards,
    quizQuestions: overrides.quizQuestions ?? review.quizQuestions
  };
}

function hasRenderableLearningContent(mode: DetailMode, document: ReadingDocument, review?: LearningReview): boolean {
  if (mode === "highlights") return Boolean((review?.keyPoints ?? document.keyPoints ?? []).length);
  if (mode === "flashcards") return Boolean((review?.flashcards ?? []).length || (document.flashcards ?? []).length);
  if (mode === "quiz") return Boolean((review?.quizQuestions ?? []).length || (document.quizQuestions ?? []).length);
  if (mode === "summary") return Boolean(document.summary);
  return true;
}

function learningTabStatusMessage(
  mode: DetailMode,
  queries: {
    keyPoints: { isFetching: boolean; error: unknown };
    flashcards: { isFetching: boolean; error: unknown };
    quiz: { isFetching: boolean; error: unknown };
  },
  hasContent: boolean
): string | null {
  const active =
    mode === "highlights"
      ? queries.keyPoints
      : mode === "flashcards"
        ? queries.flashcards
        : mode === "quiz"
          ? queries.quiz
          : null;
  if (!active || hasContent) return null;
  if (active.error) return "We couldn't load this study tool. Please try again later.";
  if (active.isFetching) return "Loading this study tool...";
  return null;
}

function StudyToolGrid({ activeMode, document, review, onSelect }: { activeMode: DetailMode; document: ReadingDocument; review?: LearningReview; onSelect: (mode: DetailMode) => void }) {
  const { isTablet } = useResponsiveLayout();
  const tools = [
    { label: "Key highlights", sub: `${review?.keyPoints.length ?? document.keyPoints?.length ?? 0} ready`, tone: "amber" as const, icon: "textformat" as AppIconName, mode: "highlights" as const },
    { label: "Flashcards", sub: `${review?.flashcards.length ?? document.flashcards?.length ?? 0} ready`, tone: "blue" as const, icon: "rectangle.stack" as AppIconName, mode: "flashcards" as const },
    { label: "Quiz me", sub: `${review?.quizQuestions.length ?? document.quizQuestions?.length ?? 0} questions`, tone: "green" as const, icon: "questionmark.circle" as AppIconName, mode: "quiz" as const },
    { label: "Ask AI", sub: "Anything", tone: "purple" as const, icon: "sparkles" as AppIconName, mode: "ask" as const }
  ];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {tools.map((tool) => {
        const selected = activeMode === tool.mode;
        const palette = {
          amber: { bg: colors.amberSoft, fg: colors.amber },
          blue: { bg: colors.blueChip, fg: colors.blue },
          green: { bg: colors.greenSoft, fg: colors.green },
          purple: { bg: colors.purpleSoft, fg: colors.purple }
        }[tool.tone];
        return (
          <Pressable
            key={tool.label}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${tool.label}, ${tool.sub}`}
            onPress={() => onSelect(tool.mode)}
            style={{ width: isTablet ? "24%" : "48%", flexGrow: 1, minHeight: 80, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderCurve: "continuous", backgroundColor: selected ? palette.bg : colors.surface, borderWidth: 1.5, borderColor: selected ? palette.fg : "transparent", boxShadow: "0 1px 0 rgba(15,26,40,0.04)" }}
          >
            <View style={{ width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: palette.bg }}>
              <AppIcon name={tool.icon} size={18} color={palette.fg} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text selectable numberOfLines={1} style={{ color: colors.ink, fontSize: 14, fontWeight: "800" }}>{tool.label}</Text>
              <Text selectable numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>{tool.sub}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function InlineStatusMessage({ message, tone, onRetry }: { message: string; tone: "loading" | "error" | "notice"; onRetry?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, borderCurve: "continuous", backgroundColor: tone === "error" ? colors.redSoft : tone === "notice" ? colors.amberSoft : colors.blueChip }}>
      <Text selectable style={{ flex: 1, color: tone === "error" ? colors.red : tone === "notice" ? colors.amber : colors.blue, fontSize: 13, lineHeight: 19, fontWeight: "700" }}>
        {message}
      </Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Retry" onPress={onRetry} style={{ minHeight: 38, justifyContent: "center", paddingHorizontal: 12, borderRadius: 999, backgroundColor: tone === "error" ? colors.claret : colors.blue }}>
          <Text style={{ color: "#ffffff", fontSize: 12, fontWeight: "900" }}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const bodyTextStyle = {
  color: colors.muted,
  fontSize: 15,
  lineHeight: 22
};

const fieldLabelStyle = {
  color: colors.muted,
  fontSize: 12,
  fontWeight: "900" as const
};

const countInputStyle = {
  minHeight: 44,
  borderRadius: 12,
  borderCurve: "continuous" as const,
  borderWidth: 1,
  borderColor: colors.border,
  paddingHorizontal: 12,
  color: colors.ink,
  backgroundColor: colors.surfaceSoft,
  fontSize: 16,
  fontWeight: "900" as const,
  textAlign: "center" as const
};

function reviewButtonStyle(backgroundColor: string) {
  return {
    flex: 1,
    minHeight: 36,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: 999,
    backgroundColor
  };
}

const reviewButtonTextStyle = {
  fontSize: 13,
  fontWeight: "900" as const
};

function normalizeCountInput(value: string, max: number): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return String(Math.min(max, Math.max(1, Number(digits))));
}

function askRequestErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  if (/401|unauthori[sz]ed|sign in/i.test(message)) return "Sign in again to ask about this article.";
  if (/429|rate|quota|high demand|temporar|503|504/i.test(message)) return "Ask AI is busy right now. Your question is still here—try again in a moment.";
  if (/network|fetch|connection|timeout/i.test(message)) return "ReadMate could not reach Ask AI. Check your connection and try again.";
  return message || "Ask AI could not answer that question. Try again.";
}

function studyGenerationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  if (/401|unauthori[sz]ed|sign in/i.test(message)) return "Your session has expired. Sign in again, then retry your study set.";
  if (/daily usage limit|allowance|quota/i.test(message)) return "You've reached today's AI allowance. Your choices are saved—try again after it resets.";
  if (/402|premium|required|upgrade/i.test(message)) return "This study set needs a premium plan. Your choices are saved.";
  if (/429|high demand|temporar|busy|503|504/i.test(message)) return "ReadMate is busy right now. Your choices are saved—retry in a moment.";
  if (/network|fetch|connection|timeout/i.test(message)) return "ReadMate couldn't reach the study service. Check your connection and retry.";
  return message && !/unexpected server error/i.test(message)
    ? message
    : "ReadMate couldn't generate this study set. Your choices are saved—please retry.";
}

function boundedStudyCount(value: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}
