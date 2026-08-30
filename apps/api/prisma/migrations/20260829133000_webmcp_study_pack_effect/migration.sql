CREATE TABLE "WebMcpStudyPackEffect" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actionDigest" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebMcpStudyPackEffect_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WebMcpStudyPackEffect_requestId_check" CHECK (
      char_length("requestId") BETWEEN 8 AND 128 AND "requestId" ~ '^[A-Za-z0-9][A-Za-z0-9_-]*$'
    ),
    CONSTRAINT "WebMcpStudyPackEffect_actionDigest_check" CHECK ("actionDigest" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "WebMcpStudyPackEffect_documentId_check" CHECK (
      char_length("documentId") BETWEEN 1 AND 80 AND "documentId" ~ '^[A-Za-z0-9][A-Za-z0-9_-]*$'
    ),
    CONSTRAINT "WebMcpStudyPackEffect_status_check" CHECK ("status" IN ('started', 'succeeded', 'failed')),
    CONSTRAINT "WebMcpStudyPackEffect_errorCode_check" CHECK (
      ("status" = 'failed' AND "errorCode" IS NOT NULL AND "errorCode" ~ '^[A-Z][A-Z0-9_]{1,63}$')
      OR ("status" <> 'failed' AND "errorCode" IS NULL)
    )
);

CREATE UNIQUE INDEX "WebMcpStudyPackEffect_userId_requestId_key"
ON "WebMcpStudyPackEffect"("userId", "requestId");

CREATE INDEX "WebMcpStudyPackEffect_userId_createdAt_idx"
ON "WebMcpStudyPackEffect"("userId", "createdAt");

ALTER TABLE "WebMcpStudyPackEffect" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebMcpStudyPackEffect" FORCE ROW LEVEL SECURITY;
CREATE POLICY "webmcp_study_pack_effects_are_user_scoped"
ON "WebMcpStudyPackEffect"
FOR ALL
USING ("userId" = app.current_user_id())
WITH CHECK ("userId" = app.current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readmate_api') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "WebMcpStudyPackEffect" TO readmate_api;
  END IF;
END $$;
