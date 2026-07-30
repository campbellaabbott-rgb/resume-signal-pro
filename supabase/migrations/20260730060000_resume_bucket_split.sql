-- Re-do of 20260730040000, which did not apply.
--
-- WHY THE FIRST ONE FAILED (most likely): storage.objects is owned by
-- supabase_storage_admin, not by the role migrations run as. CREATE POLICY and
-- DROP POLICY both require table ownership, so those statements can raise
-- insufficient_privilege. A migration is one transaction — so a policy statement
-- failing at the END rolled back the bucket INSERT at the START, and the result
-- looked like "the migration silently did nothing" rather than "one statement
-- was not permitted".
--
-- That is the actual lesson here, and it is not specific to storage: putting a
-- statement that MAY fail on privileges in the same transaction as the thing you
-- actually need means the thing you actually need is hostage to it.
--
-- So: the bucket is created first and alone, and the policies are attempted
-- afterwards inside an exception-handling block. If the policies cannot be
-- created, the bucket still exists and the failure is announced rather than
-- swallowed.

-- ---------------------------------------------------------------------------
-- 1. The bucket. Nothing else in this statement, so nothing else can undo it.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'resumes',
  'resumes',
  -- PRIVATE. A résumé is a home address, a phone number and an employment
  -- history in one file. A public bucket makes every one of them enumerable by
  -- URL forever. The worker reads with the service key, which does not need the
  -- bucket to be public.
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
  SET public             = false,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Owner-only access policies, attempted but not required.
--
-- Objects are keyed {user_id}/{filename}, so ownership is the first path
-- segment. storage.foldername() splits the path; [1] is that segment.
--
-- If this block cannot run, browser uploads will 403 and the bucket must have
-- these four policies added from the Supabase dashboard (Storage → resumes →
-- Policies). The worker is unaffected either way — the service role bypasses
-- RLS.
-- ---------------------------------------------------------------------------
DO $do$
BEGIN
  BEGIN
    DROP POLICY IF EXISTS "resumes_owner_read"   ON storage.objects;
    DROP POLICY IF EXISTS "resumes_owner_write"  ON storage.objects;
    DROP POLICY IF EXISTS "resumes_owner_update" ON storage.objects;
    DROP POLICY IF EXISTS "resumes_owner_delete" ON storage.objects;

    CREATE POLICY "resumes_owner_read" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);

    CREATE POLICY "resumes_owner_write" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);

    -- Replacing a résumé is routine; people update them constantly.
    CREATE POLICY "resumes_owner_update" ON storage.objects
      FOR UPDATE TO authenticated
      USING      (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text)
      WITH CHECK (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);

    CREATE POLICY "resumes_owner_delete" ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);

    RAISE NOTICE 'resumes: owner-only policies installed';
  EXCEPTION
    WHEN insufficient_privilege OR undefined_table THEN
      -- The bucket above is already committed to this transaction and stays.
      RAISE WARNING
        'resumes: bucket created but policies could NOT be installed (%). Browser uploads will 403 until the four resumes_owner_* policies are added from the Supabase dashboard. The worker is unaffected (service role bypasses RLS).',
        SQLERRM;
  END;
END
$do$;

COMMENT ON COLUMN public.agent_mandates.resume_file_url IS
  'Storage path inside the private `resumes` bucket, shaped {user_id}/{filename} — NOT a public URL. The worker downloads it with the service key at submit time.';
