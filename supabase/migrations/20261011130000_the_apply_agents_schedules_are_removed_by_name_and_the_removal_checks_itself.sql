-- THE APPLY AGENT'S SCHEDULES ARE REMOVED BY NAME, AND THE REMOVAL CHECKS
-- ITSELF (wave 4, the apply pivot; owner decision 2026-10-11).
--
-- The server-side apply agent is switched off: people apply themselves
-- through their own AI, and nothing is submitted for them. The functions
-- refuse to work while APPLY_AGENT_ON (supabase/functions/_shared/
-- apply-agent-switch.ts) is off; this migration stops the database calling
-- them at all.
--
-- REMOVED, by name:
--   apply-agent-hourly     apply-agent at :23 every hour (prepare, release,
--                          wake a worker)
--   agent-runner-nightly   agent-runner at 06:10 UTC (fill the morning queue)
--
-- apply-broker never had a pg_cron job in any migration: a worker calls it,
-- and the worker's own schedule was the GitHub Actions backstop, removed from
-- .github/workflows/apply-worker.yml in the same change. In case production
-- holds a job no migration wrote (it has before: 20261009100500), any job
-- whose command posts to /functions/v1/apply-agent, /apply-broker or
-- /agent-runner is removed as well, by its name, or by its id when it has
-- none, and named in a notice.
--
-- LEFT ALONE, on purpose:
--   agent-queue-retention  SQL only: expires and prunes the queue, which is
--                          what keeps old rows from lingering now that
--                          nothing fills it;
--   send-agent-digest      mails only a mandate with picks waiting, and the
--                          queue is no longer filled;
--   reconcile-stripe       existing buyers' payments are still reconciled.
--
-- The dormant schedules stay in their own migrations as the record of how to
-- re-arm them; re-arming is a new migration, never an edit to this one.
--
-- Safe to re-run: each unschedule runs only for a job that exists, and where
-- pg_cron is not installed there is nothing to remove. The second block counts
-- what is left and refuses to finish while any job still runs the agent.

DO $$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; there is no apply-agent schedule to remove';
    RETURN;
  END IF;

  FOR r IN
    SELECT j.jobname FROM cron.job j
     WHERE j.jobname IN ('apply-agent-hourly', 'agent-runner-nightly')
     ORDER BY j.jobname
  LOOP
    PERFORM cron.unschedule(r.jobname);
    RAISE NOTICE 'unscheduled %', r.jobname;
  END LOOP;

  FOR r IN
    SELECT j.jobid, j.jobname FROM cron.job j
     WHERE j.command ~ '/functions/v1/(apply-agent|apply-broker|agent-runner)([^A-Za-z0-9_-]|$)'
     ORDER BY j.jobid
  LOOP
    IF coalesce(r.jobname, '') <> '' THEN
      PERFORM cron.unschedule(r.jobname);
    ELSE
      PERFORM cron.unschedule(r.jobid);
    END IF;
    RAISE NOTICE 'unscheduled pg_cron job % (%), which still posted to the apply agent', r.jobid, coalesce(nullif(r.jobname, ''), 'unnamed');
  END LOOP;
END $$;

DO $$
DECLARE
  v_left int;
  v_which text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  SELECT count(*), string_agg(coalesce(nullif(j.jobname, ''), 'job ' || j.jobid::text), ', ' ORDER BY j.jobid)
    INTO v_left, v_which
    FROM cron.job j
   WHERE j.jobname IN ('apply-agent-hourly', 'agent-runner-nightly')
      OR j.command ~ '/functions/v1/(apply-agent|apply-broker|agent-runner)([^A-Za-z0-9_-]|$)';
  IF v_left > 0 THEN
    RAISE EXCEPTION 'self-check: % pg_cron job(s) still run the apply agent: %', v_left, v_which;
  END IF;
END $$;
