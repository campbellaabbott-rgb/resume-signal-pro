-- GUARDED. cron.unschedule RAISES when the job does not exist, and
-- 20260821230000 had already removed this one — so a fresh replay of this folder
-- (supabase db reset, a staging rebuild, disaster recovery) aborted HERE and no
-- later migration applied. Already applied in production, where it succeeded;
-- this edit only affects replays, which is the case it broke.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oneshot_company_simple_fts_idx') THEN
    PERFORM cron.unschedule('oneshot_company_simple_fts_idx');
  END IF;
END $$;