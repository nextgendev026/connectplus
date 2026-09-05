-- Allow the storage API (anon/authenticated roles) to resolve the uploads bucket row.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='buckets' AND policyname='connectplus_read_uploads_bucket') THEN
    CREATE POLICY "connectplus_read_uploads_bucket" ON storage.buckets FOR SELECT USING (id = 'uploads');
  END IF;
END $$;