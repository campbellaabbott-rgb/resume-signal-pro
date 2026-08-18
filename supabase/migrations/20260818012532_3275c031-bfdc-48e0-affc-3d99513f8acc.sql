CREATE OR REPLACE FUNCTION public.build_sitemap_day_index_oneshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '600s'
AS $$
BEGIN
  PERFORM cron.unschedule('build-sitemap-day-index-oneshot');

  CREATE INDEX IF NOT EXISTS job_board_postings_sitemap_day_idx
    ON public.job_board_postings (posted_at, id)
    WHERE missing_since IS NULL AND posted_at IS NOT NULL;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'build-sitemap-day-index-oneshot') THEN
    PERFORM cron.schedule(
      'build-sitemap-day-index-oneshot',
      '* * * * *',
      'SELECT public.build_sitemap_day_index_oneshot();'
    );
  END IF;
END $$;