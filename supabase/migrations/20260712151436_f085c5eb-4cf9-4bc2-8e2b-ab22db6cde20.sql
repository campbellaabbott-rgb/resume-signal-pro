-- Undated postings (BambooHR publishes no dates; future vendors may not
-- either) sorted to the bottom of the board forever and never matched the
-- "today"/"this week" filters. effective_posted falls back to first-seen
-- (last_seen is written at insert only), so every posting participates in
-- recency — display still shows only the true posted_at.

ALTER TABLE public.job_board_postings
  ADD COLUMN IF NOT EXISTS effective_posted timestamptz
  GENERATED ALWAYS AS (COALESCE(posted_at, last_seen)) STORED;

CREATE INDEX IF NOT EXISTS job_board_postings_effective_posted_idx
  ON public.job_board_postings (effective_posted DESC NULLS LAST, id);