-- Storage bucket + policies for profile media (idempotent)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('uploads', 'uploads', true, 5242880, ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='connectplus_public_read_uploads') THEN
    CREATE POLICY "connectplus_public_read_uploads" ON storage.objects FOR SELECT USING (bucket_id = 'uploads');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='connectplus_anon_insert_uploads') THEN
    CREATE POLICY "connectplus_anon_insert_uploads" ON storage.objects FOR INSERT WITH CHECK (
      bucket_id = 'uploads'
      AND (storage.foldername(name))[1] = 'uploads'
      AND lower(storage.extension(name)) IN ('jpg','jpeg','png','webp','gif')
    );
  END IF;
END $$;