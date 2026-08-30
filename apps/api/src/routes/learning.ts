import type { Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getUserId, type AuthedRequest } from "../auth.js";
import { clearLearningDataForDocument } from "../learning/cleanup.js";
import { GeminiLearningGenerator, type LearningGenerator } from "../learning/gemini.js";
import { studyUiSchema, type AskAnswer, type LearningPayload, type StudyUi } from "../learning/schema.js";
import { isLocalLanguage, SUPPORTED_TARGET_LANGUAGES, translateEnglishToLocalLanguage, type TargetLanguage } from "../localLanguage.js";
import { isDatabaseUnavailableError } from "../databaseErrors.js";
import type { prisma as PrismaSingleton } from "../prisma.js";
import type { DocumentRepository, ReadingDocumentResponse } from "./documents.js";
import { PrismaDocumentRepository } from "./documents.js";
import {
  consumeDailyUsage,
  DEFAULT_AI_DAILY_INPUT_CHAR_LIMIT,
  usageLimitFromEnv
} from "../usageQuota.js";
import {
  beginWebMcpAction,
  completeWebMcpAction,
  failWebMcpAction,
  markWebMcpReplay,
  requireWebMcpReplayResourceId,
  WebMcpActionIdempotencyError,
  type BeginWebMcpActionResult,
  type WebMcpActionIdempotencyDeps
} from "../webmcp/actionIdempotency.js";
import {
  beginStudyPackEffect,
  completeStudyPackEffect,
  failStudyPackEffect,
  type StudyPackEffectExecution,
  type StudyPackEffectRepository
} from "../webmcp/studyPackIdempotency.js";
import { assertAccountDeletionNotFenced } from "../webmcp/accountDeletionFence.js";

const askSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  targetLanguage: z.enum(SUPPORTED_TARGET_LANGUAGES).default("en")
});

const reviewStatuses = ["new", "known", "needs_review"] as const;
const flashcardReviewSchema = z.object({
  reviewStatus: z.enum(reviewStatuses)
});
export const quizAttemptSchema = z.object({
  answers: z.record(z.string().trim().min(1), z.string().trim().max(2000)).refine(
    (answers) => Object.keys(answers).length <= 100,
    "Too many quiz answers."
  )
});

const DEFAULT_FLASHCARD_COUNT = 6;
const DEFAULT_QUIZ_COUNT = 4;
const MAX_FLASHCARD_COUNT = 24;
const MAX_QUIZ_COUNT = 12;
const LEARNING_SYNC_MAX_ATTEMPTS = 2;
const LEARNING_TRANSLATION_CONCURRENCY = 3;

const learningGenerationOptionsSchema = z.object({
  flashcardCount: z.coerce.number().int().min(1).max(MAX_FLASHCARD_COUNT).optional(),
  quizCount: z.coerce.number().int().min(1).max(MAX_QUIZ_COUNT).optional(),
  targetLanguage: z.enum(SUPPORTED_TARGET_LANGUAGES).default("en")
});

type LearningGenerationOptions = {
  flashcardCount: number;
  quizCount: number;
  targetLanguage: TargetLanguage;
};

export type LearningFlashcardResponse = {
  id: string;
  documentId: string;
  question: string;
  answer: string;
  topicTag?: string;
  difficulty: string;
  reviewStatus: (typeof reviewStatuses)[number];
  createdAt: string;
  updatedAt: string;
};

export type LearningQuizQuestionResponse = {
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
};

