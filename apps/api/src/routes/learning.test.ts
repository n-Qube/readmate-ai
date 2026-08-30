import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthedRequest } from "../auth.js";
import type { LearningGenerator } from "../learning/gemini.js";
import { WebMcpActionIdempotencyError } from "../webmcp/actionIdempotency.js";
import { AccountDeletionFencedError } from "../webmcp/accountDeletionFence.js";
import {
  PrismaWebMcpAuditRepository,
  WEBMCP_ACTION_CLAIM_LEASE_MS,
  type AuditEventDelegate,
  type PersistedAuditEvent,
  type WebMcpActionIdempotencyRepository
} from "../webmcp/auditRepository.js";
import {
  PrismaStudyPackEffectRepository,
  type PersistedStudyPackEffect,
  type StudyPackEffectDelegate,
  type StudyPackEffectRepository
} from "../webmcp/studyPackIdempotency.js";
import type { DocumentRepository, ReadingDocumentResponse } from "./documents.js";
import { learningRouter, scoreQuizAnswers, type LearningRepository, type LearningReviewResponse } from "./learning.js";

const originalEnv = { ...process.env };

type TestAppOptions = Pick<
  NonNullable<Parameters<typeof learningRouter>[0]>,
  "consumeUsage" | "webMcpActionRepository" | "webMcpDigestKey" | "studyPackEffectRepository" | "accountDeletionGuard"
>;

function createTestApp(
  repository: DocumentRepository,
  generator: LearningGenerator,
  learningRepository = createMemoryLearningRepository(),
  options: TestAppOptions = {}
) {
  const app = express();
  app.use(express.json());
  app.use((req: AuthedRequest, _res, next) => {
    req.userId = String(req.header("x-test-user") ?? "owner");
    next();
  });
  app.use("/api/learning", learningRouter({
    documentRepository: repository,
    generator,
    learningRepository,
    consumeUsage: options.consumeUsage ?? (async () => 0),
    webMcpActionRepository: options.webMcpActionRepository,
    webMcpDigestKey: options.webMcpDigestKey,
    studyPackEffectRepository:
      options.studyPackEffectRepository ??
      (options.webMcpActionRepository ? createMemoryStudyPackEffectRepository() : undefined),
    accountDeletionGuard: options.accountDeletionGuard ?? (async () => undefined)
  }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof WebMcpActionIdempotencyError) {
      if (error.retryAfterSeconds !== undefined) {
        res.setHeader("Retry-After", String(error.retryAfterSeconds));
      }
      res.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof AccountDeletionFencedError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : "Unexpected error" });
  });
  return app;
}

function createMemoryWebMcpActionRepository(options: {
  now?: () => Date;
  claimTokenFactory?: () => string;
} = {}): WebMcpActionIdempotencyRepository {
  const rows = new Map<string, PersistedAuditEvent>();
  const now = options.now ?? (() => new Date());
  const uniqueKey = (userId: string, requestId: string | null, toolName: string) => `${userId}:${requestId ?? ""}:${toolName}`;
  const delegate: AuditEventDelegate = {
    async findUnique({ where }) {
      const value = where.userId_requestId_toolName;
      return rows.get(uniqueKey(value.userId, value.requestId, value.toolName)) ?? null;
    },
    async create({ data }) {
      const key = uniqueKey(data.userId, data.requestId, data.toolName);
      if (data.requestId && rows.has(key)) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
      const row: PersistedAuditEvent = {
        id: `audit_${rows.size + 1}`,
        ...data,
        createdAt: now(),
        updatedAt: now()
      };
      rows.set(key, row);
      return row;
    },
    async update({ where, data }) {
      const entry = [...rows.entries()].find(([, row]) => row.id === where.id);
      if (!entry) throw new Error("Audit event not found.");
      const [key, row] = entry;
      const updated = { ...row, ...data, updatedAt: now() };
      rows.set(key, updated);
      return updated;
    },
    async updateMany({ where, data }) {
      const entry = [...rows.entries()].find(([, row]) => row.id === where.id);
      if (!entry) return { count: 0 };
      const [key, row] = entry;
      if (where.status !== undefined && row.status !== where.status) return { count: 0 };
      if (where.actionDigest !== undefined && row.actionDigest !== where.actionDigest) return { count: 0 };
      if (where.claimToken !== undefined && row.claimToken !== where.claimToken) return { count: 0 };
      if (
        where.updatedAt !== undefined &&
        new Date(row.updatedAt).getTime() !== new Date(where.updatedAt).getTime()
      ) return { count: 0 };
      rows.set(key, { ...row, ...data, updatedAt: data.updatedAt ?? now() });
      return { count: 1 };
    }
  };
  return new PrismaWebMcpAuditRepository(delegate, now, options.claimTokenFactory);
}

