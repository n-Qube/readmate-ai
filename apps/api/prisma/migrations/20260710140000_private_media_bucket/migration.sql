DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    UPDATE storage.buckets
    SET public = false
    WHERE id = 'readmate-media';
  END IF;
END $$;
