-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "ReadingDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "canonicalUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastReadAt" TIMESTAMP(3),
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "characterOffset" INTEGER NOT NULL DEFAULT 0,
    "percent" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL DEFAULT 'openai',
    "voice" TEXT NOT NULL DEFAULT 'marin',
    "speed" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "ReadingDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadingBlock" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "blockType" TEXT NOT NULL DEFAULT 'paragraph',
    "text" TEXT NOT NULL,
    "sourceSelector" TEXT,
    "sourcePageNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadingBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadingSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "totalListeningSeconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReadingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'openai',
    "voice" TEXT NOT NULL DEFAULT 'marin',
    "speed" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "tone" TEXT,
    "autoScroll" BOOLEAN NOT NULL DEFAULT true,
    "highlightMode" TEXT NOT NULL DEFAULT 'paragraph',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadedFile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadedFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReadingDocument_userId_updatedAt_idx" ON "ReadingDocument"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ReadingDocument_userId_lastReadAt_idx" ON "ReadingDocument"("userId", "lastReadAt");

-- CreateIndex
CREATE INDEX "ReadingBlock_documentId_orderIndex_idx" ON "ReadingBlock"("documentId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "ReadingBlock_documentId_orderIndex_key" ON "ReadingBlock"("documentId", "orderIndex");

-- CreateIndex
CREATE INDEX "ReadingSession_userId_startedAt_idx" ON "ReadingSession"("userId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE INDEX "UploadedFile_userId_createdAt_idx" ON "UploadedFile"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReadingBlock" ADD CONSTRAINT "ReadingBlock_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ReadingDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingSession" ADD CONSTRAINT "ReadingSession_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ReadingDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
