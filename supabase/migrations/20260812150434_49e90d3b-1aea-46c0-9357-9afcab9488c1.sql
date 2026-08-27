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
COMMENT ON INDEX public.job_board_postings_work_mode_serving_idx IS
  'Serves the work-mode filtered count. Carries BOTH serving predicates: work_mode IS NOT NULL and missing_since IS NULL in the partial clause, effective_posted as the range column. The older work_mode_posted_idx omits missing_since, which forced a heap fetch per candidate row and timed out count_jobs_capped on every work mode (measured 2026-08-12).';