CREATE TABLE IF NOT EXISTS "UsageBucket" (
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "quantity" BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageBucket_pkey" PRIMARY KEY ("userId", "kind", "windowStart")
);

CREATE INDEX IF NOT EXISTS "UsageBucket_userId_updatedAt_idx" ON "UsageBucket"("userId", "updatedAt");

ALTER TABLE "UsageBucket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageBucket" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'UsageBucket'
      AND policyname = 'usage_buckets_are_user_scoped'
  ) THEN
    CREATE POLICY "usage_buckets_are_user_scoped"
    ON "UsageBucket"
    FOR ALL
    USING ("userId" = app.current_user_id())
    WITH CHECK ("userId" = app.current_user_id());
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readmate_api') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "UsageBucket" TO readmate_api;
  END IF;
END $$;