export type LearningQuizAttemptResponse = {
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

export type LearningReviewResponse = {
  documentId: string;
  summary?: string;
  keyPoints: string[];
  topicTags: string[];
  flashcards: LearningFlashcardResponse[];
  quizQuestions: LearningQuizQuestionResponse[];
  quizAttempts: LearningQuizAttemptResponse[];
  progress: {
    notesCount: number;
    highlightsCount: number;
    flashcardsReviewed: number;
    quizAttempts: number;
    bestQuizScore?: number;
  };
};

export type GlobalLearningReviewResponse = {
  documents: Array<{
    documentId: string;
    title: string;
    sourceType: string;
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

export type LearningRepository = {
  syncGeneratedLearning(userId: string, documentId: string, learning: LearningPayload): Promise<void>;
  getReview(userId: string, document: ReadingDocumentResponse): Promise<LearningReviewResponse>;
  listReview(userId: string, documents: ReadingDocumentResponse[]): Promise<GlobalLearningReviewResponse>;
  markFlashcardReview(
    userId: string,
    documentId: string,
    flashcardId: string,
    reviewStatus: (typeof reviewStatuses)[number]
  ): Promise<LearningFlashcardResponse | null>;
  createQuizAttempt(
    userId: string,
    documentId: string,
    answers: Record<string, string>
  ): Promise<LearningQuizAttemptResponse | null>;
  clearLearningData(userId: string, documentId: string): Promise<boolean>;
};

type LearningRouterDeps = {
  documentRepository?: DocumentRepository;
  learningRepository?: LearningRepository;
  generator?: LearningGenerator;
  consumeUsage?: typeof consumeDailyUsage;
  webMcpActionRepository?: WebMcpActionIdempotencyDeps["repository"];
  webMcpDigestKey?: string;
  studyPackEffectRepository?: StudyPackEffectRepository;
  accountDeletionGuard?: (userId: string) => Promise<void>;
};

export function learningRouter(deps: LearningRouterDeps = {}): Router {
  const router = createRouter();
  const documentRepository = deps.documentRepository ?? new PrismaDocumentRepository();
  const learningRepository = deps.learningRepository ?? new PrismaLearningRepository();
  const generator = deps.generator ?? new GeminiLearningGenerator();
  const consumeUsage = deps.consumeUsage ?? consumeDailyUsage;
  const accountDeletionGuard = deps.accountDeletionGuard ?? assertAccountDeletionNotFenced;

  router.get("/review", async (req: AuthedRequest, res: Response, next) => {
    try {
      const documents = await documentRepository.listDocuments(getUserId(req));
      res.json(await learningRepository.listReview(getUserId(req), documents));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:documentId/summary", async (req: AuthedRequest, res: Response, next) => {
    let webMcpAction: Extract<BeginWebMcpActionResult, { kind: "disabled" | "execute" }> | undefined;
    let studyPackEffect: StudyPackEffectExecution | undefined;
    try {
      const options = parseLearningGenerationOptions(req.body);
      const userId = getUserId(req);
      const document = await loadDocument(documentRepository, userId, String(req.params.documentId), res);
      if (!document) return;

      const action = await beginWebMcpAction(
        req,
        {
          userId,
          toolName: "readmate_generate_study_pack",
          actionClass: "paid_ai",
          canonicalInput: {
            documentId: document.id,
            targetLanguage: options.targetLanguage,
            flashcardCount: options.flashcardCount,
            quizCount: options.quizCount
          }
        },
        {
          repository: deps.webMcpActionRepository,
          digestKey: deps.webMcpDigestKey
        }
      );

      if (action.kind === "replay") {
        const resourceId = requireWebMcpReplayResourceId(action.event, "study_pack");
        if (resourceId !== document.id) throw replayResourceUnavailableError();
        const learning = learningPayloadForReplay(document);
        markWebMcpReplay(res);
        res.json({ learning, document, syncPending: false, requested: options, replayed: true });
        return;
      }

      if (action.kind === "execute") {
        const effect = await beginStudyPackEffect(action, document.id, deps.studyPackEffectRepository);
        if (effect.kind === "in_progress") {
          throw new WebMcpActionIdempotencyError(
            "IDEMPOTENCY_IN_PROGRESS",
            409,
            "This study pack is already being generated. Retry with the same request ID.",
            2
          );
        }

        webMcpAction = action;
        if (effect.kind === "conflict") {
          throw new WebMcpActionIdempotencyError(
            "IDEMPOTENCY_CONFLICT",
            409,
            "This request ID conflicts with an existing study-pack action."
          );
        }
        if (effect.kind === "failed") {
          throw new WebMcpActionIdempotencyError(
            "IDEMPOTENCY_PREVIOUSLY_FAILED",
            409,
            "This confirmed study-pack action previously failed. Confirm it again to create a new request."
          );
        }
        if (effect.kind === "replay") {
          const completedDocument = await documentRepository.getDocument(userId, effect.effect.documentId);
          if (!completedDocument) throw replayResourceUnavailableError();
          const learning = learningPayloadForReplay(completedDocument);
          await completeWebMcpAction(webMcpAction, {
            resourceType: "study_pack",
            resourceId: completedDocument.id
          });
          markWebMcpReplay(res);
          res.json({ learning, document: completedDocument, syncPending: false, requested: options, replayed: true });
          return;
        }
        studyPackEffect = effect;
      } else {
        webMcpAction = action;
      }

      if (action.kind === "execute") await accountDeletionGuard(userId);
      await chargeAiUsage(consumeUsage, userId, document);
      const { learning, fallback } = await generateLearningForDocument(generator, document, options);
      if (action.kind === "execute") await accountDeletionGuard(userId);
      const updated = await documentRepository.updateDocument(userId, document.id, {
        summary: learning.summary.detailed,
        keyPoints: learning.keyPoints,
        topicTags: learning.topicTags,
        flashcards: learning.flashcards.map((card) => ({ front: card.question, back: card.answer })),
        quizQuestions: learning.quiz.map((quiz) => ({ question: quiz.question, answer: `${quiz.correctAnswer}\n\n${quiz.explanation}` }))
      });
      if (action.kind === "execute") await accountDeletionGuard(userId);
      const syncPending = !(await syncGeneratedLearningResiliently(learningRepository, userId, document.id, learning));
      await completeStudyPackEffect(studyPackEffect);
      await completeWebMcpAction(webMcpAction, { resourceType: "study_pack", resourceId: document.id });
      res.json({ learning, document: updated, fallback, syncPending, requested: options });
    } catch (error) {
      await failStudyPackEffect(studyPackEffect, error);
      await failWebMcpAction(webMcpAction, error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.issues[0]?.message ?? "Invalid learning generation request." });
        return;
      }
      next(error);
    }
  });

  router.post("/:documentId/flashcards", async (req: AuthedRequest, res: Response, next) => {
    try {
      const options = parseLearningGenerationOptions(req.body);
      const document = await loadDocument(documentRepository, getUserId(req), String(req.params.documentId), res);
      if (!document) return;
      await chargeAiUsage(consumeUsage, getUserId(req), document);
      const { learning, fallback } = await generateLearningForDocument(generator, document, options);
      const flashcards = learning.flashcards.map((card) => ({ front: card.question, back: card.answer }));
      const updated = await documentRepository.updateDocument(getUserId(req), document.id, { flashcards });
      const syncPending = !(await syncGeneratedLearningResiliently(learningRepository, getUserId(req), document.id, learning));
      res.json({ flashcards: learning.flashcards, document: updated, fallback, syncPending, requested: options });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.issues[0]?.message ?? "Invalid flashcard generation request." });
        return;
      }
      next(error);
    }
  });

  router.post("/:documentId/quiz", async (req: AuthedRequest, res: Response, next) => {
    try {
      const options = parseLearningGenerationOptions(req.body);
      const document = await loadDocument(documentRepository, getUserId(req), String(req.params.documentId), res);
      if (!document) return;
      await chargeAiUsage(consumeUsage, getUserId(req), document);
      const { learning, fallback } = await generateLearningForDocument(generator, document, options);
      const quizQuestions = learning.quiz.map((quiz) => ({ question: quiz.question, answer: `${quiz.correctAnswer}\n\n${quiz.explanation}` }));
      const updated = await documentRepository.updateDocument(getUserId(req), document.id, { quizQuestions });
      const syncPending = !(await syncGeneratedLearningResiliently(learningRepository, getUserId(req), document.id, learning));
      res.json({ quiz: learning.quiz, document: updated, fallback, syncPending, requested: options });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.issues[0]?.message ?? "Invalid quiz generation request." });
        return;
      }
      next(error);
    }
  });

  router.get("/:documentId/review", async (req: AuthedRequest, res: Response, next) => {
    try {
      const document = await loadDocument(documentRepository, getUserId(req), String(req.params.documentId), res);
      if (!document) return;
      res.json(await learningRepository.getReview(getUserId(req), document));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:documentId/key-points", async (req: AuthedRequest, res: Response, next) => {
    try {
      const document = await loadDocument(documentRepository, getUserId(req), String(req.params.documentId), res);
      if (!document) return;
      const review = await learningRepository.getReview(getUserId(req), document);
      res.json(review.keyPoints);
    } catch (error) {
      next(error);
    }
  });

  router.get("/:documentId/flashcards", async (req: AuthedRequest, res: Response, next) => {
    try {
      const document = await loadDocument(documentRepository, getUserId(req), String(req.params.documentId), res);
      if (!document) return;
      const review = await learningRepository.getReview(getUserId(req), document);
      res.json(review.flashcards);
    } catch (error) {
      next(error);
    }
  });

  router.get("/:documentId/quiz", async (req: AuthedRequest, res: Response, next) => {
    try {
      const document = await loadDocument(documentRepository, getUserId(req), String(req.params.documentId), res);
      if (!document) return;
      const review = await learningRepository.getReview(getUserId(req), document);
      res.json(review.quizQuestions);
    } catch (error) {
      next(error);
    }
  });

  router.get("/:documentId/ui", async (req: AuthedRequest, res: Response, next) => {
    try {
      const document = await loadDocument(documentRepository, getUserId(req), String(req.params.documentId), res);
      if (!document) return;
      const review = await learningRepository.getReview(getUserId(req), document);
      res.json(studyUiSchema.parse(studyUiForReview(document, review)));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:documentId/flashcards/:flashcardId/review", async (req: AuthedRequest, res: Response, next) => {
    try {
      const payload = flashcardReviewSchema.parse(req.body);
      const document = await loadDocument(documentRepository, getUserId(req), String(req.params.documentId), res);
      if (!document) return;
      const flashcard = await learningRepository.markFlashcardReview(
        getUserId(req),
        document.id,
        String(req.params.flashcardId),
        payload.reviewStatus
      );
      if (!flashcard) {
        res.status(404).json({ error: "Flashcard not found." });
        return;
      }
      res.json(flashcard);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.issues[0]?.message ?? "Invalid flashcard review request." });
        return;
      }
      next(error);
    }
  });

  router.post("/:documentId/quiz/attempts", async (req: AuthedRequest, res: Response, next) => {
    try {
      const payload = quizAttemptSchema.parse(req.body);
      const document = await loadDocument(documentRepository, getUserId(req), String(req.params.documentId), res);
      if (!document) return;
      const attempt = await learningRepository.createQuizAttempt(getUserId(req), document.id, payload.answers);
      if (!attempt) {
        res.status(404).json({ error: "Quiz questions not found." });
        return;
      }
      res.status(201).json(attempt);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.issues[0]?.message ?? "Invalid quiz attempt request." });
        return;
      }
      next(error);
    }
  });

  router.post("/:documentId/ask", async (req: AuthedRequest, res: Response, next) => {
    try {
      const payload = askSchema.parse(req.body);
      const document = await loadDocument(documentRepository, getUserId(req), String(req.params.documentId), res);
      if (!document) return;
      await chargeAiUsage(consumeUsage, getUserId(req), document, payload.question);
      const { answer, fallback } = await answerQuestionForDocument(generator, document, payload.question, payload.targetLanguage);
      res.json({ ...answer, fallback });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.issues[0]?.message ?? "Invalid learning request." });
        return;
      }
      next(error);
    }
  });

  router.delete("/:documentId", async (req: AuthedRequest, res: Response, next) => {
    try {
      const document = await loadDocument(documentRepository, getUserId(req), String(req.params.documentId), res);
      if (!document) return;
      await learningRepository.clearLearningData(getUserId(req), document.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function loadDocument(
  repository: DocumentRepository,
  userId: string,
  documentId: string,
  res: Response
): Promise<ReadingDocumentResponse | null> {
  const document = await repository.getDocument(userId, documentId);
  if (!document) {
    res.status(404).json({ error: "Document not found." });
    return null;
  }
  return document;
}

function documentPromptInput(document: ReadingDocumentResponse, question?: string): { title: string; text: string } {
  return {
    title: document.title,
    text: question ? relevantDocumentText(document, question) : document.blocks.map((block) => block.text).join("\n\n")
  };
}

async function chargeAiUsage(
  consumeUsage: typeof consumeDailyUsage,
  userId: string,
  document: ReadingDocumentResponse,
  question?: string
): Promise<void> {
  const prompt = documentPromptInput(document, question);
  const quantity = Math.max(1, prompt.title.length + prompt.text.length + (question?.length ?? 0));
  await consumeUsage(
    userId,
    "ai_input_chars",
    quantity,
    usageLimitFromEnv("AI_DAILY_INPUT_CHAR_LIMIT", DEFAULT_AI_DAILY_INPUT_CHAR_LIMIT)
  );
}

function parseLearningGenerationOptions(body: unknown): LearningGenerationOptions {
  const parsed = learningGenerationOptionsSchema.parse(body ?? {});
  return {
    flashcardCount: parsed.flashcardCount ?? DEFAULT_FLASHCARD_COUNT,
    quizCount: parsed.quizCount ?? DEFAULT_QUIZ_COUNT,
    targetLanguage: parsed.targetLanguage
  };
}

function learningPayloadForReplay(document: ReadingDocumentResponse): LearningPayload {
  const detailed = document.summary?.trim();
  const keyPoints = document.keyPoints?.map((point) => point.trim()).filter(Boolean) ?? [];
  const topicTags = document.topicTags?.map((tag) => tag.trim()).filter(Boolean) ?? [];
  const flashcards = document.flashcards?.filter((card) => card.front.trim() && card.back.trim()) ?? [];
  const quizQuestions = document.quizQuestions?.filter((question) => question.question.trim() && question.answer.trim()) ?? [];

  if (!detailed || !keyPoints.length || !topicTags.length || !flashcards.length || !quizQuestions.length) {
    throw replayResourceUnavailableError();
  }

  return {
    summary: {
      short: detailed.slice(0, 1000),
      medium: keyPoints.slice(0, 8),
      detailed: detailed.slice(0, 4000)
    },
    keyPoints: keyPoints.slice(0, 12),
    topicTags: topicTags.slice(0, 12),
    flashcards: flashcards.slice(0, MAX_FLASHCARD_COUNT).map((card) => ({
      question: card.front,
      answer: card.back
    })),
    quiz: quizQuestions.slice(0, MAX_QUIZ_COUNT).map((question) => {
      const [correctAnswer = question.answer, explanation = "Review the saved study material."] = question.answer.split(/\n\n/, 2);
      return {
        type: "short_answer" as const,
        question: question.question,
        correctAnswer,
        explanation: explanation || "Review the saved study material."
      };
    })
  };
}

function replayResourceUnavailableError(): WebMcpActionIdempotencyError {
  return new WebMcpActionIdempotencyError(
    "IDEMPOTENCY_RESOURCE_UNAVAILABLE",
    409,
    "The completed study pack is no longer available. Confirm the action again to create a new request."
  );
}

async function generateLearningForDocument(
  generator: LearningGenerator,
  document: ReadingDocumentResponse,
  options: LearningGenerationOptions
): Promise<{ learning: LearningPayload; fallback: boolean }> {
  let learning: LearningPayload;
  let fallback = false;
  try {
    learning = await generator.generateLearning({
      ...documentPromptInput(document),
      flashcardCount: options.flashcardCount,
      quizCount: options.quizCount
    });
  } catch (error) {
    console.warn("ReadMate learning generation used extractive fallback.", {
      documentId: document.id,
      recoverable: isRecoverableGeminiError(error),
      error: error instanceof Error ? error.message : String(error)
    });
    learning = fallbackLearningForDocument(document, options);
    fallback = true;
  }

  try {
    return { learning: await localizeLearningPayload(learning, options.targetLanguage), fallback };
  } catch (error) {
    console.warn("ReadMate returned English study material because local-language translation was unavailable.", {
      documentId: document.id,
      targetLanguage: options.targetLanguage,
      error: error instanceof Error ? error.message : String(error)
    });
    return { learning, fallback: true };
  }
}

async function answerQuestionForDocument(
  generator: LearningGenerator,
  document: ReadingDocumentResponse,
  question: string,
  targetLanguage: TargetLanguage
): Promise<{ answer: AskAnswer; fallback: boolean }> {
  const promptInput = documentPromptInput(document, question);
  try {
    return { answer: await localizeAskAnswer(await generator.answerQuestion({ ...promptInput, question }), targetLanguage), fallback: false };
  } catch (error) {
    console.warn("ReadMate Ask AI used extractive fallback.", {
      documentId: document.id,
      recoverable: isRecoverableGeminiError(error),
      error: error instanceof Error ? error.message : String(error)
    });
    return { answer: await localizeAskAnswer(fallbackAnswerForQuestion(document, question, promptInput.text), targetLanguage), fallback: true };
  }
}

async function localizeLearningPayload(learning: LearningPayload, targetLanguage: TargetLanguage): Promise<LearningPayload> {
  if (!isLocalLanguage(targetLanguage)) return learning;

  const sourceTexts = [
    learning.summary.short,
    ...learning.summary.medium,
    learning.summary.detailed,
    ...learning.keyPoints,
    ...learning.topicTags,
    ...learning.flashcards.flatMap((card) => [card.question, card.answer]),
    ...learning.quiz.flatMap((question) => [question.question, ...(question.options ?? []), question.correctAnswer, question.explanation])
  ];
  const translations = await translateLearningTexts(sourceTexts, targetLanguage);
  let translationIndex = 0;
  const takeTranslation = () => translations[translationIndex++] ?? sourceTexts[translationIndex - 1] ?? "";

  return {
    summary: {
      short: takeTranslation(),
      medium: learning.summary.medium.map(takeTranslation),
      detailed: takeTranslation()
    },
    keyPoints: learning.keyPoints.map(takeTranslation),
    topicTags: learning.topicTags.map(takeTranslation),
    flashcards: learning.flashcards.map(() => ({
      question: takeTranslation(),
      answer: takeTranslation()
    })),
    quiz: learning.quiz.map((question) => ({
        ...question,
        question: takeTranslation(),
        options: question.options?.map(takeTranslation),
        correctAnswer: takeTranslation(),
        explanation: takeTranslation()
      }))
  };
}

async function localizeAskAnswer(answer: AskAnswer, targetLanguage: TargetLanguage): Promise<AskAnswer> {
  if (!isLocalLanguage(targetLanguage)) return answer;
  try {
    return {
      answer: await translateLearningText(answer.answer, targetLanguage),
      citedSections: await translateLearningTexts(answer.citedSections, targetLanguage)
    };
  } catch (error) {
    console.warn("ReadMate Ask AI returned English because local-language translation was unavailable.", {
      targetLanguage,
      error: error instanceof Error ? error.message : String(error)
    });
    return answer;
  }
}

async function translateLearningTexts(texts: string[], targetLanguage: Exclude<TargetLanguage, "en">): Promise<string[]> {
  const translated = new Array<string>(texts.length);
  let nextIndex = 0;
  const workerCount = Math.min(LEARNING_TRANSLATION_CONCURRENCY, texts.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < texts.length) {
      const index = nextIndex++;
      translated[index] = await translateLearningText(texts[index], targetLanguage);
    }
  }));
  return translated;
}

async function syncGeneratedLearningResiliently(
  repository: LearningRepository,
  userId: string,
  documentId: string,
  learning: LearningPayload
): Promise<boolean> {
  for (let attempt = 1; attempt <= LEARNING_SYNC_MAX_ATTEMPTS; attempt += 1) {
    try {
      await repository.syncGeneratedLearning(userId, documentId, learning);
      return true;
    } catch (error) {
      if (!isDatabaseUnavailableError(error)) throw error;
      if (attempt < LEARNING_SYNC_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
        continue;
      }
      console.warn("ReadMate deferred generated study-row sync after a temporary database failure.", {
        documentId,
        attempts: attempt
      });
    }
  }
  return false;
}

async function translateLearningText(text: string, targetLanguage: Exclude<TargetLanguage, "en">): Promise<string> {
  return (await translateEnglishToLocalLanguage(text, targetLanguage)).join(" ").trim() || text;
}

function isRecoverableGeminiError(error: unknown): boolean {
  if (error instanceof Error && error.name === "TimeoutError") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /high demand|overload|overloaded|unavailable|temporar|try again|timed?\s*out|timeout|429|500|502|503|504|rate|quota|resource_exhausted|Gemini request failed/i.test(message);
}

function fallbackLearningForDocument(document: ReadingDocumentResponse, options: LearningGenerationOptions): LearningPayload {
  const text = document.blocks.map((block) => block.text.trim()).filter(Boolean).join("\n");
  const sentences = extractStudySentences(text, document.title);
  const summarySentences = sentences.slice(0, 3);
  const shortSummary = summarySentences[0] ?? document.description ?? document.title;
  const desiredPointCount = Math.max(6, options.flashcardCount, options.quizCount);
  const keyPoints = uniqueStrings(summarySentences.concat(sentences.slice(3, desiredPointCount + 3))).slice(0, 12);
  const fallbackPoints = keyPoints.length ? keyPoints : [shortSummary];
  const flashcardPoints = studyPointsForCount(fallbackPoints, options.flashcardCount);
  const quizPoints = studyPointsForCount(fallbackPoints, options.quizCount);
  const topicTags = uniqueStrings([...(document.topicTags ?? []), document.category, contentTopicFromText(text)].filter(Boolean) as string[]).slice(0, 6);
  return {
    summary: {
      short: truncate(shortSummary, 1000),
      medium: fallbackPoints.slice(0, 4).map((point) => truncate(point, 500)),
      detailed: truncate(summarySentences.join(" ") || shortSummary, 4000)
    },
    keyPoints: fallbackPoints.map((point) => truncate(point, 500)),
    topicTags: topicTags.length ? topicTags : ["Study"],
    flashcards: flashcardPoints.map((point, index) => fallbackFlashcardForPoint(document.title, point, index)),
    quiz: quizPoints.map((point, index) => fallbackQuizForPoint(document.title, point, index))
  };
}

function studyPointsForCount(points: string[], count: number): string[] {
  const source = points.length ? points : ["Review the saved document."];
  return Array.from({ length: count }, (_value, index) => source[index % source.length]);
}

function fallbackFlashcardForPoint(title: string, point: string, index: number): LearningPayload["flashcards"][number] {
  const topic = topicPhrase(point, title);
  return {
    question: fallbackQuestionForPoint(point, title, index, topic),
    answer: truncate(cleanStudyAnswer(point), 520)
  };
}

function fallbackQuizForPoint(title: string, point: string, index: number): LearningPayload["quiz"][number] {
  const topic = topicPhrase(point, title);
  const correctAnswer = truncate(cleanStudyAnswer(point), 320);
  return {
    type: "short_answer",
    question: fallbackQuestionForPoint(point, title, index, topic),
    correctAnswer,
    explanation: `A good answer should mention ${topic.toLowerCase()} and connect it to the document's point: ${truncate(point, 220)}`
  };
}

function fallbackQuestionForPoint(point: string, title: string, index: number, topic: string): string {
  const lower = point.toLowerCase();
  if (/\b(why|because|due to|therefore|as a result|so that)\b/.test(lower)) return `Why does ${topic} matter in this reading?`;
  if (/\b(risk|challenge|problem|concern|barrier|obstacle|threat)\b/.test(lower)) return `What risk or challenge is linked to ${topic}?`;
  if (/\b\d[\d,.%£$€-]*\b/.test(point)) return `What important figure or detail is given about ${topic}?`;
  if (/\b(should|must|recommend|recommended|need|needs|could|can)\b/.test(lower)) return `What action or implication does the reading connect to ${topic}?`;
  if (index === 0) return `What is the main takeaway from ${title} about ${topic}?`;
  return `What should you remember about ${topic}?`;
}

function cleanStudyAnswer(point: string): string {
  const cleaned = point
    .replace(/\s+/g, " ")
    .replace(/\bPublished\s+\d{1,2}\s+\w+\b/gi, "")
    .trim();
  return cleaned.endsWith(".") ? cleaned : `${cleaned}.`;
}

function topicPhrase(point: string, title: string): string {
  const withoutTitle = point.replace(new RegExp(escapeRegExp(title), "ig"), "").replace(/\s+/g, " ").trim();
  const tokens = withoutTitle
    .replace(/[“”"']/g, "")
    .split(/\s+/)
    .filter((token) => !/^(the|a|an|and|or|but|this|that|these|those|it|its|they|their|he|she|his|her|for|from|with|about|after|before|into|onto|over|under)$/i.test(token));
  const phrase = tokens.slice(0, 5).join(" ").replace(/[,:;.!?]+$/g, "").trim();
  return phrase || "the article's main point";
}

function fallbackAnswerForQuestion(document: ReadingDocumentResponse, question: string, relevantText: string): AskAnswer {
  const sentences = extractStudySentences(relevantText, document.title);
  const keywords = tokenize(question);
  const ranked = sentences
    .map((sentence, index) => ({ sentence, index, score: scoreSection(sentence, keywords) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = (ranked[0]?.score ?? 0) > 0 ? ranked.filter((item) => item.score > 0).slice(0, 3) : ranked.slice(0, 2);
  const answerText = selected.map((item) => item.sentence).join(" ");
  return {
    answer: truncate(answerText || "The saved document does not provide enough information to answer that question.", 4000),
    citedSections: selected.map((item) => truncate(item.sentence, 300)).slice(0, 6)
  };
}

function extractStudySentences(text: string, title: string): string[] {
  const normalizedTitle = normalizeStudyText(title);
  return uniqueStrings(
    text
      .split(/(?<=[.!?])\s+|\n+/)
      .map((sentence) => sentence.replace(/^[•*-]\s*/, "").replace(/\s+/g, " ").trim())
      .filter((sentence) => isUsefulStudySentence(sentence, normalizedTitle))
  );
}

function isUsefulStudySentence(sentence: string, normalizedTitle: string): boolean {
  const normalized = normalizeStudyText(sentence);
  if (sentence.length < 28) return false;
  if (normalized === normalizedTitle || normalized.includes(normalizedTitle)) return false;
  if (/^(follow|see all|posts from this topic|advertisement|sign up|newsletter)\b/i.test(sentence)) return false;
  if (/\b(posts from this topic|daily email digest|homepage feed|follow see all)\b/i.test(sentence)) return false;
  if (/^published\s+\d{1,2}\s+\w+/i.test(sentence)) return false;
  return true;
}

function normalizeStudyText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function contentTopicFromText(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(ai|agent|software|technology|google|gemini|a2ui|protocol|interface)\b/.test(lower)) return "Technology";
  if (/\b(finance|market|business|revenue|stock)\b/.test(lower)) return "Business";
  if (/\b(policy|government|court|law|election)\b/.test(lower)) return "Politics";
  if (/\b(health|medical|doctor|hospital)\b/.test(lower)) return "Health";
  return "Study";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength - 1).trimEnd() : value;
}

function relevantDocumentText(document: ReadingDocumentResponse, question: string): string {
  const keywords = tokenize(question);
  if (!keywords.length) return document.blocks.map((block) => block.text).join("\n\n");
  const sections = documentSections(document);
  const ranked = sections
    .map((section, index) => ({ ...section, index, score: scoreSection(section.text, keywords) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const maxScore = ranked[0]?.score ?? 0;
  const selected = maxScore > 1 ? ranked.filter((section) => section.score > 0).slice(0, 6) : ranked.slice(0, 6);
  return (selected.length ? selected : ranked.slice(0, 6))
    .sort((a, b) => a.index - b.index)
    .map((section) => section.text)
    .join("\n\n");
}

function documentSections(document: ReadingDocumentResponse): Array<{ text: string }> {
  const sections: Array<{ text: string }> = [];
  let current: string[] = [];
  for (const block of document.blocks) {
    if (block.blockType === "heading" && current.length) {
      sections.push({ text: current.join("\n\n") });
      current = [block.text];
      continue;
    }
    current.push(block.text);
  }
  if (current.length) sections.push({ text: current.join("\n\n") });
  return sections.length ? sections : [{ text: document.blocks.map((block) => block.text).join("\n\n") }];
}

function scoreSection(text: string, keywords: string[]): number {
  const haystack = text.toLowerCase();
  return keywords.reduce((score, keyword) => score + (haystack.includes(keyword) ? 1 : 0), 0);
}

function tokenize(text: string): string[] {
  const stop = new Set(["what", "is", "the", "a", "an", "and", "or", "to", "of", "in", "for", "between", "with", "from", "this", "that", "how"]);
  return Array.from(new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])).filter((word) => !stop.has(word));
}

export class PrismaLearningRepository implements LearningRepository {
  async syncGeneratedLearning(userId: string, documentId: string, learning: LearningPayload): Promise<void> {
    const prisma = await getPrisma();
    const now = new Date();
    const topicTag = learning.topicTags[0];
    await prisma.$transaction(async (tx) => {
      const existingCards = await tx.learningFlashcard.findMany({ where: { userId, documentId, deletedAt: null } });
      const existingCardKeys = new Set<string>();
      for (const card of learning.flashcards) {
        const existing = existingCards.find((item) => item.question === card.question);
        existingCardKeys.add(card.question);
        if (existing) {
          await tx.learningFlashcard.update({ where: { id: existing.id }, data: { answer: card.answer, topicTag } });
        } else {
          await tx.learningFlashcard.create({ data: { userId, documentId, question: card.question, answer: card.answer, topicTag } });
        }
      }
      await tx.learningFlashcard.updateMany({
        where: { userId, documentId, deletedAt: null, NOT: { question: { in: [...existingCardKeys] } } },
        data: { deletedAt: now }
      });

      const existingQuestions = await tx.learningQuizQuestion.findMany({ where: { userId, documentId, deletedAt: null } });
      const existingQuestionKeys = new Set<string>();
      for (const quiz of learning.quiz) {
        const existing = existingQuestions.find((item) => item.question === quiz.question);
        existingQuestionKeys.add(quiz.question);
        const data = {
          questionType: quiz.type,
          options: JSON.stringify(quiz.options ?? []),
          correctAnswer: quiz.correctAnswer,
          explanation: quiz.explanation,
          topicTag
        };
        if (existing) {
          await tx.learningQuizQuestion.update({ where: { id: existing.id }, data });
        } else {
          await tx.learningQuizQuestion.create({ data: { userId, documentId, question: quiz.question, ...data } });
        }
      }
      await tx.learningQuizQuestion.updateMany({
        where: { userId, documentId, deletedAt: null, NOT: { question: { in: [...existingQuestionKeys] } } },
        data: { deletedAt: now }
      });
    });
  }

  async getReview(userId: string, document: ReadingDocumentResponse): Promise<LearningReviewResponse> {
    const prisma = await getPrisma();
    await seedDocumentLearningRows(prisma, userId, document);
    // Every Prisma operation also opens a short RLS transaction. Keep these
    // reads sequential so one review request cannot exhaust the deliberately
    // small serverless connection pool and block uploads or settings sync.
    const flashcards = await prisma.learningFlashcard.findMany({ where: { userId, documentId: document.id, deletedAt: null }, orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }] });
    const quizQuestions = await prisma.learningQuizQuestion.findMany({ where: { userId, documentId: document.id, deletedAt: null }, orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }] });
    const quizAttempts = await prisma.learningQuizAttempt.findMany({ where: { userId, documentId: document.id }, orderBy: { createdAt: "desc" }, take: 20 });
    const notesCount = await prisma.note.count({ where: { userId, documentId: document.id, deletedAt: null } });
    const highlightsCount = await prisma.highlight.count({ where: { userId, documentId: document.id, deletedAt: null } });
    return buildLearningReview(document, flashcards, quizQuestions, quizAttempts, notesCount, highlightsCount);
  }

  async listReview(userId: string, documents: ReadingDocumentResponse[]): Promise<GlobalLearningReviewResponse> {
    const prisma = await getPrisma();
    const reviewDocuments = documents.filter(hasLearningData);
    if (reviewDocuments.length === 0) return emptyGlobalLearningReview();
    await seedDocumentsLearningRows(prisma, userId, reviewDocuments);
    const documentIds = reviewDocuments.map((document) => document.id);
    const flashcards = await prisma.learningFlashcard.findMany({
      where: { userId, documentId: { in: documentIds }, deletedAt: null },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });
    const quizQuestions = await prisma.learningQuizQuestion.findMany({
      where: { userId, documentId: { in: documentIds }, deletedAt: null },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });
    const quizAttempts = await prisma.$queryRaw<any[]>`
      SELECT ranked.*
      FROM (
        SELECT attempts.*, ROW_NUMBER() OVER (
          PARTITION BY attempts."documentId" ORDER BY attempts."createdAt" DESC
        ) AS review_row_number
        FROM "LearningQuizAttempt" attempts
        WHERE attempts."userId" = ${userId}
          AND attempts."documentId" IN (${Prisma.join(documentIds)})
      ) ranked
      WHERE ranked.review_row_number <= 20
    `;
    const noteCounts = await prisma.note.groupBy({
      by: ["documentId"],
      where: { userId, documentId: { in: documentIds }, deletedAt: null },
      _count: { _all: true }
    });
    const highlightCounts = await prisma.highlight.groupBy({
      by: ["documentId"],
      where: { userId, documentId: { in: documentIds }, deletedAt: null },
      _count: { _all: true }
    });
    const reviews = reviewDocuments.map((document) => buildLearningReview(
      document,
      flashcards.filter((card) => card.documentId === document.id),
      quizQuestions.filter((question) => question.documentId === document.id),
      quizAttempts.filter((attempt) => attempt.documentId === document.id),
      noteCounts.find((count) => count.documentId === document.id)?._count._all ?? 0,
      highlightCounts.find((count) => count.documentId === document.id)?._count._all ?? 0
    ));
    const attempts = reviews.flatMap((review) => review.quizAttempts);
    const documentById = new Map(documents.map((document) => [document.id, document]));
    return {
      documents: reviews.map((review) => {
        const document = documentById.get(review.documentId)!;
        return {
          documentId: document.id,
          title: document.title,
          sourceType: document.sourceType,
          sourceLabel: document.sourceLabel,
          topicTags: document.topicTags ?? [],
          progressPercent: document.progress.percent,
          needsReview: review.flashcards.filter((card) => card.reviewStatus === "needs_review" || card.reviewStatus === "new").length,
          quizAttempts: review.quizAttempts.length,
          bestQuizScore: review.progress.bestQuizScore,
          updatedAt: latestReviewUpdatedAt(document.updatedAt, review)
        };
      }),
      totals: {
        studied: reviews.length,
        notes: reviews.reduce((sum, review) => sum + review.progress.notesCount, 0),
        highlights: reviews.reduce((sum, review) => sum + review.progress.highlightsCount, 0),
        flashcards: reviews.reduce((sum, review) => sum + review.flashcards.length, 0),
        flashcardsReviewed: reviews.reduce((sum, review) => sum + review.progress.flashcardsReviewed, 0),
        quizAttempts: attempts.length,
        averageQuizScore: attempts.length ? Math.round(attempts.reduce((sum, attempt) => sum + attempt.score, 0) / attempts.length) : 0
      }
    };
  }

  async markFlashcardReview(
    userId: string,
    documentId: string,
    flashcardId: string,
    reviewStatus: (typeof reviewStatuses)[number]
  ): Promise<LearningFlashcardResponse | null> {
    const prisma = await getPrisma();
    const result = await prisma.learningFlashcard.updateMany({
      where: { id: flashcardId, userId, documentId, deletedAt: null },
      data: { reviewStatus }
    });
    if (!result.count) return null;
    const flashcard = await prisma.learningFlashcard.findUnique({ where: { id: flashcardId } });
    return flashcard ? serializeFlashcard(flashcard) : null;
  }

  async createQuizAttempt(userId: string, documentId: string, answers: Record<string, string>): Promise<LearningQuizAttemptResponse | null> {
    const prisma = await getPrisma();
    const questions = await prisma.learningQuizQuestion.findMany({ where: { userId, documentId, deletedAt: null }, orderBy: { createdAt: "asc" } });
    if (!questions.length) return null;
    const { results, correct, scoredTotal, score } = scoreQuizAnswers(questions, answers);
    const attempt = await prisma.learningQuizAttempt.create({
      data: {
        userId,
        documentId,
        answers: JSON.stringify(answers),
        score,
        total: questions.length,
        correct,
        results: JSON.stringify(results)
      }
    });
    return serializeQuizAttempt(attempt);
  }

  async clearLearningData(userId: string, documentId: string): Promise<boolean> {
    const prisma = await getPrisma();
    const existing = await prisma.readingDocument.findFirst({ where: { id: documentId, userId, deletedAt: null }, select: { id: true } });
    if (!existing) return false;
    await clearLearningDataForDocument(prisma, userId, documentId, { includeNotesAndHighlights: true });
    return true;
  }
}

function buildLearningReview(
  document: ReadingDocumentResponse,
  flashcards: any[],
  quizQuestions: any[],
  quizAttempts: any[],
  notesCount: number,
  highlightsCount: number
): LearningReviewResponse {
  const attempts = quizAttempts.map(serializeQuizAttempt);
  return {
    documentId: document.id,
    summary: document.summary,
    keyPoints: document.keyPoints ?? [],
    topicTags: document.topicTags ?? [],
    flashcards: flashcards.map(serializeFlashcard),
    quizQuestions: quizQuestions.map(serializeQuizQuestion),
    quizAttempts: attempts,
    progress: {
      notesCount,
      highlightsCount,
      flashcardsReviewed: flashcards.filter((card) => card.reviewStatus !== "new").length,
      quizAttempts: attempts.length,
      bestQuizScore: attempts.reduce<number | undefined>((best, attempt) => Math.max(best ?? 0, attempt.score), undefined)
    }
  };
}

function emptyGlobalLearningReview(): GlobalLearningReviewResponse {
  return {
    documents: [],
    totals: {
      studied: 0,
      notes: 0,
      highlights: 0,
      flashcards: 0,
      flashcardsReviewed: 0,
      quizAttempts: 0,
      averageQuizScore: 0
    }
  };
}

async function seedDocumentLearningRows(prisma: typeof PrismaSingleton, userId: string, document: ReadingDocumentResponse): Promise<void> {
  const cardCount = await prisma.learningFlashcard.count({ where: { userId, documentId: document.id, deletedAt: null } });
  const quizCount = await prisma.learningQuizQuestion.count({ where: { userId, documentId: document.id, deletedAt: null } });
  if (!cardCount && document.flashcards?.length) {
    await prisma.learningFlashcard.createMany({
      data: document.flashcards.map((card) => ({
        userId,
        documentId: document.id,
        question: card.front,
        answer: card.back,
        topicTag: document.topicTags?.[0]
      }))
    });
  }
  if (!quizCount && document.quizQuestions?.length) {
    await prisma.learningQuizQuestion.createMany({
      data: document.quizQuestions.map((quiz) => {
        const [correctAnswer = quiz.answer, explanation = ""] = quiz.answer.split(/\n\n/);
        return {
          userId,
          documentId: document.id,
          question: quiz.question,
          questionType: "short_answer",
          options: "[]",
          correctAnswer,
          explanation,
          topicTag: document.topicTags?.[0]
        };
      })
    });
  }
}

async function seedDocumentsLearningRows(
  prisma: typeof PrismaSingleton,
  userId: string,
  documents: ReadingDocumentResponse[]
): Promise<void> {
  const documentIds = documents.map((document) => document.id);
  const existingCards = await prisma.learningFlashcard.findMany({
    where: { userId, documentId: { in: documentIds }, deletedAt: null },
    distinct: ["documentId"],
    select: { documentId: true }
  });
  const existingQuestions = await prisma.learningQuizQuestion.findMany({
    where: { userId, documentId: { in: documentIds }, deletedAt: null },
    distinct: ["documentId"],
    select: { documentId: true }
  });
  const cardDocumentIds = new Set(existingCards.map((row) => row.documentId));
  const questionDocumentIds = new Set(existingQuestions.map((row) => row.documentId));
  const cards = documents.flatMap((document) => cardDocumentIds.has(document.id)
    ? []
    : (document.flashcards ?? []).map((card) => ({
        userId,
        documentId: document.id,
        question: card.front,
        answer: card.back,
        topicTag: document.topicTags?.[0]
      })));
  const questions = documents.flatMap((document) => questionDocumentIds.has(document.id)
    ? []
    : (document.quizQuestions ?? []).map((quiz) => {
        const [correctAnswer = quiz.answer, explanation = ""] = quiz.answer.split(/\n\n/);
        return {
          userId,
          documentId: document.id,
          question: quiz.question,
          questionType: "short_answer",
          options: "[]",
          correctAnswer,
          explanation,
          topicTag: document.topicTags?.[0]
        };
      }));
  if (cards.length) await prisma.learningFlashcard.createMany({ data: cards });
  if (questions.length) await prisma.learningQuizQuestion.createMany({ data: questions });
}

function hasLearningData(document: ReadingDocumentResponse): boolean {
  return Boolean(document.summary || document.keyPoints?.length || document.flashcards?.length || document.quizQuestions?.length);
}

function studyUiForReview(document: ReadingDocumentResponse, review: LearningReviewResponse): StudyUi {
  return {
    documentId: document.id,
    components: [
      {
        id: "review-progress",
        type: "ReviewProgressCard",
        props: {
          title: document.title,
          progressPercent: document.progress.percent,
          notesCount: review.progress.notesCount,
          highlightsCount: review.progress.highlightsCount,
          flashcardsReviewed: review.progress.flashcardsReviewed,
          quizAttempts: review.progress.quizAttempts,
          bestQuizScore: review.progress.bestQuizScore
        }
      },
      ...(document.summary
        ? [
            {
              id: "summary",
              type: "SummaryCard" as const,
              props: { summary: document.summary, topicTags: review.topicTags }
            }
          ]
        : []),
      ...(review.keyPoints.length
        ? [
            {
              id: "key-points",
              type: "KeyPointsList" as const,
              props: { points: review.keyPoints }
            }
          ]
        : []),
      ...(review.flashcards.length
        ? [
            {
              id: "flashcards",
              type: "FlashcardDeck" as const,
              props: {
                cards: review.flashcards.map((card) => ({
                  id: card.id,
                  question: card.question,
                  answer: card.answer,
                  reviewStatus: card.reviewStatus
                }))
              }
            }
          ]
        : []),
      ...review.quizQuestions.map((question, index) => ({
        id: `quiz-${question.id}`,
        type: "QuizQuestionCard" as const,
        props: {
          index,
          questionId: question.id,
          question: question.question,
          questionType: question.questionType,
          options: question.options,
          explanation: question.explanation
        }
      })),
      {
        id: "note-input",
        type: "NoteInput",
        props: { documentId: document.id }
      },
      {
        id: "ask-ai",
        type: "ActionButton",
        props: { action: "ask-ai", label: "Ask AI" }
      }
    ]
  };
}

function latestReviewUpdatedAt(documentUpdatedAt: string, review: LearningReviewResponse): string {
  return [
    documentUpdatedAt,
    ...review.flashcards.map((card) => card.updatedAt),
    ...review.quizQuestions.map((question) => question.updatedAt),
    ...review.quizAttempts.map((attempt) => attempt.createdAt)
  ].reduce((latest, value) => {
    const latestTime = Date.parse(latest);
    const valueTime = Date.parse(value);
    return Number.isFinite(valueTime) && valueTime > latestTime ? value : latest;
  }, documentUpdatedAt);
}

async function getPrisma(): Promise<typeof PrismaSingleton> {
  const module = await import("../prisma.js");
  return module.prisma;
}

function serializeFlashcard(card: any): LearningFlashcardResponse {
  return {
    id: card.id,
    documentId: card.documentId,
    question: card.question,
    answer: card.answer,
    topicTag: card.topicTag ?? undefined,
    difficulty: card.difficulty,
    reviewStatus: card.reviewStatus,
    createdAt: toIso(card.createdAt),
    updatedAt: toIso(card.updatedAt)
  };
}

function serializeQuizQuestion(question: any): LearningQuizQuestionResponse {
  return {
    id: question.id,
    documentId: question.documentId,
    question: question.question,
    questionType: question.questionType,
    options: parseStringArray(question.options),
    correctAnswer: question.correctAnswer,
    explanation: question.explanation,
    topicTag: question.topicTag ?? undefined,
    createdAt: toIso(question.createdAt),
    updatedAt: toIso(question.updatedAt)
  };
}

function serializeQuizAttempt(attempt: any): LearningQuizAttemptResponse {
  const results = parseResults(attempt.results);
  return {
    id: attempt.id,
    documentId: attempt.documentId,
    answers: parseRecord(attempt.answers),
    score: attempt.score,
    total: attempt.total,
    scoredTotal: results.filter((result) => result.isScored).length,
    correct: attempt.correct ?? 0,
    createdAt: toIso(attempt.createdAt),
    results
  };
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseRecord(value: unknown): Record<string, string> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

function parseResults(value: unknown): LearningQuizAttemptResponse["results"] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((result) => result && typeof result === "object")
      .map((result) => ({
        questionId: typeof result.questionId === "string" ? result.questionId : "",
        question: typeof result.question === "string" ? result.question : "",
        userAnswer: typeof result.userAnswer === "string" ? result.userAnswer : "",
        correctAnswer: typeof result.correctAnswer === "string" ? result.correctAnswer : "",
        explanation: typeof result.explanation === "string" ? result.explanation : "",
        isCorrect: result.isCorrect === true,
        // Attempts created before written-answer review support were all scored.
        isScored: typeof result.isScored === "boolean" ? result.isScored : true
      }));
  } catch {
    return [];
  }
}

export function scoreQuizAnswers(
  questions: Array<Pick<LearningQuizQuestionResponse, "id" | "question" | "questionType" | "correctAnswer" | "explanation">>,
  answers: Record<string, string>
): Pick<LearningQuizAttemptResponse, "results" | "correct" | "scoredTotal" | "score"> {
  const results = questions.map((question) => {
    const userAnswer = answers[question.id] ?? "";
    const isScored = question.questionType !== "short_answer";
    const isCorrect = isScored && normalizeAnswer(userAnswer) === normalizeAnswer(question.correctAnswer);
    return {
      questionId: question.id,
      question: question.question,
      userAnswer,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      isCorrect,
      isScored
    };
  });
  const scoredTotal = results.filter((result) => result.isScored).length;
  const correct = results.filter((result) => result.isScored && result.isCorrect).length;
  return {
    results,
    correct,
    scoredTotal,
    score: scoredTotal ? Math.round((correct / scoredTotal) * 100) : 0
  };
}

function normalizeAnswer(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
