CREATE TABLE "AccountDeletionFence" (
    "userHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountDeletionFence_pkey" PRIMARY KEY ("userHash"),
    CONSTRAINT "AccountDeletionFence_userHash_check" CHECK ("userHash" ~ '^[0-9a-f]{64}$')
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readmate_api') THEN
    GRANT SELECT, INSERT ON TABLE "AccountDeletionFence" TO readmate_api;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app.reject_account_deletion_fenced_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  deletion_user_hash TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."userId", 0));
  deletion_user_hash := encode(sha256(convert_to(NEW."userId", 'UTF8')), 'hex');

  IF EXISTS (
    SELECT 1
    FROM public."AccountDeletionFence"
    WHERE "userHash" = deletion_user_hash
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'ACCOUNT_DELETION_IN_PROGRESS';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.reject_account_deletion_fenced_write() FROM PUBLIC;

CREATE TRIGGER "WebMcpAuditEvent_account_deletion_fence"
BEFORE INSERT OR UPDATE ON "WebMcpAuditEvent"
FOR EACH ROW EXECUTE FUNCTION app.reject_account_deletion_fenced_write();

CREATE TRIGGER "WebMcpStudyPackEffect_account_deletion_fence"
BEFORE INSERT OR UPDATE ON "WebMcpStudyPackEffect"
FOR EACH ROW EXECUTE FUNCTION app.reject_account_deletion_fenced_write();

CREATE TRIGGER "ReadingDocument_account_deletion_fence"
BEFORE INSERT OR UPDATE ON "ReadingDocument"
FOR EACH ROW EXECUTE FUNCTION app.reject_account_deletion_fenced_write();

CREATE TRIGGER "SourceSubscription_account_deletion_fence"
BEFORE INSERT OR UPDATE ON "SourceSubscription"
FOR EACH ROW EXECUTE FUNCTION app.reject_account_deletion_fenced_write();

CREATE TRIGGER "UsageBucket_account_deletion_fence"
BEFORE INSERT OR UPDATE ON "UsageBucket"
FOR EACH ROW EXECUTE FUNCTION app.reject_account_deletion_fenced_write();

CREATE TRIGGER "UserSettings_account_deletion_fence"
BEFORE INSERT OR UPDATE ON "UserSettings"
FOR EACH ROW EXECUTE FUNCTION app.reject_account_deletion_fenced_write();

CREATE TRIGGER "LearningFlashcard_account_deletion_fence"
BEFORE INSERT OR UPDATE ON "LearningFlashcard"
FOR EACH ROW EXECUTE FUNCTION app.reject_account_deletion_fenced_write();

CREATE TRIGGER "LearningQuizQuestion_account_deletion_fence"
BEFORE INSERT OR UPDATE ON "LearningQuizQuestion"
FOR EACH ROW EXECUTE FUNCTION app.reject_account_deletion_fenced_write();
