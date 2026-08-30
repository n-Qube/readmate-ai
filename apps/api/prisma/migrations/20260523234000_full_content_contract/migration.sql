ALTER TABLE "ReadingDocument"
  ADD COLUMN IF NOT EXISTS "coverImageUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "pageCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'unread',
  ADD COLUMN IF NOT EXISTS "summary" TEXT,
  ADD COLUMN IF NOT EXISTS "keyPoints" TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "quizQuestions" TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "flashcards" TEXT NOT NULL DEFAULT '[]';

UPDATE "ReadingDocument"
SET "status" = CASE
  WHEN "percent" >= 100 THEN 'completed'
  WHEN "percent" > 0 THEN 'in_progress'
  ELSE 'unread'
END
WHERE "status" = 'unread';

CREATE INDEX IF NOT EXISTS "ReadingDocument_userId_status_idx" ON "ReadingDocument"("userId", "status");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    EXECUTE $sql$
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES (
        'readmate-media',
        'readmate-media',
        false,
        8388608,
        ARRAY['image/webp', 'image/png', 'image/jpeg', 'image/svg+xml']::text[]
      )
      ON CONFLICT (id) DO UPDATE
      SET public = EXCLUDED.public,
          file_size_limit = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types
    $sql$;
  END IF;
END $$;
