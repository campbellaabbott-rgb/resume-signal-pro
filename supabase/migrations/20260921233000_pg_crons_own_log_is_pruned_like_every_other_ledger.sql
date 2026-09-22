-- pg_cron's own log is pruned like every other ledger
--
-- Measured 2026-09-18 (the storage read, step 9a): cron.job_run_details held
-- 238,465 rows back to 2025-12-23 in 151 MB, and no migration had ever pruned
-- it -- 77k rows from a five-minute health probe, 39k from the warm-up, 17k
-- from jobs that no longer exist. Nothing serves from it. The ops runbook
-- reads it to diagnose a cron, and no diagnosis has needed more than the last
-- few days; seven is the window Supabase's own pg_cron page schedules.
--
-- DELETE only, on purpose. Deleting rows returns nothing to the disk figure
-- (the space is reused inside the file); the one-time reclaim is a
-- `VACUUM (FULL) cron.job_run_details;` the operator runs ALONE in one
-- SQL-editor run. It cannot live here: this file executes inside the deploy
-- runner's single transaction, where VACUUM raises 25001 -- and a migration
-- that fails is one the runner rewrites into something that does not
-- (20260827181000 records the vacuum one-shot that errored once a minute for
-- nine days). It cannot live in the cron body either, for the same reason a
-- scheduled VACUUM was removed from postings in 20260830200000.
--
-- cron.schedule on an existing job name updates it in place (pg_cron 1.6), so
-- this is idempotent and a re-emitted copy of this file does the same thing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule(
      'cron-log-retention', '15 4 * * *',
      $job$ DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'; $job$);
  END IF;
END $$;
