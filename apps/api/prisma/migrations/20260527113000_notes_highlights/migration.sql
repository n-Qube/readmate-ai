CREATE TABLE "Highlight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "blockId" TEXT,
    "blockIndex" INTEGER NOT NULL,
    "sentenceIndex" INTEGER,
    "highlightText" TEXT NOT NULL,
    "highlightType" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Highlight_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "highlightId" TEXT,
    "noteText" TEXT NOT NULL,
    "blockIndex" INTEGER,
    "sentenceIndex" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Highlight_userId_documentId_deletedAt_idx" ON "Highlight"("userId", "documentId", "deletedAt");
CREATE INDEX "Highlight_documentId_blockIndex_idx" ON "Highlight"("documentId", "blockIndex");
CREATE INDEX "Note_userId_documentId_deletedAt_idx" ON "Note"("userId", "documentId", "deletedAt");
CREATE INDEX "Note_highlightId_idx" ON "Note"("highlightId");

ALTER TABLE "Highlight" ADD CONSTRAINT "Highlight_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ReadingDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Note" ADD CONSTRAINT "Note_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ReadingDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Note" ADD CONSTRAINT "Note_highlightId_fkey" FOREIGN KEY ("highlightId") REFERENCES "Highlight"("id") ON DELETE SET NULL ON UPDATE CASCADE;
