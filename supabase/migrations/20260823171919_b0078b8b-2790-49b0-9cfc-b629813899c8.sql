CREATE INDEX IF NOT EXISTS idx_job_board_postings_other_by_id
  ON public.job_board_postings (id)
  WHERE category = 'other';