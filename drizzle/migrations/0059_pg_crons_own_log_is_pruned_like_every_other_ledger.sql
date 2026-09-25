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
-- (the space is reused inside the file); the one-time reclaim of the file is
-- a full rewrite of that one table, which the OWNER runs by hand, alone, in
-- a single dashboard SQL-editor run -- and nowhere else. It is not written
-- out here and must not be added here: this file executes inside the deploy
-- runner's single transaction, where such a rewrite raises 25001, and a
-- migration that fails is one the runner rewrites into something that does
-- not (20260827181000 records the one-shot that errored once a minute for
-- nine days). It does not belong in the cron body either, for the reason
-- 20260830200000 removed the scheduled one from postings. Nothing in this
-- file, comments included, is an instruction to run anything but the DO
-- block below.
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
