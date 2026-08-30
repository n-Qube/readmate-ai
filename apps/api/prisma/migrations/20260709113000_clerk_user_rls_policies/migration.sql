CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '');
$$;

CREATE OR REPLACE FUNCTION app.is_rls_service()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(current_setting('app.rls_service', true), '') = 'true';
$$;

GRANT USAGE ON SCHEMA app TO PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_user_id() TO PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_rls_service() TO PUBLIC;

ALTER TABLE "ReadingDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReadingDocument" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reading_documents_are_user_scoped" ON "ReadingDocument";
CREATE POLICY "reading_documents_are_user_scoped"
ON "ReadingDocument"
FOR ALL
USING (app.is_rls_service() OR "userId" = app.current_user_id())
WITH CHECK (app.is_rls_service() OR "userId" = app.current_user_id());

ALTER TABLE "ReadingBlock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReadingBlock" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reading_blocks_are_document_owner_scoped" ON "ReadingBlock";
CREATE POLICY "reading_blocks_are_document_owner_scoped"
ON "ReadingBlock"
FOR ALL
USING (
  app.is_rls_service()
  OR EXISTS (
    SELECT 1
    FROM "ReadingDocument"
    WHERE "ReadingDocument"."id" = "ReadingBlock"."documentId"
      AND "ReadingDocument"."userId" = app.current_user_id()
  )
)
WITH CHECK (
  app.is_rls_service()
  OR EXISTS (
    SELECT 1
    FROM "ReadingDocument"
    WHERE "ReadingDocument"."id" = "ReadingBlock"."documentId"
      AND "ReadingDocument"."userId" = app.current_user_id()
  )
);

ALTER TABLE "ReadingSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReadingSession" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reading_sessions_are_user_scoped" ON "ReadingSession";
CREATE POLICY "reading_sessions_are_user_scoped"
ON "ReadingSession"
FOR ALL
USING (app.is_rls_service() OR "userId" = app.current_user_id())
WITH CHECK (app.is_rls_service() OR "userId" = app.current_user_id());

ALTER TABLE "UserSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserSettings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_settings_are_user_scoped" ON "UserSettings";
CREATE POLICY "user_settings_are_user_scoped"
ON "UserSettings"
FOR ALL
USING (app.is_rls_service() OR "userId" = app.current_user_id())
WITH CHECK (app.is_rls_service() OR "userId" = app.current_user_id());

ALTER TABLE "UploadedFile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UploadedFile" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "uploaded_files_are_user_scoped" ON "UploadedFile";
CREATE POLICY "uploaded_files_are_user_scoped"
ON "UploadedFile"
FOR ALL
USING (app.is_rls_service() OR "userId" = app.current_user_id())
WITH CHECK (app.is_rls_service() OR "userId" = app.current_user_id());

ALTER TABLE "SourceSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SourceSubscription" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "source_subscriptions_are_user_scoped" ON "SourceSubscription";
CREATE POLICY "source_subscriptions_are_user_scoped"
ON "SourceSubscription"
FOR ALL
USING (app.is_rls_service() OR "userId" = app.current_user_id())
WITH CHECK (app.is_rls_service() OR "userId" = app.current_user_id());

ALTER TABLE "Highlight" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Highlight" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "highlights_are_user_scoped" ON "Highlight";
CREATE POLICY "highlights_are_user_scoped"
ON "Highlight"
FOR ALL
USING (app.is_rls_service() OR "userId" = app.current_user_id())
WITH CHECK (app.is_rls_service() OR "userId" = app.current_user_id());

ALTER TABLE "Note" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Note" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notes_are_user_scoped" ON "Note";
CREATE POLICY "notes_are_user_scoped"
ON "Note"
FOR ALL
USING (app.is_rls_service() OR "userId" = app.current_user_id())
WITH CHECK (app.is_rls_service() OR "userId" = app.current_user_id());

ALTER TABLE "LearningFlashcard" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LearningFlashcard" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "learning_flashcards_are_user_scoped" ON "LearningFlashcard";
CREATE POLICY "learning_flashcards_are_user_scoped"
ON "LearningFlashcard"
FOR ALL
USING (app.is_rls_service() OR "userId" = app.current_user_id())
WITH CHECK (app.is_rls_service() OR "userId" = app.current_user_id());

ALTER TABLE "LearningQuizQuestion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LearningQuizQuestion" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "learning_quiz_questions_are_user_scoped" ON "LearningQuizQuestion";
CREATE POLICY "learning_quiz_questions_are_user_scoped"
ON "LearningQuizQuestion"
FOR ALL
USING (app.is_rls_service() OR "userId" = app.current_user_id())
WITH CHECK (app.is_rls_service() OR "userId" = app.current_user_id());

ALTER TABLE "LearningQuizAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LearningQuizAttempt" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "learning_quiz_attempts_are_user_scoped" ON "LearningQuizAttempt";
CREATE POLICY "learning_quiz_attempts_are_user_scoped"
ON "LearningQuizAttempt"
FOR ALL
USING (app.is_rls_service() OR "userId" = app.current_user_id())
WITH CHECK (app.is_rls_service() OR "userId" = app.current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readmate_api') THEN
    GRANT USAGE ON SCHEMA public, app TO readmate_api;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO readmate_api;
    GRANT EXECUTE ON FUNCTION app.current_user_id() TO readmate_api;
    GRANT EXECUTE ON FUNCTION app.is_rls_service() TO readmate_api;
  END IF;
END $$;
