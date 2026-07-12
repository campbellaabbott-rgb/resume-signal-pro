-- Feature 7 (closed-posting intelligence): stamp the moment a tracked job's
-- posting leaves the live board, so the tracker can show "still open" vs
-- "closed on <date>". Nullable — null means still open (or never checked).
ALTER TABLE public.user_applications ADD COLUMN IF NOT EXISTS posting_closed_at timestamptz;
ALTER TABLE public.user_applications ADD COLUMN IF NOT EXISTS posting_checked_at timestamptz;

-- Feature 4 (weekly saved-search digest): opt-in flag + send bookkeeping on
-- the saved search itself. Opt-in (default false) — we never email without
-- an explicit toggle, same discipline as the fix-plan drip.
ALTER TABLE public.user_job_searches ADD COLUMN IF NOT EXISTS digest_opt_in boolean NOT NULL DEFAULT false;
ALTER TABLE public.user_job_searches ADD COLUMN IF NOT EXISTS digest_last_sent_at timestamptz;

-- The digest sender runs as service-role and needs to find opted-in searches
-- across all users in one query; this index keeps that scan cheap.
CREATE INDEX IF NOT EXISTS user_job_searches_digest_idx
  ON public.user_job_searches (digest_opt_in, digest_last_sent_at)
  WHERE digest_opt_in = true;
