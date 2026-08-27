DO $guard$
BEGIN
  -- GUARDED: cron.unschedule RAISES when the job is absent, and several of these
  -- names are unscheduled by more than one migration. Unguarded, a fresh replay
  -- of this folder (supabase db reset, a staging rebuild, disaster recovery)
  -- aborts at the second one and no later migration applies. Production ran each
  -- of these once, successfully, which is why it was never noticed.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'build-work-mode-serving-idx') THEN
    PERFORM cron.unschedule('build-work-mode-serving-idx');
  END IF;
END
$guard$;
SELECT cron.schedule('build-work-mode-serving-idx', '* * * * *', 'CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_postings_work_mode_serving_idx ON public.job_board_postings (work_mode, effective_posted DESC) WHERE work_mode IS NOT NULL AND missing_since IS NULL');