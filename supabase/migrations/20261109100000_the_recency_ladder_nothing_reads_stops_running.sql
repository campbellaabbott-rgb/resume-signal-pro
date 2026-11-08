-- THE RECENCY LADDER NOTHING READS STOPS RUNNING (cost audit 2026-11-08,
-- db-cadence lane, "do first" #3).
--
-- 20260825230000 scheduled 'board-recency-ladder' every five minutes
-- ('2-59/5 * * * *'): refresh_recency_ladder() ranks up to 5,000 open
-- postings per board by effective posting date and upserts the result into
-- job_board_meta under k = 'recency_ladder'. Measured read-only from
-- get_cron_health on 2026-11-08: 288 runs a day, 9.8 s last, 17.9 s at most
-- over 24 hours and 31.8 s over seven days -- about 45 to 48 database minutes
-- a day, every day.
--
-- NOTHING READS WHAT IT WRITES. Searched on 2026-11-08 for the meta key, the
-- function names and the job name across this repository (the site, every
-- edge function including public-api, the scripts, the worker and the CI
-- workflows), the install repository and the ops repository: the only
-- mentions are the generated database types, the drizzle mirror of the
-- original migration, and recorded cron listings. And no anonymous caller
-- could read it in any case: job_board_meta has refused anon and
-- authenticated reads since 20260722154749 (a read-only probe on 2026-11-08
-- answered 42501).
--
-- WHAT THIS DOES: unschedules the job, by its name, and any job whose command
-- calls refresh_recency_ladder under another name (production has held jobs
-- no migration wrote before: 20261009100500). Nothing else.
--
-- KEPT, on purpose: board_recency_ladder(int, int), refresh_recency_ladder()
-- and the stored 'recency_ladder' row. If a reader ever arrives, re-arming is
-- one cron.schedule call in a new migration; the row stays as the last value
-- written, stamped with its own updated_at, so nothing can mistake it for a
-- live one.
--
-- Safe to re-run: each unschedule runs only for a job that exists in
-- cron.job, and where pg_cron is not installed there is nothing to remove.
-- The second block counts what is left and refuses to finish while any job
-- still runs the ladder, or while either function has gone. Nothing here
-- deletes the row, so nothing checks for it.

DO $$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; there is no recency-ladder schedule to remove';
    RETURN;
  END IF;

  FOR r IN
    SELECT j.jobid, j.jobname FROM cron.job j
     WHERE j.jobname = 'board-recency-ladder'
        OR j.command ~ 'refresh_recency_ladder[[:space:]]*\('
     ORDER BY j.jobid
  LOOP
    IF coalesce(r.jobname, '') <> '' THEN
      PERFORM cron.unschedule(r.jobname);
    ELSE
      PERFORM cron.unschedule(r.jobid);
    END IF;
    RAISE NOTICE 'unscheduled pg_cron job % (%), which refreshed the recency ladder nothing reads',
      r.jobid, coalesce(nullif(r.jobname, ''), 'unnamed');
  END LOOP;
END $$;

DO $$
DECLARE
  v_left int;
  v_which text;
BEGIN
  IF to_regprocedure('public.refresh_recency_ladder()') IS NULL THEN
    RAISE EXCEPTION 'self-check: refresh_recency_ladder() is gone; this migration only stops its schedule';
  END IF;
  IF to_regprocedure('public.board_recency_ladder(integer, integer)') IS NULL THEN
    RAISE EXCEPTION 'self-check: board_recency_ladder(integer, integer) is gone; this migration only stops its schedule';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  SELECT count(*), string_agg(coalesce(nullif(j.jobname, ''), 'job ' || j.jobid::text), ', ' ORDER BY j.jobid)
    INTO v_left, v_which
    FROM cron.job j
   WHERE j.jobname = 'board-recency-ladder'
      OR j.command ~ 'refresh_recency_ladder[[:space:]]*\(';
  IF v_left > 0 THEN
    RAISE EXCEPTION 'self-check: % pg_cron job(s) still refresh the recency ladder: %', v_left, v_which;
  END IF;
END $$;
