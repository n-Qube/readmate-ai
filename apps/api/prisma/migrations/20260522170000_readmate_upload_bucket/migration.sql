-- Create the private PDF upload bucket when this migration is applied to Supabase.
-- The dynamic SQL keeps local non-Supabase Postgres installs from failing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    EXECUTE $sql$
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES ('readmate-uploads', 'readmate-uploads', false, 52428800, ARRAY['application/pdf'])
      ON CONFLICT (id) DO UPDATE SET
        public = EXCLUDED.public,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types
    $sql$;
  END IF;
END $$;
