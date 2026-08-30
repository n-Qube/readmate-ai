ALTER TABLE "ReadingDocument" ADD COLUMN "rssFeedUrl" TEXT;
ALTER TABLE "ReadingDocument" ADD COLUMN "contentHtml" TEXT;
ALTER TABLE "ReadingDocument" ADD COLUMN "topicTags" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "ReadingDocument" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "ReadingDocument_userId_canonicalUrl_idx" ON "ReadingDocument"("userId", "canonicalUrl");
CREATE INDEX "ReadingDocument_userId_deletedAt_idx" ON "ReadingDocument"("userId", "deletedAt");

CREATE TABLE "SourceSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "rssFeedUrl" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'website',
    "topics" TEXT NOT NULL DEFAULT '[]',
    "isSubscribed" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceSubscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SourceSubscription_userId_isSubscribed_idx" ON "SourceSubscription"("userId", "isSubscribed");
CREATE INDEX "SourceSubscription_userId_updatedAt_idx" ON "SourceSubscription"("userId", "updatedAt");
