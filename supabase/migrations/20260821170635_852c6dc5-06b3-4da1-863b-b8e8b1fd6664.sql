DO $guard$
BEGIN
  -- GUARDED: cron.unschedule RAISES when the job is absent, and several of these
  -- names are unscheduled by more than one migration. Unguarded, a fresh replay
  -- of this folder (supabase db reset, a staging rebuild, disaster recovery)
  -- aborts at the second one and no later migration applies. Production ran each
  -- of these once, successfully, which is why it was never noticed.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oneshot_company_simple_fts_idx') THEN
    PERFORM cron.unschedule('oneshot_company_simple_fts_idx');
  END IF;
END
$guard$;