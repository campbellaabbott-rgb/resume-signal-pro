DROP POLICY IF EXISTS "resumes_owner_read" ON storage.objects;
CREATE POLICY "resumes_owner_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "resumes_owner_write" ON storage.objects;
CREATE POLICY "resumes_owner_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "resumes_owner_update" ON storage.objects;
CREATE POLICY "resumes_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "resumes_owner_delete" ON storage.objects;
CREATE POLICY "resumes_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);

COMMENT ON COLUMN public.agent_mandates.resume_file_url IS
  'Storage path inside the private `resumes` bucket, shaped {user_id}/{filename} — NOT a public URL.';