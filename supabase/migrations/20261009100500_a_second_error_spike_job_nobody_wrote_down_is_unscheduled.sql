-- A SECOND ERROR-SPIKE JOB NOBODY WROTE DOWN IS UNSCHEDULED (S11 sweep,
-- jobboard-runtime group).
--
-- Production runs a pg_cron job named 'check-error-spikes-every-15-min' that
-- no migration defines. It fires every 15 minutes beside 20261008128000's
-- 'check-error-spikes' ('7-59/15 * * * *'), so the function is called twice a
-- quarter hour: once with the alerts cron key, once by a command nobody can
-- read in the repo. A job that is not in a migration cannot be reviewed, is not
-- in the ledger, and survives every fix made to the one that is.
--
-- This unschedules the drifted job by its NAME and nothing else. The written
-- job, 'check-error-spikes', is left exactly as 20261008128000 made it.
--
-- Safe to re-run: the unschedule runs only while the job exists. Where pg_cron
-- is not installed there is nothing to remove. The second block checks the
-- result and refuses to finish while a job of that name survives.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; there is no drifted error-spike job to remove';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-error-spikes-every-15-min') THEN
    PERFORM cron.unschedule('check-error-spikes-every-15-min');
  END IF;
END $$;

DO $$
DECLARE
  v_left int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  SELECT count(*) INTO v_left FROM cron.job WHERE jobname = 'check-error-spikes-every-15-min';
  IF v_left > 0 THEN
    RAISE EXCEPTION 'self-check: % pg_cron job(s) named check-error-spikes-every-15-min still scheduled', v_left;
  END IF;
END $$;
