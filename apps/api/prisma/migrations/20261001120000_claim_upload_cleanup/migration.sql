-- Durable tombstone for pending upload deletion; conversion must reject claimed uploads.
ALTER TABLE "UploadedFile" ADD COLUMN "cleanupStartedAt" TIMESTAMP(3);
-- Enforce the invariant for older revisions too, during rollout and rollback.
ALTER TABLE "UploadedFile" ADD CONSTRAINT "UploadedFile_cleanup_pending_only"
  CHECK ("cleanupStartedAt" IS NULL OR "documentId" IS NULL);
