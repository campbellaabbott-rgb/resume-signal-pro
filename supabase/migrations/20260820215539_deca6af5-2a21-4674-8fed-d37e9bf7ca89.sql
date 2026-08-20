DROP FUNCTION IF EXISTS public.search_jobs(
  p_q text, p_fresh_cutoff timestamptz, p_location text, p_remote boolean,
  p_country text, p_category text, p_experience text[], p_salary_floor numeric,
  p_companies text[], p_posted_after timestamptz, p_max_age_days integer,
  p_work_mode text, p_limit integer, p_offset integer
);

DROP FUNCTION IF EXISTS public.count_jobs_capped(
  p_fresh_cutoff timestamptz, p_q text, p_location text, p_remote boolean,
  p_country text, p_category text, p_experience text[], p_salary_floor numeric,
  p_companies text[], p_posted_after timestamptz, p_max_age_days integer,
  p_work_mode text, p_cap integer
);