function createMemoryStudyPackEffectRepository(): StudyPackEffectRepository {
  const rows = new Map<string, PersistedStudyPackEffect>();
  const delegate: StudyPackEffectDelegate = {
    async findUnique({ where }) {
      const value = where.userId_requestId;
      return rows.get(`${value.userId}:${value.requestId}`) ?? null;
    },
    async create({ data }) {
      const key = `${data.userId}:${data.requestId}`;
      if (rows.has(key)) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
      const row: PersistedStudyPackEffect = {
        id: `effect_${rows.size + 1}`,
        ...data,
        createdAt: "2026-08-29T12:00:00.000Z",
        updatedAt: "2026-08-29T12:00:00.000Z"
      };
      rows.set(key, row);
      return row;
    },
    async updateMany({ where, data }) {
      const entry = [...rows.entries()].find(([, row]) =>
        row.id === where.id &&
        row.status === where.status &&
        row.actionDigest === where.actionDigest &&
        row.documentId === where.documentId
      );
      if (!entry) return { count: 0 };
      const [key, row] = entry;
      rows.set(key, { ...row, ...data, updatedAt: "2026-08-29T12:01:00.000Z" });
      return { count: 1 };
    }
  };
  return new PrismaStudyPackEffectRepository(delegate);
}

function createMemoryDocumentRepository(): DocumentRepository {
  const documents = new Map<string, ReadingDocumentResponse>();
  const now = "2026-05-27T12:00:00.000Z";
  documents.set("doc_1", {
    id: "doc_1",
    userId: "owner",
    title: "Learning article",
    sourceType: "webpage",
    category: "Technology",
    status: "unread",
    createdAt: now,
    updatedAt: now,
    progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 },
    provider: "google",
    voice: "en-US-Neural2-F",
    speed: 1,
    summary: "Library keeps saved items separate from recent listening history.",
    keyPoints: ["Saved items stay in Library"],
    flashcards: [{ front: "Stored card?", back: "Stored answer." }],
    quizQuestions: [{ question: "Stored quiz?", answer: "Stored answer.\n\nStored explanation." }],
    topicTags: ["AI", "Learning"],
    blocks: [
      { id: "block_1", orderIndex: 0, blockType: "heading", text: "Learning article" },
      { id: "block_2", orderIndex: 1, blockType: "paragraph", text: "Gemini creates summaries, flashcards, and quizzes from saved reading material." },
      { id: "block_3", orderIndex: 2, blockType: "heading", text: "Cooking notes" },
      { id: "block_4", orderIndex: 3, blockType: "paragraph", text: "This unrelated section discusses boiling pasta and chopping vegetables." },
      { id: "block_5", orderIndex: 4, blockType: "heading", text: "Library versus history" },
      { id: "block_6", orderIndex: 5, blockType: "paragraph", text: "Library stores saved items the user wants to keep. History tracks what the user recently read or listened to and can be cleared without deleting saved content." }
    ]
  });

  return {
    async createDocument() {
      throw new Error("not used");
    },
    async listDocuments(userId) {
      return [...documents.values()].filter((document) => document.userId === userId);
    },
    async getDocument(userId, documentId) {
      const document = documents.get(documentId);
      return document?.userId === userId ? document : null;
    },
    async updateProgress() {
      return null;
    },
    async updateDocument(userId, documentId, input) {
      const document = documents.get(documentId);
      if (!document || document.userId !== userId) return null;
      const updated: ReadingDocumentResponse = {
        ...document,
        title: input.title ?? document.title,
        sourceUrl: input.sourceUrl === null ? undefined : input.sourceUrl ?? document.sourceUrl,
        canonicalUrl: input.canonicalUrl === null ? undefined : input.canonicalUrl ?? document.canonicalUrl,
        rssFeedUrl: input.rssFeedUrl === null ? undefined : input.rssFeedUrl ?? document.rssFeedUrl,
        category: input.category ?? document.category,
        sourceLabel: input.sourceLabel ?? document.sourceLabel,
        thumbnailUrl: input.thumbnailUrl === null ? undefined : input.thumbnailUrl ?? document.thumbnailUrl,
        coverImageUrl: input.coverImageUrl === null ? undefined : input.coverImageUrl ?? document.coverImageUrl,
        author: input.author === null ? undefined : input.author ?? document.author,
        description: input.description === null ? undefined : input.description ?? document.description,
        contentHtml: input.contentHtml === null ? undefined : input.contentHtml ?? document.contentHtml,
        pageCount: input.pageCount === null ? undefined : input.pageCount ?? document.pageCount,
        status: input.status ?? document.status,
        summary: input.summary === null ? undefined : input.summary ?? document.summary,
        keyPoints: input.keyPoints ?? document.keyPoints,
        quizQuestions: input.quizQuestions ?? document.quizQuestions,
        flashcards: input.flashcards ?? document.flashcards,
        topicTags: input.topicTags ?? document.topicTags,
        updatedAt: "2026-05-27T12:01:00.000Z"
      };
      documents.set(documentId, updated);
      return updated;
    },
    async clearDocumentHistory() {
      return null;
    },
    async clearHistory() {
      return 0;
    },
    async deleteDocument() {
      return false;
    },
    async deleteCompletedDocuments() {
      return 0;
    }
  };
}

