alter table public.job_board_postings
  add column if not exists experience_band text,
  add column if not exists min_years smallint;

create index if not exists idx_job_board_postings_experience
  on public.job_board_postings (experience_band)
  where experience_band is not null and experience_band <> 'unspecified';