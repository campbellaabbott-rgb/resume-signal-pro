-- SUB-HOURLY CRON REVIEW MARKER: not required. This file schedules nothing; it
-- removes two sub-hourly jobs (reviewed 2026-11-16 under the owner's
-- instruction "we need maximum cost savings").
--
-- TWO SCHEDULED CALLS NOTHING READS STOP RUNNING (cost wave 2, 2026-11-16,
-- plan item BN-1: INV-1 and INV-2).
--
-- Both jobs were created outside the migrations, in the dashboard, so no file
-- here ever scheduled them; they are found and removed by name.
--
-- 'warm-up-edge-functions' (every 10 minutes, 144 calls a day) posts to the
-- warm-up function. Since warm-up 2026-11-09.2 a full warm needs the owner's
-- key and a keyless call is answered before it invokes anything
-- (supabase/functions/warm-up/index.ts, the keyless refusal), so a keyless
-- job warms nothing; with a key it warms 16 functions for a measured gain of
-- at most ~90 ms. The scan button's warm of the one function it is about to
-- call is a separate, unscheduled request and is untouched.
--
-- 'scheduled-health-probe-every-5min' (every 5 minutes, 288 calls a day)
-- posts to scheduled-health-probe. Keyless, it answers from the database and
-- nobody reads the answer; with a key it adds a Stripe balance call, an
-- empty-message AI gateway call and a heartbeat row, and raises no alert.
-- scan-heartbeat already probes the database, the AI gateway and Stripe and
-- is the job mail-watch watches; 20260706050000 meant this probe to stay a
-- manual diagnostic, never a schedule. Its past heartbeat rows are kept.
--
-- SAVES 432 edge invocations a day (2,736 if either carried a key, since a
-- keyed warm-up fans out to 16 functions) and 432 pg_cron wake-ups a day.
-- Both functions stay deployed, callable by hand as before.
--
-- UNDO: one cron.schedule call per job, in a new migration or the SQL editor.
-- The NOTICE below prints each job's id, name and schedule before it goes, but
-- not its command: a job made in the dashboard may carry a key in its text,
-- and a migration's output is no place for one.
--
-- Safe to re-run: a job that is already gone is skipped, and where pg_cron is
-- not installed there is nothing to remove. The second block refuses to
-- finish while either job is still scheduled.

DO $$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; there is no warm-up or probe schedule to remove';
    RETURN;
  END IF;

  FOR r IN
    SELECT j.jobid, j.jobname, j.schedule, j.active
      FROM cron.job j
     WHERE j.jobname IN ('warm-up-edge-functions', 'scheduled-health-probe-every-5min')
     ORDER BY j.jobid
  LOOP
    RAISE NOTICE 'unscheduling pg_cron job % (%), schedule %, active %: its posts are read by nothing',
      r.jobid, r.jobname, r.schedule, r.active;
    PERFORM cron.unschedule(r.jobid);
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
  SELECT count(*), string_agg(j.jobname, ', ' ORDER BY j.jobid)
    INTO v_left, v_which
    FROM cron.job j
   WHERE j.jobname IN ('warm-up-edge-functions', 'scheduled-health-probe-every-5min');
  IF v_left > 0 THEN
    RAISE EXCEPTION 'self-check: % job(s) still scheduled: %', v_left, v_which;
  END IF;
END $$;
