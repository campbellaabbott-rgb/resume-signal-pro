ALTER TABLE public.job_board_postings
  ADD COLUMN IF NOT EXISTS employment_type text
  CHECK (employment_type IN ('full_time','part_time','contract','temporary','internship'));

COMMENT ON COLUMN public.job_board_postings.employment_type IS
  'Employment type from the vendor''s STRUCTURED field only (nine vendors carry one); NULL = not stated. Closed domain full_time|part_time|contract|temporary|internship. Filled at ingest; existing rows fill as rotation re-ingests them (~a wrap).';