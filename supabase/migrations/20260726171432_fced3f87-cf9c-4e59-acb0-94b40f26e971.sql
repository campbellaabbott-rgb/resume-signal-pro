CREATE OR REPLACE FUNCTION public.build_speed_indexes_oneshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '600s'
AS $$
BEGIN
  PERFORM cron.unschedule('build-speed-indexes-oneshot');
  CREATE INDEX IF NOT EXISTS job_board_postings_location_trgm_idx
    ON public.job_board_postings USING gin (location gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS job_board_postings_salary_sort_idx
    ON public.job_board_postings (salary_rank_usd DESC NULLS LAST, id ASC);
END;
$$;

SELECT cron.schedule('build-speed-indexes-oneshot', '* * * * *', 'SELECT public.build_speed_indexes_oneshot();');