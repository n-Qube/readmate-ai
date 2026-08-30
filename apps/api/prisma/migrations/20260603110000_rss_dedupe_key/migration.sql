ALTER TABLE "ReadingDocument" ADD COLUMN "dedupeKey" TEXT;

UPDATE "ReadingDocument"
SET "dedupeKey" = LEFT(
  CONCAT(
    'rss:url:',
    COALESCE("canonicalUrl", "sourceUrl", "id")
  ),
  500
)
WHERE "sourceType" IN ('rss', 'news')
  AND "deletedAt" IS NULL
  AND "dedupeKey" IS NULL;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "dedupeKey"
      ORDER BY
        CASE WHEN "lastReadAt" IS NULL THEN 1 ELSE 0 END,
        "lastReadAt" DESC NULLS LAST,
        "updatedAt" DESC,
        "createdAt" DESC
    ) AS row_number
  FROM "ReadingDocument"
  WHERE "dedupeKey" IS NOT NULL
    AND "deletedAt" IS NULL
)
UPDATE "ReadingDocument"
SET "deletedAt" = NOW()
WHERE "id" IN (
  SELECT "id" FROM ranked WHERE row_number > 1
);

CREATE UNIQUE INDEX "ReadingDocument_userId_dedupeKey_key"
ON "ReadingDocument"("userId", "dedupeKey")
WHERE "dedupeKey" IS NOT NULL
  AND "deletedAt" IS NULL;