function createMemoryLearningRepository(): LearningRepository {
  const flashcards = new Map<string, LearningReviewResponse["flashcards"][number]>([
    [
      "flash_1",
      {
        id: "flash_1",
        documentId: "doc_1",
        question: "What does Library store?",
        answer: "Saved items the user wants to keep.",
        topicTag: "Product",
        difficulty: "medium",
        reviewStatus: "new" as const,
        createdAt: "2026-05-27T12:00:00.000Z",
        updatedAt: "2026-05-27T12:00:00.000Z"
      }
    ]
  ]);
  const quizQuestions = new Map([
    [
      "quiz_1",
      {
        id: "quiz_1",
        documentId: "doc_1",
        question: "What happens when history is cleared?",
        questionType: "multiple_choice",
        options: ["The item is deleted", "The history entry is removed", "The account is removed"],
        correctAnswer: "The history entry is removed",
        explanation: "History can be cleared without deleting saved library content.",
        topicTag: "Product",
        createdAt: "2026-05-27T12:00:00.000Z",
        updatedAt: "2026-05-27T12:00:00.000Z"
      }
    ]
  ]);
  const attempts: LearningReviewResponse["quizAttempts"] = [];

  return {
    async syncGeneratedLearning(userId, documentId, learning) {
      learning.flashcards.forEach((card, index) => {
        flashcards.set(`generated_flash_${index}`, {
          id: `generated_flash_${index}`,
          documentId,
          question: card.question,
          answer: card.answer,
          topicTag: learning.topicTags[0],
          difficulty: "medium",
          reviewStatus: "new",
          createdAt: "2026-05-27T12:02:00.000Z",
          updatedAt: "2026-05-27T12:02:00.000Z"
        });
      });
      learning.quiz.forEach((quiz, index) => {
        quizQuestions.set(`generated_quiz_${index}`, {
          id: `generated_quiz_${index}`,
          documentId,
          question: quiz.question,
          questionType: quiz.type,
          options: quiz.options ?? [],
          correctAnswer: quiz.correctAnswer,
          explanation: quiz.explanation,
          topicTag: learning.topicTags[0],
          createdAt: "2026-05-27T12:02:00.000Z",
          updatedAt: "2026-05-27T12:02:00.000Z"
        });
      });
      void userId;
    },
    async getReview(_userId, document) {
      return {
        documentId: document.id,
        summary: document.summary,
        keyPoints: document.keyPoints ?? [],
        topicTags: document.topicTags ?? [],
        flashcards: [...flashcards.values()].filter((card) => card.documentId === document.id),
        quizQuestions: [...quizQuestions.values()].filter((quiz) => quiz.documentId === document.id),
        quizAttempts: attempts.filter((attempt) => attempt.documentId === document.id),
        progress: {
          notesCount: 2,
          highlightsCount: 1,
          flashcardsReviewed: [...flashcards.values()].filter((card) => card.documentId === document.id && card.reviewStatus !== "new").length,
          quizAttempts: attempts.filter((attempt) => attempt.documentId === document.id).length,
          bestQuizScore: attempts.filter((attempt) => attempt.documentId === document.id).reduce<number | undefined>((best, attempt) => Math.max(best ?? 0, attempt.score), undefined)
        }
      };
    },
    async listReview() {
      return {
        documents: [],
        totals: {
          studied: 1,
          notes: 2,
          highlights: 1,
          flashcards: flashcards.size,
          flashcardsReviewed: [...flashcards.values()].filter((card) => card.reviewStatus !== "new").length,
          quizAttempts: attempts.length,
          averageQuizScore: attempts.length ? Math.round(attempts.reduce((sum, attempt) => sum + attempt.score, 0) / attempts.length) : 0
        }
      };
    },
    async markFlashcardReview(_userId, _documentId, flashcardId, reviewStatus) {
      const flashcard = flashcards.get(flashcardId);
      if (!flashcard) return null;
      const updated = { ...flashcard, reviewStatus, updatedAt: "2026-05-27T12:03:00.000Z" };
      flashcards.set(flashcardId, updated);
      return updated;
    },
    async createQuizAttempt(_userId, documentId, answers) {
      const questions = [...quizQuestions.values()].filter((quiz) => quiz.documentId === documentId);
      if (!questions.length) return null;
      const scoring = scoreQuizAnswers(questions, answers);
      const attempt = {
        id: `attempt_${attempts.length + 1}`,
        documentId,
        answers,
        score: scoring.score,
        total: questions.length,
        scoredTotal: scoring.scoredTotal,
        correct: scoring.correct,
        createdAt: "2026-05-27T12:04:00.000Z",
        results: scoring.results
      };
      attempts.push(attempt);
      return attempt;
    },
    async clearLearningData(_userId, documentId) {
      let removed = false;
      for (const [id, card] of flashcards) {
        if (card.documentId === documentId) {
          flashcards.delete(id);
          removed = true;
        }
      }
      for (const [id, quiz] of quizQuestions) {
        if (quiz.documentId === documentId) {
          quizQuestions.delete(id);
          removed = true;
        }
      }
      for (let index = attempts.length - 1; index >= 0; index -= 1) {
        if (attempts[index]?.documentId === documentId) {
          attempts.splice(index, 1);
          removed = true;
        }
      }
      return removed;
    }
  };
}

