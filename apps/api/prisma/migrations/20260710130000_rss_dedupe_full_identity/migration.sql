UPDATE "ReadingDocument"
SET "dedupeKey" = CONCAT('rss:url:', COALESCE("canonicalUrl", "sourceUrl", "id"))
WHERE "sourceType" IN ('rss', 'news')
  AND "deletedAt" IS NULL;
