export type SourceType = "webpage" | "selection" | "pdf" | "ocr" | "url" | "rss" | "news" | "document";

export type ReadingChunk = {
  id: string;
  text: string;
  sourceType: SourceType;
  pageUrl?: string;
  title?: string;
  thumbnailUrl?: string;
  author?: string;
  description?: string;
  elementSelector?: string;
  elementSelectors?: string[];
  pageNumber?: number;
  startOffset?: number;
  endOffset?: number;
};

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "ended" | "error";
export type TtsProvider = "google" | "gemini" | "gemini-lite";
export type TargetLanguage = "en" | "tw" | "ee" | "gaa";

export type PlayerState = {
  status: PlayerStatus;
  currentDocumentId?: string;
  currentChunkIndex: number;
  currentTime: number;
  duration: number;
  speed: number;
  voice: string;
  error?: string;
};

export type ReadingDocument = {
  id: string;
  userId: string;
  title: string;
  sourceType: SourceType;
  sourceUrl?: string;
  category?: string;
  sourceLabel?: string;
  thumbnailUrl?: string;
  coverImageUrl?: string;
  author?: string;
  description?: string;
  pageCount?: number;
  status?: "unread" | "in_progress" | "completed";
  summary?: string;
  keyPoints?: string[];
  quizQuestions?: Array<{ question: string; answer: string }>;
  flashcards?: Array<{ front: string; back: string }>;
  estimatedListeningSeconds?: number;
  createdAt: string;
  updatedAt: string;
  lastReadAt?: string;
  progress: {
    chunkIndex?: number;
    blockIndex?: number;
    characterOffset?: number;
    sentenceIndex?: number;
    percent: number;
  };
  provider?: TtsProvider;
  voice: string;
  speed: number;
  blocks?: ReadingDocumentBlock[];
};

export type ReadingDocumentBlock = {
  id?: string;
  orderIndex: number;
  blockType?: "heading" | "paragraph" | "list" | "quote" | "table" | "caption" | "page";
  text: string;
  sourceSelector?: string;
  sourcePageNumber?: number;
};

export type LearningReview = {
  documentId: string;
  summary?: string;
  keyPoints: string[];
  topicTags: string[];
  flashcards: Array<{
    id: string;
    documentId: string;
    question: string;
    answer: string;
    topicTag?: string;
    difficulty: string;
    reviewStatus: "new" | "known" | "needs_review";
    createdAt: string;
    updatedAt: string;
  }>;
  quizQuestions: Array<{
    id: string;
    documentId: string;
    question: string;
    questionType: string;
    options: string[];
    correctAnswer: string;
    explanation: string;
    topicTag?: string;
    createdAt: string;
    updatedAt: string;
  }>;
  quizAttempts: Array<{
    id: string;
    documentId: string;
    answers: Record<string, string>;
    score: number;
    total: number;
    correct: number;
    createdAt: string;
    results: Array<{
      questionId: string;
      question: string;
      userAnswer: string;
      correctAnswer: string;
      explanation: string;
      isCorrect: boolean;
    }>;
  }>;
  progress: {
    notesCount: number;
    highlightsCount: number;
    flashcardsReviewed: number;
    quizAttempts: number;
    bestQuizScore?: number;
  };
};

export type ExtensionSettings = {
  ttsProvider: TtsProvider;
  voice: string;
  speed: number;
  instructions: string;
  targetLanguage: TargetLanguage;
  autoScroll: boolean;
  highlightMode: "sentence" | "paragraph" | "none";
  preferredContentTypes: SourceType[];
  apiBaseUrl: string;
};
