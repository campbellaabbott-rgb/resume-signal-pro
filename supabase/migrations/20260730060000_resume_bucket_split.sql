-- Re-do of 20260730040000, which created its policies but not its bucket.
--
-- MY FIRST DIAGNOSIS WAS WRONG, and the correction matters more than the fix.
-- I guessed that CREATE POLICY on storage.objects had failed on privileges and
-- rolled back the bucket INSERT with it, since they shared a transaction. That
-- was a plausible story built on not being able to see the outcome.
--
-- What the deploy actually emitted (20260730202622_67527859…) settles it: it
-- contains all four CREATE POLICY statements and NO bucket insert. So the
-- policies were permitted and applied. The INSERT INTO storage.buckets was
-- dropped somewhere in the deploy path, and re-shipping the same statement will
-- be dropped the same way.
--
-- The resulting state is the quiet kind: four RLS policies guarding a bucket
-- that does not exist. Everything looks configured. The only symptom is that
-- every résumé upload fails at the last step.
--
-- THE BUCKET IS THEREFORE CREATED FROM CODE, not here — apply-agent calls
-- storage.createBucket with the service key on every run and reports the result
-- in its summary. That goes through the storage API instead of SQL, which is
-- the path that works in this project.
--
-- This statement is kept because it is correct SQL and does the right thing
-- when applied through a path that honours it (supabase CLI, or the dashboard
-- SQL editor). It is idempotent and harmless when the bucket already exists.
-- It is no longer the thing being relied on.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'resumes',
  'resumes',
  -- PRIVATE. A résumé is a home address, a phone number and an employment
  -- history in one file. A public bucket makes every one of them enumerable by
  -- URL forever. The worker reads with the service key and does not need it
  -- public.
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

-- The four owner-only policies are already in production via 20260730202622,
-- so they are not repeated here. Objects are keyed {user_id}/{filename} and
-- each policy checks (storage.foldername(name))[1] = auth.uid()::text.

COMMENT ON COLUMN public.agent_mandates.resume_file_url IS
  'Storage path inside the private `resumes` bucket, shaped {user_id}/{filename} — NOT a public URL. The worker downloads it with the service key at submit time.';