function createFakeGenerator(): LearningGenerator {
  return {
    generateLearning: vi.fn(async () => ({
      summary: {
        short: "Short summary",
        medium: ["Point one", "Point two"],
        detailed: "Detailed learning summary"
      },
      keyPoints: ["Gemini creates learning material"],
      topicTags: ["AI", "Learning"],
      flashcards: [{ question: "What does Gemini create?", answer: "Study material." }],
      quiz: [
        {
          type: "multiple_choice" as const,
          question: "What is generated?",
          options: ["Invoices", "Study material", "Routes"],
          correctAnswer: "Study material",
          explanation: "The document says Gemini creates study material."
        }
      ]
    })),
    answerQuestion: vi.fn(async () => ({
      answer: "Gemini creates summaries, flashcards, and quizzes.",
      citedSections: ["Gemini creates summaries, flashcards, and quizzes from saved reading material."]
    }))
  };
}

function createHighDemandGenerator(): LearningGenerator {
  return {
    generateLearning: vi.fn(async () => {
      throw new Error("This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.");
    }),
    answerQuestion: vi.fn(async () => {
      throw new Error("This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.");
    })
  };
}

describe("learningRouter", () => {
  let repository: DocumentRepository;
  let generator: LearningGenerator;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    repository = createMemoryDocumentRepository();
    generator = createFakeGenerator();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it("generates summary learning data and stores it on the document", async () => {
    const learningRepository = createMemoryLearningRepository();
    const app = createTestApp(repository, generator, learningRepository);

    const response = await request(app).post("/api/learning/doc_1/summary").set("x-test-user", "owner").expect(200);

    expect(response.body.learning.summary.detailed).toBe("Detailed learning summary");
    expect(response.body.document).toMatchObject({
      summary: "Detailed learning summary",
      keyPoints: ["Gemini creates learning material"],
      topicTags: ["AI", "Learning"],
      flashcards: [{ front: "What does Gemini create?", back: "Study material." }],
      quizQuestions: [{ question: "What is generated?", answer: expect.stringContaining("Study material") }]
    });
    expect(generator.generateLearning).toHaveBeenCalledWith({
      title: "Learning article",
      text: expect.stringContaining("Gemini creates summaries"),
      flashcardCount: 6,
      quizCount: 4
    });
    const review = await learningRepository.getReview("owner", response.body.document);
    expect(review.flashcards).toEqual(
      expect.arrayContaining([expect.objectContaining({ question: "What does Gemini create?", reviewStatus: "new" })])
    );
  });

  it("passes requested study depth to the learning generator", async () => {
    const app = createTestApp(repository, generator);

    const response = await request(app)
      .post("/api/learning/doc_1/summary")
      .set("x-test-user", "owner")
      .send({ flashcardCount: 14, quizCount: 9 })
      .expect(200);

    expect(response.body.requested).toEqual({ flashcardCount: 14, quizCount: 9, targetLanguage: "en" });
    expect(generator.generateLearning).toHaveBeenCalledWith({
      title: "Learning article",
      text: expect.stringContaining("Gemini creates summaries"),
      flashcardCount: 14,
      quizCount: 9
    });
  });

  it("replays a confirmed WebMCP study pack without charging or generating twice and rejects changed input", async () => {
    const consumeUsage = vi.fn(async () => 0);
    const app = createTestApp(repository, generator, createMemoryLearningRepository(), {
      consumeUsage,
      webMcpActionRepository: createMemoryWebMcpActionRepository(),
      webMcpDigestKey: "test-webmcp-study-digest-key-that-is-long-enough"
    });
    const requestId = "study-request-001";
    const input = { targetLanguage: "en", flashcardCount: 8, quizCount: 5 };

    const first = await request(app)
      .post("/api/learning/doc_1/summary")
      .set("x-test-user", "owner")
      .set("X-ReadMate-Request-Id", requestId)
      .send(input)
      .expect(200);
    const replay = await request(app)
      .post("/api/learning/doc_1/summary")
      .set("x-test-user", "owner")
      .set("X-ReadMate-Request-Id", requestId)
      .send(input)
      .expect(200);

    expect(first.body.document.id).toBe("doc_1");
    expect(replay.headers["x-readmate-idempotent-replay"]).toBe("true");
    expect(replay.body).toMatchObject({
      replayed: true,
      document: { id: "doc_1", summary: "Detailed learning summary" },
      requested: input
    });
    expect(generator.generateLearning).toHaveBeenCalledTimes(1);
    expect(consumeUsage).toHaveBeenCalledTimes(1);

    const conflict = await request(app)
      .post("/api/learning/doc_1/summary")
      .set("x-test-user", "owner")
      .set("X-ReadMate-Request-Id", requestId)
      .send({ ...input, quizCount: 6 })
      .expect(409);

    expect(conflict.body).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(generator.generateLearning).toHaveBeenCalledTimes(1);
    expect(consumeUsage).toHaveBeenCalledTimes(1);
  });

  it("does not persist generated study data when deletion is fenced during generation", async () => {
    const consumeUsage = vi.fn(async () => 1);
    const updateDocument = vi.spyOn(repository, "updateDocument");
    const learningRepository = createMemoryLearningRepository();
    const syncGeneratedLearning = vi.spyOn(learningRepository, "syncGeneratedLearning");
    let guardCalls = 0;
    const app = createTestApp(repository, generator, learningRepository, {
      consumeUsage,
      webMcpActionRepository: createMemoryWebMcpActionRepository(),
      webMcpDigestKey: "test-webmcp-study-digest-key-that-is-long-enough",
      accountDeletionGuard: async () => {
        guardCalls += 1;
        if (guardCalls >= 2) throw new AccountDeletionFencedError();
      }
    });

    const response = await request(app)
      .post("/api/learning/doc_1/summary")
      .set("x-test-user", "owner")
      .set("X-ReadMate-Request-Id", "study-delete-race-001")
      .send({ targetLanguage: "en", flashcardCount: 8, quizCount: 5 })
      .expect(409);

    expect(response.body.code).toBe("ACCOUNT_DELETION_IN_PROGRESS");
    expect(generator.generateLearning).toHaveBeenCalledTimes(1);
    expect(consumeUsage).toHaveBeenCalledTimes(1);
    expect(updateDocument).not.toHaveBeenCalled();
    expect(syncGeneratedLearning).not.toHaveBeenCalled();
  });

  it("does not double-charge, regenerate, or persist study resources after a stale audit claim is reclaimed", async () => {
    let currentTime = new Date("2026-08-29T12:00:00.000Z");
    let tokenSequence = 0;
    const auditRepository = createMemoryWebMcpActionRepository({
      now: () => new Date(currentTime),
      claimTokenFactory: () => (++tokenSequence).toString(16).padStart(64, "0")
    });
    const effectRepository = createMemoryStudyPackEffectRepository();
    const consumeUsage = vi.fn(async () => 1);
    const documentRepository = createMemoryDocumentRepository();
    const updateDocument = vi.spyOn(documentRepository, "updateDocument");
    const learningRepository = createMemoryLearningRepository();
    const syncGeneratedLearning = vi.spyOn(learningRepository, "syncGeneratedLearning");
    const baseGenerator = createFakeGenerator();
    let signalGenerationStarted!: () => void;
    let releaseGeneration!: () => void;
    const generationStarted = new Promise<void>((resolve) => {
      signalGenerationStarted = resolve;
    });
    const generationGate = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const delayedGenerator: LearningGenerator = {
      generateLearning: vi.fn(async (input) => {
        signalGenerationStarted();
        await generationGate;
        return baseGenerator.generateLearning(input);
      }),
      answerQuestion: baseGenerator.answerQuestion
    };
    const app = createTestApp(documentRepository, delayedGenerator, learningRepository, {
      consumeUsage,
      webMcpActionRepository: auditRepository,
      webMcpDigestKey: "test-webmcp-study-digest-key-that-is-long-enough",
      studyPackEffectRepository: effectRepository
    });
    const headers = {
      "x-test-user": "owner",
      "x-readmate-request-id": "study-stale-request-001"
    };
    const body = { targetLanguage: "en", flashcardCount: 8, quizCount: 5 };

    const originalResponse = request(app)
      .post("/api/learning/doc_1/summary")
      .set(headers)
      .send(body)
      .then((response) => response);
    await generationStarted;

    currentTime = new Date(currentTime.getTime() + WEBMCP_ACTION_CLAIM_LEASE_MS);
    const reclaimed = await request(app)
      .post("/api/learning/doc_1/summary")
      .set(headers)
      .send(body)
      .expect(409);

    expect(reclaimed.body).toMatchObject({ code: "IDEMPOTENCY_IN_PROGRESS" });
    expect(delayedGenerator.generateLearning).toHaveBeenCalledTimes(1);
    expect(consumeUsage).toHaveBeenCalledTimes(1);
    expect(updateDocument).not.toHaveBeenCalled();

    releaseGeneration();
    const staleExecutor = await originalResponse;
    expect(staleExecutor.status).toBe(409);
    expect(staleExecutor.body).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(delayedGenerator.generateLearning).toHaveBeenCalledTimes(1);
    expect(consumeUsage).toHaveBeenCalledTimes(1);
    expect(updateDocument).toHaveBeenCalledTimes(1);
    expect(syncGeneratedLearning).toHaveBeenCalledTimes(1);

    currentTime = new Date(currentTime.getTime() + WEBMCP_ACTION_CLAIM_LEASE_MS);
    const recovered = await request(app)
      .post("/api/learning/doc_1/summary")
      .set(headers)
      .send(body)
      .expect(200);

    expect(recovered.headers["x-readmate-idempotent-replay"]).toBe("true");
    expect(recovered.body).toMatchObject({
      replayed: true,
      document: { id: "doc_1", summary: "Detailed learning summary" }
    });
    expect(delayedGenerator.generateLearning).toHaveBeenCalledTimes(1);
    expect(consumeUsage).toHaveBeenCalledTimes(1);
    expect(updateDocument).toHaveBeenCalledTimes(1);
    expect(syncGeneratedLearning).toHaveBeenCalledTimes(1);
  });

  it("translates generated study material through Google Translate for supported local languages", async () => {
    process.env.GOOGLE_TRANSLATE_API_KEY = "test-google-translate-key";
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { q: string; target: string };
      return new Response(JSON.stringify({ data: { translations: [{ translatedText: `${body.q} [en-${body.target}]` }] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const learningRepository = createMemoryLearningRepository();
    const app = createTestApp(repository, generator, learningRepository);

    const response = await request(app)
      .post("/api/learning/doc_1/summary")
      .set("x-test-user", "owner")
      .send({ targetLanguage: "tw" })
      .expect(200);

    expect(response.body.requested).toEqual({ flashcardCount: 6, quizCount: 4, targetLanguage: "tw" });
    expect(response.body.document).toMatchObject({
      summary: "Detailed learning summary [en-ak]",
      keyPoints: ["Gemini creates learning material [en-ak]"],
      topicTags: ["AI [en-ak]", "Learning [en-ak]"],
      flashcards: [{ front: "What does Gemini create? [en-ak]", back: "Study material. [en-ak]" }],
      quizQuestions: [{ question: "What is generated? [en-ak]", answer: expect.stringContaining("[en-ak]") }]
    });
    expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url) === "https://translation.googleapis.com/language/translate/v2?key=test-google-translate-key" &&
      init?.method === "POST" &&
      init.body === JSON.stringify({ q: "Detailed learning summary", source: "en", target: "ak", format: "text" })
    )).toBe(true);
    const review = await learningRepository.getReview("owner", response.body.document);
    expect(review.flashcards).toEqual(
      expect.arrayContaining([expect.objectContaining({ question: "What does Gemini create? [en-ak]" })])
    );
  });

  it("falls back to extractive study material when Gemini is temporarily overloaded", async () => {
    const learningRepository = createMemoryLearningRepository();
    const app = createTestApp(repository, createHighDemandGenerator(), learningRepository);

    const response = await request(app).post("/api/learning/doc_1/summary").set("x-test-user", "owner").expect(200);

    expect(response.body.fallback).toBe(true);
    expect(response.body.document).toMatchObject({
      summary: expect.stringContaining("Gemini creates summaries"),
      keyPoints: expect.arrayContaining([expect.stringContaining("Library stores saved items")]),
      topicTags: expect.arrayContaining(["Technology"])
    });
    const review = await learningRepository.getReview("owner", response.body.document);
    expect(review.flashcards).toEqual(
      expect.arrayContaining([expect.objectContaining({ question: expect.stringContaining("Learning article"), reviewStatus: "new" })])
    );
  });

  it("falls back to extractive study material for non-transient Gemini failures", async () => {
    const brokenGenerator: LearningGenerator = {
      ...generator,
      generateLearning: vi.fn(async () => {
        throw new Error("Gemini credentials are not configured correctly.");
      })
    };
    const app = createTestApp(repository, brokenGenerator);

    const response = await request(app).post("/api/learning/doc_1/summary").set("x-test-user", "owner").expect(200);

    expect(response.body.fallback).toBe(true);
    expect(response.body.document.summary).toContain("Gemini creates summaries");
  });

  it("returns fallback Study material when Gemini raises a TimeoutError", async () => {
    const timeoutGenerator: LearningGenerator = {
      ...generator,
      generateLearning: vi.fn(async () => {
        throw Object.assign(new Error("The operation was aborted."), { name: "TimeoutError" });
      })
    };
    const app = createTestApp(repository, timeoutGenerator);

    const response = await request(app)
      .post("/api/learning/doc_1/summary")
      .set("x-test-user", "owner")
      .expect(200);

    expect(response.body.fallback).toBe(true);
    expect(response.body.document).toMatchObject({
      summary: expect.stringContaining("Gemini creates summaries"),
      flashcards: expect.any(Array),
      quizQuestions: expect.any(Array)
    });
  });

  it("returns the English study set when local-language translation is unavailable", async () => {
    process.env.LOCAL_SPEECH_MAX_ATTEMPTS = "1";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Translation is busy" } }), {
      status: 503,
      headers: { "Content-Type": "application/json" }
    })));
    const app = createTestApp(repository, generator);

    const response = await request(app)
      .post("/api/learning/doc_1/summary")
      .set("x-test-user", "owner")
      .send({ targetLanguage: "tw" })
      .expect(200);

    expect(response.body.fallback).toBe(true);
    expect(response.body.document).toMatchObject({
      summary: "Detailed learning summary",
      flashcards: [{ front: "What does Gemini create?", back: "Study material." }]
    });
  });

  it("retries a temporary generated-study sync failure", async () => {
    const learningRepository = createMemoryLearningRepository();
    const originalSync = learningRepository.syncGeneratedLearning.bind(learningRepository);
    let attempts = 0;
    learningRepository.syncGeneratedLearning = vi.fn(async (userId, documentId, learning) => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error("Timed out fetching a new connection from the connection pool."), { code: "P2024" });
      await originalSync(userId, documentId, learning);
    });
    const app = createTestApp(repository, generator, learningRepository);

    const response = await request(app).post("/api/learning/doc_1/summary").set("x-test-user", "owner").expect(200);

    expect(response.body.syncPending).toBe(false);
    expect(learningRepository.syncGeneratedLearning).toHaveBeenCalledTimes(2);
  });

  it("returns the saved study document when row sync remains temporarily unavailable", async () => {
    const learningRepository = createMemoryLearningRepository();
    learningRepository.syncGeneratedLearning = vi.fn(async () => {
      throw Object.assign(new Error("Timed out fetching a new connection from the connection pool."), { code: "P2024" });
    });
    const app = createTestApp(repository, generator, learningRepository);

    const response = await request(app).post("/api/learning/doc_1/summary").set("x-test-user", "owner").expect(200);

    expect(response.body.syncPending).toBe(true);
    expect(response.body.document.summary).toBe("Detailed learning summary");
    expect(learningRepository.syncGeneratedLearning).toHaveBeenCalledTimes(2);
  });

  it("generates flashcards without exposing the Gemini key to the client", async () => {
    const app = createTestApp(repository, generator);

    const response = await request(app).post("/api/learning/doc_1/flashcards").set("x-test-user", "owner").expect(200);

    expect(response.body.flashcards).toEqual([{ question: "What does Gemini create?", answer: "Study material." }]);
    expect(JSON.stringify(response.body)).not.toContain("GEMINI_API_KEY");
  });

  it("answers questions against the saved document text", async () => {
    const app = createTestApp(repository, generator);

    const response = await request(app)
      .post("/api/learning/doc_1/ask")
      .set("x-test-user", "owner")
      .send({ question: "What can I study from this?" })
      .expect(200);

    expect(response.body).toEqual({
      answer: "Gemini creates summaries, flashcards, and quizzes.",
      citedSections: ["Gemini creates summaries, flashcards, and quizzes from saved reading material."],
      fallback: false
    });
    expect(generator.answerQuestion).toHaveBeenCalledWith({
      title: "Learning article",
      text: expect.stringContaining("saved reading material"),
      question: "What can I study from this?"
    });
  });

  it("answers questions using the most relevant document sections", async () => {
    const app = createTestApp(repository, generator);

    await request(app)
      .post("/api/learning/doc_1/ask")
      .set("x-test-user", "owner")
      .send({ question: "What is the difference between Library and History?" })
      .expect(200);

    expect(generator.answerQuestion).toHaveBeenCalledWith({
      title: "Learning article",
      text: expect.stringContaining("Library stores saved items"),
      question: "What is the difference between Library and History?"
    });
    expect(generator.answerQuestion).toHaveBeenCalledWith({
      title: "Learning article",
      text: expect.not.stringContaining("boiling pasta"),
      question: "What is the difference between Library and History?"
    });
  });

  it("falls back to extractive Ask AI answers when Gemini is temporarily overloaded", async () => {
    const app = createTestApp(repository, createHighDemandGenerator());

    const response = await request(app)
      .post("/api/learning/doc_1/ask")
      .set("x-test-user", "owner")
      .send({ question: "What is the difference between Library and History?" })
      .expect(200);

    expect(response.body).toMatchObject({
      fallback: true,
      answer: expect.stringContaining("Library stores saved items"),
      citedSections: expect.arrayContaining([expect.stringContaining("History tracks")])
    });
  });

  it("returns review state for a document", async () => {
    const app = createTestApp(repository, generator);

    const response = await request(app).get("/api/learning/doc_1/review").set("x-test-user", "owner").expect(200);

    expect(response.body).toMatchObject({
      documentId: "doc_1",
      flashcards: [{ id: "flash_1", question: "What does Library store?", reviewStatus: "new" }],
      quizQuestions: [{ id: "quiz_1", question: "What happens when history is cleared?", questionType: "multiple_choice" }],
      progress: { notesCount: 2, highlightsCount: 1, flashcardsReviewed: 0, quizAttempts: 0 }
    });
  });

  it("returns direct quick-action payloads for key points, flashcards, and quiz", async () => {
    const app = createTestApp(repository, generator);

    const keyPoints = await request(app).get("/api/learning/doc_1/key-points").set("x-test-user", "owner").expect(200);
    const flashcards = await request(app).get("/api/learning/doc_1/flashcards").set("x-test-user", "owner").expect(200);
    const quiz = await request(app).get("/api/learning/doc_1/quiz").set("x-test-user", "owner").expect(200);

    expect(keyPoints.body).toEqual(["Saved items stay in Library"]);
    expect(flashcards.body).toEqual([expect.objectContaining({ id: "flash_1", question: "What does Library store?" })]);
    expect(quiz.body).toEqual([expect.objectContaining({ id: "quiz_1", question: "What happens when history is cleared?" })]);
  });

  it("updates flashcard review status", async () => {
    const app = createTestApp(repository, generator);

    const response = await request(app)
      .patch("/api/learning/doc_1/flashcards/flash_1/review")
      .set("x-test-user", "owner")
      .send({ reviewStatus: "known" })
      .expect(200);

    expect(response.body).toMatchObject({ id: "flash_1", reviewStatus: "known" });
  });

  it("scores and stores quiz attempts", async () => {
    const app = createTestApp(repository, generator);

    const response = await request(app)
      .post("/api/learning/doc_1/quiz/attempts")
      .set("x-test-user", "owner")
      .send({ answers: { quiz_1: "The history entry is removed" } })
      .expect(201);

    expect(response.body).toMatchObject({
      score: 100,
      total: 1,
      scoredTotal: 1,
      correct: 1,
      results: [{ questionId: "quiz_1", isCorrect: true, isScored: true, correctAnswer: "The history entry is removed" }]
    });
  });

  it("keeps written answers in guided review instead of falsely scoring them wrong", () => {
    const scoring = scoreQuizAnswers([
      {
        id: "written_1",
        question: "What is the central point?",
        questionType: "short_answer",
        correctAnswer: "Beijing promised to fight back over the visit.",
        explanation: "The source states this directly."
      }
    ], {
      written_1: "The article says Beijing will fight back against the visit."
    });

    expect(scoring).toMatchObject({
      score: 0,
      correct: 0,
      scoredTotal: 0,
      results: [{ questionId: "written_1", isScored: false, isCorrect: false }]
    });
  });

  it("removes learning data for a document", async () => {
    const learningRepository = createMemoryLearningRepository();
    const app = createTestApp(repository, generator, learningRepository);

    await request(app).delete("/api/learning/doc_1").set("x-test-user", "owner").expect(204);

    const document = await repository.getDocument("owner", "doc_1");
    expect(document).not.toBeNull();
    const review = await learningRepository.getReview("owner", document!);
    expect(review.flashcards).toEqual([]);
    expect(review.quizQuestions).toEqual([]);
  });

  it("returns trusted study UI descriptors only from the approved component catalog", async () => {
    const app = createTestApp(repository, generator);

    const response = await request(app).get("/api/learning/doc_1/ui").set("x-test-user", "owner").expect(200);

    expect(response.body.documentId).toBe("doc_1");
    expect(response.body.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "ReviewProgressCard" }),
        expect.objectContaining({ type: "FlashcardDeck" }),
        expect.objectContaining({ type: "QuizQuestionCard" }),
        expect.objectContaining({ type: "NoteInput" }),
        expect.objectContaining({ type: "ActionButton" })
      ])
    );
    expect(response.body.components.map((component: { type: string }) => component.type)).not.toContain("ArbitraryGeminiComponent");
  });

  it("returns 404 for documents outside the signed-in user", async () => {
    const app = createTestApp(repository, generator);

    await request(app).post("/api/learning/doc_1/summary").set("x-test-user", "other").expect(404);
  });
});
