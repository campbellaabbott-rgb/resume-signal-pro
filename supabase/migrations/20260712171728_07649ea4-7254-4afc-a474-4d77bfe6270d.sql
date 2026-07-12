ALTER TABLE public.user_applications ADD COLUMN IF NOT EXISTS posting_closed_at timestamptz;
ALTER TABLE public.user_applications ADD COLUMN IF NOT EXISTS posting_checked_at timestamptz;

ALTER TABLE public.user_job_searches ADD COLUMN IF NOT EXISTS digest_opt_in boolean NOT NULL DEFAULT false;
ALTER TABLE public.user_job_searches ADD COLUMN IF NOT EXISTS digest_last_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS user_job_searches_digest_idx
  ON public.user_job_searches (digest_opt_in, digest_last_sent_at)
  WHERE digest_opt_in = true;

NOTIFY pgrst, 'reload schema';