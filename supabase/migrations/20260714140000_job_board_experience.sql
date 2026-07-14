-- Experience-level filter for the job board.
--
-- Stores a per-posting experience band — one of entry / mid / senior / expert, or
-- 'unspecified' when the posting gives no signal — plus the cited minimum years
-- when the posting TEXT actually states one. The band is derived honestly
-- (explicit years in the text > title seniority > 'unspecified'); the logic lives
-- in job-board/experience.ts and runs at ingestion and in the backfill sweep.
-- NULL means "not yet computed" (a fresh column on existing rows); the backfill
-- fills those, after which every row is one of the five values above.
alter table public.job_board_postings
  add column if not exists experience_band text,
  add column if not exists min_years smallint;

-- Partial index: the filter always asks for a specific real band, and 'unspecified'
-- rows are never returned by it, so we only index the values people filter on.
create index if not exists idx_job_board_postings_experience
  on public.job_board_postings (experience_band)
  where experience_band is not null and experience_band <> 'unspecified';
