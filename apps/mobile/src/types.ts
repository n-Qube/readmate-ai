export type ReadingDocument = {
  id: string;
  userId: string;
  title: string;
  sourceType: "webpage" | "selection" | "pdf" | "ocr" | "url" | "rss" | "news" | "document";
  sourceUrl?: string;
  canonicalUrl?: string;
  rssFeedUrl?: string;
  dedupeKey?: string;
  category: string;
  sourceLabel?: string;
  thumbnailUrl?: string;
  coverImageUrl?: string;
  author?: string;
  description?: string;
  pageCount?: number;
  status: "unread" | "in_progress" | "completed";
  summary?: string;
  keyPoints?: string[];
  quizQuestions?: Array<{ question: string; answer: string }>;
  flashcards?: Array<{ front: string; back: string }>;
  estimatedListeningSeconds?: number;
  createdAt: string;
  updatedAt: string;
  lastReadAt?: string;
  progress: {
    blockIndex: number;
    characterOffset: number;
    sentenceIndex: number;
    percent: number;
  };
  provider: "google" | "gemini" | "gemini-lite";
  voice: string;
  speed: number;
  blocks: ReadingBlock[];
};

export type ReadingBlock = {
  id: string;
  orderIndex: number;
  blockType: "heading" | "paragraph" | "list" | "quote" | "table" | "caption" | "page";
  text: string;
  sourceSelector?: string;
  sourcePageNumber?: number;
};

export type UserSettings = {
  userId: string;
  provider: "google" | "gemini" | "gemini-lite";
  voice: string;
  speed: number;
  tone?: string;
  targetLanguage: "en" | "tw" | "ee" | "gaa";
  autoScroll: boolean;
  highlightMode: "sentence" | "paragraph" | "none";
  preferredContentTypes: ReadingDocument["sourceType"][];
  articlesPerFeed: number;
  updatedAt: string;
};

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

export type SourceSubscription = {
  id: string;
  userId: string;
  sourceName: string;
  websiteUrl?: string;
  rssFeedUrl?: string;
  sourceType: "website" | "rss";
  topics: string[];
  isSubscribed: boolean;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ReadingNote = {
  id: string;
  userId: string;
  documentId: string;
  highlightId?: string;
  noteText: string;
  blockIndex?: number;
  sentenceIndex?: number;
  createdAt: string;
  updatedAt: string;
};

export type ReadingHighlight = {
  id: string;
  userId: string;
  documentId: string;
  blockId?: string;
  blockIndex: number;
  sentenceIndex?: number;
  highlightText: string;
  highlightType: "sentence" | "paragraph" | "manual" | "ai";
  createdAt: string;
  updatedAt: string;
};

export type LearningFlashcard = {
  id: string;
  documentId: string;
  question: string;
  answer: string;
  topicTag?: string;
  difficulty: string;
  reviewStatus: "new" | "known" | "needs_review";
  createdAt: string;
  updatedAt: string;
};

export type LearningQuizQuestion = {
  id: string;
  documentId: string;
  question: string;
  questionType: "multiple_choice" | "true_false" | "short_answer" | "fill_blank" | string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  topicTag?: string;
  createdAt: string;
  updatedAt: string;
};

export type LearningQuizAttempt = {
  id: string;
  documentId: string;
  answers: Record<string, string>;
  score: number;
  total: number;
  scoredTotal: number;
  correct: number;
  createdAt: string;
  results: Array<{
    questionId: string;
    question: string;
    userAnswer: string;
    correctAnswer: string;
    explanation: string;
    isCorrect: boolean;
    isScored: boolean;
  }>;
};

export type LearningReview = {
  documentId: string;
  summary?: string;
  keyPoints: string[];
  topicTags: string[];
  flashcards: LearningFlashcard[];
  quizQuestions: LearningQuizQuestion[];
  quizAttempts: LearningQuizAttempt[];
  progress: {
    notesCount: number;
    highlightsCount: number;
    flashcardsReviewed: number;
    quizAttempts: number;
    bestQuizScore?: number;
  };
};

export type GlobalLearningReview = {
  documents: Array<{
    documentId: string;
    title: string;
    sourceType: ReadingDocument["sourceType"];
    sourceLabel?: string;
    topicTags: string[];
    progressPercent: number;
    needsReview: number;
    quizAttempts: number;
    bestQuizScore?: number;
    updatedAt: string;
  }>;
  totals: {
    studied: number;
    notes: number;
    highlights: number;
    flashcards: number;
    flashcardsReviewed: number;
    quizAttempts: number;
    averageQuizScore: number;
  };
};

export type AskAiAnswer = {
  answer: string;
  citedSections: string[];
  fallback?: boolean;
};
