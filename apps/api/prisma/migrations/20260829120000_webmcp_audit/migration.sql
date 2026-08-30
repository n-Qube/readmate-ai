CREATE TABLE "WebMcpAuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT,
    "toolName" TEXT NOT NULL,
    "actionClass" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "inputDigest" TEXT,
    "actionDigest" TEXT,
    "claimToken" TEXT,
    "errorCode" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebMcpAuditEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WebMcpAuditEvent_toolName_check" CHECK (
      "toolName" IN (
        'readmate_search_library',
        'readmate_get_document_context',
        'readmate_prepare_listening',
        'readmate_add_web_page',
        'readmate_subscribe_rss',
        'readmate_generate_study_pack'
      )
    ),
    CONSTRAINT "WebMcpAuditEvent_actionClass_check" CHECK ("actionClass" IN ('read', 'ui_state', 'write', 'paid_ai')),
    CONSTRAINT "WebMcpAuditEvent_toolClass_check" CHECK (
      ("toolName" IN ('readmate_search_library', 'readmate_get_document_context') AND "actionClass" = 'read')
      OR ("toolName" = 'readmate_prepare_listening' AND "actionClass" = 'ui_state')
      OR ("toolName" IN ('readmate_add_web_page', 'readmate_subscribe_rss') AND "actionClass" = 'write')
      OR ("toolName" = 'readmate_generate_study_pack' AND "actionClass" = 'paid_ai')
    ),
    CONSTRAINT "WebMcpAuditEvent_status_check" CHECK ("status" IN ('started', 'confirmed', 'succeeded', 'failed', 'cancelled')),
    CONSTRAINT "WebMcpAuditEvent_requestId_check" CHECK (
      "requestId" IS NULL OR (char_length("requestId") BETWEEN 8 AND 128 AND "requestId" ~ '^[A-Za-z0-9][A-Za-z0-9_-]*$')
    ),
    CONSTRAINT "WebMcpAuditEvent_write_requestId_check" CHECK (
      "actionClass" NOT IN ('write', 'paid_ai') OR "requestId" IS NOT NULL
    ),
    CONSTRAINT "WebMcpAuditEvent_errorCode_check" CHECK (
      ("status" = 'failed' AND "errorCode" IS NOT NULL AND "errorCode" ~ '^[A-Z][A-Z0-9_]{1,63}$')
      OR ("status" <> 'failed' AND "errorCode" IS NULL)
    ),
    CONSTRAINT "WebMcpAuditEvent_resourceType_check" CHECK (
      "resourceType" IS NULL OR "resourceType" IN ('document', 'source', 'study_pack')
    ),
    CONSTRAINT "WebMcpAuditEvent_resource_pair_check" CHECK (("resourceType" IS NULL) = ("resourceId" IS NULL)),
    CONSTRAINT "WebMcpAuditEvent_resourceId_check" CHECK (
      "resourceId" IS NULL OR (char_length("resourceId") BETWEEN 1 AND 80 AND "resourceId" ~ '^[A-Za-z0-9][A-Za-z0-9_-]*$')
    ),
    CONSTRAINT "WebMcpAuditEvent_inputDigest_check" CHECK ("inputDigest" IS NULL OR "inputDigest" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "WebMcpAuditEvent_actionDigest_check" CHECK ("actionDigest" IS NULL OR "actionDigest" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "WebMcpAuditEvent_claimToken_check" CHECK ("claimToken" IS NULL OR "claimToken" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "WebMcpAuditEvent_claimProof_check" CHECK ("claimToken" IS NULL OR "actionDigest" IS NOT NULL),
    CONSTRAINT "WebMcpAuditEvent_latencyMs_check" CHECK ("latencyMs" IS NULL OR ("latencyMs" >= 0 AND "latencyMs" <= 300000))
);

CREATE INDEX "WebMcpAuditEvent_userId_createdAt_idx" ON "WebMcpAuditEvent"("userId", "createdAt");
CREATE UNIQUE INDEX "WebMcpAuditEvent_userId_requestId_toolName_key" ON "WebMcpAuditEvent"("userId", "requestId", "toolName");

ALTER TABLE "WebMcpAuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebMcpAuditEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "webmcp_audit_events_are_user_scoped"
ON "WebMcpAuditEvent"
FOR ALL
USING ("userId" = app.current_user_id())
WITH CHECK ("userId" = app.current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readmate_api') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE "WebMcpAuditEvent" TO readmate_api;
  END IF;
END $$;
