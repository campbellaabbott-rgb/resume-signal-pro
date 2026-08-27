-- Two "one-shot" VACUUM jobs have been running against the board's largest table
-- for weeks. Neither can stop on its own.
--
-- oneoff-vacuum-jbp — scheduled every minute on 20260812153644, correctly
-- unscheduled on 20260812155233, and then RE-SCHEDULED on 20260812155333 at
-- '*/10 * * * *' with no unschedule anywhere after it. So since 2026-08-12 a
-- pg_cron worker has started a full VACUUM (ANALYZE) over job_board_postings
-- every ten minutes — a table that has grown to ~708k rows in that time. It
-- takes a ShareUpdateExclusiveLock and competes for I/O with the refresh
-- rotation and with every query serving the board.
--
-- oneshot-vacuum-postings — scheduled every minute on 20260818002343 with a body
-- that ends `select cron.unschedule('oneshot-vacuum-postings')`, so it was meant
-- to remove itself after one run. It cannot. pg_cron runs a job body inside a
-- transaction, and VACUUM is not allowed in a transaction block: the statement
-- raises 25001, the whole body aborts, and the unschedule never executes. The
-- job is therefore immortal, and has been failing once a minute — roughly 13,000
-- times — since 2026-08-18, each attempt spawning a worker and a connection.
--
-- The intent behind both was legitimate: after the 2026-08-12 bulk churn the
-- table needed a vacuum. That job is long done, and autovacuum handles the
-- steady state — which is exactly why these were written as one-shots.
--
-- GUARDED, because cron.unschedule RAISES when the job does not exist. An
-- unguarded call is the defect 20260822003006 already carries: it unschedules a
-- job an earlier migration had already removed, so any fresh replay of this
-- folder — `supabase db reset`, a staging rebuild, disaster recovery — aborts
-- there and every later migration never applies. This one cannot do that to the
-- next person.
DO $$
DECLARE j text;
BEGIN
  FOREACH j IN ARRAY ARRAY['oneoff-vacuum-jbp', 'oneshot-vacuum-postings'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN
      PERFORM cron.unschedule(j);
      RAISE NOTICE 'unscheduled runaway vacuum job %', j;
    END IF;
  END LOOP;
END $$;

-- Self-verifying: neither may remain scheduled.
DO $$
DECLARE still text;
BEGIN
  SELECT string_agg(jobname, ', ') INTO still
    FROM cron.job
   WHERE jobname IN ('oneoff-vacuum-jbp', 'oneshot-vacuum-postings');
  IF still IS NOT NULL THEN
    RAISE EXCEPTION 'vacuum job(s) still scheduled after unschedule: %', still;
  END IF;
END $$;

-- NOT TOUCHED, deliberately: `ALTER ROLE postgres SET statement_timeout = '30min'`
-- from 20260812155333, which was the companion to the vacuum job and was never
-- reset. Other maintenance scheduled here sets its own timeout inside the job
-- body, but the role default is a global with a blast radius I cannot measure
-- from the migration folder, and it is not itself causing the harm above.
-- Removing it is a separate, deliberate decision.
