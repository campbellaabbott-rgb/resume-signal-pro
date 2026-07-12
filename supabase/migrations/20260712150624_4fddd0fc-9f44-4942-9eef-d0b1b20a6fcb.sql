ALTER TABLE public.job_board_postings
  ADD COLUMN IF NOT EXISTS effective_posted timestamptz
  GENERATED ALWAYS AS (COALESCE(posted_at, last_seen)) STORED;

CREATE INDEX IF NOT EXISTS job_board_postings_effective_posted_idx
  ON public.job_board_postings (effective_posted DESC NULLS LAST, id);

NOTIFY pgrst, 'reload schema';