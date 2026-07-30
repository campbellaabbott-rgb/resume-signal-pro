-- Private storage for the résumé file the agent attaches to applications.
--
-- WHY THIS BLOCKS EVERYTHING: buildPacket treats a required file question as a
-- blocker when there is no résumé, and the worker refuses to submit when any
-- required DOM field is empty. Nearly every application form has a résumé
-- upload. Without this bucket, the agent prepares packets, claims them, loads
-- the form, and stops at the last step on essentially every posting.
--
-- The project had NO storage buckets at all before this — résumés lived only as
-- parsed text on scans, which is enough to score a match and useless for a file
-- input that wants an actual PDF.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'resumes',
  'resumes',
  -- PRIVATE. A résumé is a home address, a phone number, and an employment
  -- history in one file. A public bucket would make every one of them
  -- enumerable by URL forever, and the agent's own worker can read it with the
  -- service key without the file ever being world-readable.
  false,
  10485760, -- 10 MB; a résumé over that is a scanned image, not a document
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Objects are keyed {user_id}/{filename}, so ownership is the first path
-- segment. storage.foldername() splits the path; [1] is that segment.
DROP POLICY IF EXISTS "resumes_owner_read" ON storage.objects;
CREATE POLICY "resumes_owner_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "resumes_owner_write" ON storage.objects;
CREATE POLICY "resumes_owner_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Replacing a résumé is routine; people update them constantly.
DROP POLICY IF EXISTS "resumes_owner_update" ON storage.objects;
CREATE POLICY "resumes_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "resumes_owner_delete" ON storage.objects;
CREATE POLICY "resumes_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);

-- No policy is granted to anon, and none to authenticated for OTHER users'
-- folders. The worker reads with the service role, which bypasses RLS — that is
-- the only path by which a résumé leaves its owner's control, and it goes
-- straight into an application that owner asked for.

COMMENT ON COLUMN public.agent_mandates.resume_file_url IS
  'Storage path inside the private `resumes` bucket, shaped {user_id}/{filename} — NOT a public URL. The worker downloads it with the service key at submit time.';
