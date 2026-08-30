ALTER TABLE "ReadingDocument" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'Uncategorized';
ALTER TABLE "ReadingDocument" ADD COLUMN "sourceLabel" TEXT;
ALTER TABLE "UserSettings" ADD COLUMN "preferredContentTypes" TEXT NOT NULL DEFAULT '["webpage","pdf","rss","url"]';
