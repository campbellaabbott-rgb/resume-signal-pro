-- The `resumes` bucket, declared in SQL. It already exists in production.
--
-- I RAISED A FALSE ALARM HERE AND THE CORRECTION IS THE USEFUL PART.
--
-- I reported that this bucket did not exist. I never measured that. What I had
-- was: (a) listing objects in `resumes` returned [], and (b) the deploy's own
-- emitted migration (20260730202622) contained the four storage policies and no
-- bucket INSERT. From those I concluded the bucket was missing — and said so as
-- fact, in a commit message, after having already noted in the same breath that
-- my probe could not tell the difference.
--
-- (a) is worthless: listing returns [] for a bucket that is missing AND for one
-- that is empty. I verified that against a deliberately fake bucket name and got
-- byte-identical responses.
--
-- The probe that DOES discriminate is a write:
--     POST /storage/v1/object/resumes/probe.txt
--       -> 403 AccessDenied "new row violates row-level security policy"
--     POST /storage/v1/object/definitely-not-a-real-bucket-xyz/probe.txt
--       -> 404 NoSuchBucket "Bucket not found"
-- The first response is only possible if the bucket exists and RLS is enforced.
-- And the public endpoint refuses to resolve `resumes` at all, which is how a
-- PRIVATE bucket behaves — a public one would have answered "Object not found".
--
-- So the bucket exists, is private, and has working owner-only policies. It was
-- created out of band — most plausibly by the deploy tooling itself, which would
-- explain why it strips INSERT INTO storage.buckets from migrations rather than
-- failing on them.
--
-- (b) was a reasonable inference. It was not evidence, and I presented it as if
-- it were. The lesson is the one this project keeps relearning: a claim that
-- changes depending on how you ask has not been measured yet. Find the probe
-- that can return both answers before believing either.
--
-- This statement is kept because it is correct and idempotent, and it documents
-- the intended shape for any environment built from the migrations alone (a
-- local supabase CLI stack, a fresh project). It is not load-bearing in prod.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'resumes',
  'resumes',
  -- PRIVATE. A résumé is a home address, a phone number and an employment
  -- history in one file. A public bucket makes every one of them enumerable by
  -- URL forever. The worker reads with the service key and does not need it
  -- public. Verified private in production.
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

-- The four owner-only policies are already live via 20260730202622, so they are
-- not repeated here. Objects are keyed {user_id}/{filename} and each policy
-- checks (storage.foldername(name))[1] = auth.uid()::text.

COMMENT ON COLUMN public.agent_mandates.resume_file_url IS
  'Storage path inside the private `resumes` bucket, shaped {user_id}/{filename} — NOT a public URL. The worker downloads it with the service key at submit time.';
