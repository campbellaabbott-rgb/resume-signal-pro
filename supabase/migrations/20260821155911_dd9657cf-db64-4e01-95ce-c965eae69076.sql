DO $guard$
BEGIN
  -- GUARDED: cron.unschedule RAISES when the job is absent, and several of these
  -- names are unscheduled by more than one migration. Unguarded, a fresh replay
  -- of this folder (supabase db reset, a staging rebuild, disaster recovery)
  -- aborts at the second one and no later migration applies. Production ran each
  -- of these once, successfully, which is why it was never noticed.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oneshot_title_simple_fts_idx') THEN
    PERFORM cron.unschedule('oneshot_title_simple_fts_idx');
  END IF;
END
$guard$;
SELECT cron.schedule(
  'oneshot_title_simple_fts_idx',
  '* * * * *',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_postings_title_simple_fts_idx ON public.job_board_postings USING gin (to_tsvector(''simple'', title))'
);