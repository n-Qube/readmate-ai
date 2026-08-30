CREATE TABLE "LearningFlashcard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "topicTag" TEXT,
    "difficulty" TEXT NOT NULL DEFAULT 'medium',
    "reviewStatus" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LearningFlashcard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningQuizQuestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "questionType" TEXT NOT NULL,
    "options" TEXT NOT NULL DEFAULT '[]',
    "correctAnswer" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "topicTag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LearningQuizQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningQuizAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "answers" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "correct" INTEGER NOT NULL DEFAULT 0,
    "results" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningQuizAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LearningFlashcard_userId_documentId_deletedAt_idx" ON "LearningFlashcard"("userId", "documentId", "deletedAt");
CREATE INDEX "LearningFlashcard_userId_reviewStatus_idx" ON "LearningFlashcard"("userId", "reviewStatus");
CREATE INDEX "LearningQuizQuestion_userId_documentId_deletedAt_idx" ON "LearningQuizQuestion"("userId", "documentId", "deletedAt");
CREATE INDEX "LearningQuizAttempt_userId_documentId_createdAt_idx" ON "LearningQuizAttempt"("userId", "documentId", "createdAt");

ALTER TABLE "LearningFlashcard" ADD CONSTRAINT "LearningFlashcard_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ReadingDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningQuizQuestion" ADD CONSTRAINT "LearningQuizQuestion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ReadingDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningQuizAttempt" ADD CONSTRAINT "LearningQuizAttempt_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ReadingDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
