CREATE OR REPLACE FUNCTION app.is_rls_service()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT false;
$$;

REVOKE EXECUTE ON FUNCTION app.is_rls_service() FROM PUBLIC;
ALTER TABLE public."SourceSubscription" NO FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION app.list_due_rss_sources(
  cutoff_at timestamp with time zone,
  requested_user_id text DEFAULT NULL,
  row_limit integer DEFAULT 100
)
RETURNS SETOF public."SourceSubscription"
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
  SELECT source.*
  FROM public."SourceSubscription" source
  WHERE source."isSubscribed" = true
    AND source."sourceType" = 'rss'
    AND source."rssFeedUrl" IS NOT NULL
    AND (requested_user_id IS NULL OR source."userId" = requested_user_id)
    AND (source."lastSyncedAt" IS NULL OR source."lastSyncedAt" < cutoff_at)
  ORDER BY source."lastSyncedAt" ASC NULLS FIRST, source."createdAt" ASC
  LIMIT LEAST(GREATEST(row_limit, 1), 100);
$$;

REVOKE ALL ON FUNCTION app.list_due_rss_sources(timestamp with time zone, text, integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readmate_api') THEN
    GRANT EXECUTE ON FUNCTION app.list_due_rss_sources(timestamp with time zone, text, integer) TO readmate_api;
  END IF;
END $$;
