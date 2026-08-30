DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readmate_api') THEN
    GRANT DELETE ON TABLE "WebMcpAuditEvent" TO readmate_api;
  END IF;
END $$;
