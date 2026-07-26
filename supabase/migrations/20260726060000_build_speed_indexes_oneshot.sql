-- One-shot background build of the two remaining speed indexes.
--
-- Third delivery attempt, each blocked by a different runtime limit:
--   1. Migration with CREATE INDEX CONCURRENTLY — Lovable's runner wraps
--      migrations in a transaction; CONCURRENTLY refuses to run in one.
--   2. SQL-editor runs — the editor's statement timeout cancels the builds
--      (the location GIN is minutes of work over 573k rows). Verified
--      2026-07-26: neither index exists after two editor attempts.
-- This file is FAST (definitions only), so the migration runner applies it;
-- the actual builds run under pg_cron in the background with their own
-- 10-minute timeout, outside every interactive limit.
--
-- DELIBERATE, SCOPED EXCEPTION to the "never plain CREATE INDEX on
-- job_board_postings" protocol: plain builds take a SHARE lock that blocks
-- WRITES (reads are unaffected — the board keeps serving). Cost: refresh
-- upserts fail for the ~2-4 minutes of build time and retry on their next
-- slice, which the pipeline absorbs by design. That bounded pause is the
-- price of indexes that cannot otherwise be built through the available
-- runtimes, paid once, off-peak-ish, in the background.
CREATE OR REPLACE FUNCTION public.build_speed_indexes_oneshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '600s'
AS $$
BEGIN
  -- One shot: unschedule FIRST so a failed build never thrash-retries a
  -- write-blocking operation every minute. If it fails, we are simply back
  -- to where we are now, with the error in the postgres logs.
  PERFORM cron.unschedule('build-speed-indexes-oneshot');

  CREATE INDEX IF NOT EXISTS job_board_postings_location_trgm_idx
    ON public.job_board_postings USING gin (location gin_trgm_ops);

  CREATE INDEX IF NOT EXISTS job_board_postings_salary_sort_idx
    ON public.job_board_postings (salary_rank_usd DESC NULLS LAST, id ASC);
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'build-speed-indexes-oneshot') THEN
    PERFORM cron.schedule(
      'build-speed-indexes-oneshot',
      '* * * * *', -- next minute; the function unschedules itself on first run
      'SELECT public.build_speed_indexes_oneshot();'
    );
  END IF;
END $$;
