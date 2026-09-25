-- Scheduled cleanup of abandoned PDF uploads (signed but never converted).
-- The API role cannot see other users' rows under forced RLS, so this narrow
-- SECURITY DEFINER function returns only what cleanup needs: id, owner, key.
-- Deletion itself still runs per user under the normal RLS context.
CREATE OR REPLACE FUNCTION app.list_expired_pending_uploads(
  cutoff_at timestamp with time zone,
  row_limit integer DEFAULT 100
)
RETURNS TABLE ("id" text, "userId" text, "storageKey" text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
  SELECT upload."id", upload."userId", upload."storageKey"
  FROM public."UploadedFile" upload
  WHERE upload."documentId" IS NULL
    AND upload."createdAt" < cutoff_at
  ORDER BY upload."createdAt" ASC
  LIMIT LEAST(GREATEST(row_limit, 1), 100);
$$;

REVOKE ALL ON FUNCTION app.list_expired_pending_uploads(timestamp with time zone, integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readmate_api') THEN
    GRANT EXECUTE ON FUNCTION app.list_expired_pending_uploads(timestamp with time zone, integer) TO readmate_api;
  END IF;
END $$;
