-- lovable-cron-fallback-reviewed: refresh-board-facets keeps its existing every-15-minute schedule (only its minutes move, from 7,22,37,52 to 2,17,32,47); reviewed 2026-11-16 by the project owner; load falls, as a tick now rebuilds only a row the board pass left more than 40 minutes old.
-- reviewed: 2026-11-16 by the project owner, who approves this schedule as written.
-- job: refresh-board-facets (scheduled since 20260801000000).
-- schedule: '7,22,37,52 * * * *' today -> '2,17,32,47 * * * *' after this file.
--   Same frequency (every 15 minutes); only the minutes move.
-- why sub-hourly: the /jobs filter counts must stay under about 55 minutes
--   old between board passes. scan-heartbeat flags the row at 90 minutes, and
--   one tick an hour would let it reach about 105 minutes (reasoning below).
-- load: lower than today. A tick now rebuilds the row only when nothing has
--   written it for 40 minutes (at most 32 rebuilds a day instead of 96); a
--   skipped tick reads one row and stops.
-- new standing sub-hourly jobs: none.
--
-- THE FACETS CRON REBUILDS ONLY A ROW THE BOARD PASS LEFT OLD (cost audit
-- 2026-11-08, db-cadence lane, "do first" #5).
--
-- refresh_job_board_facets() rebuilds job_board_meta k = 'facets' (the /jobs
-- filter rail's counts) and stamps updated_at only when it succeeds. Two
-- callers write that row: the job-board pass end, after every completed
-- pass, and the 'refresh-board-facets' cron, which 20260801000000 set to every
-- fifteen minutes ('7,22,37,52 * * * *') whether or not the pass had just
-- done it. Measured read-only from get_cron_health on 2026-11-08: 96 cron runs
-- a day, 6.2 s last, 10.8 s at most over 24 hours and 37.8 s over seven days.
--
-- WHAT THIS DOES. The cron keeps its quarter-hour ticks, moved off minute 7
-- (the explore refresh, the host sweep and the error-spike check all start
-- there) to '2,17,32,47 * * * *', and its command now rebuilds the row only
-- when NO caller has written it in the last 40 minutes. The pass-end call
-- inside job-board is untouched. The command keeps its own
-- statement_timeout = '10min' in front, because a function's SET never times
-- a cron run (20261003220000).
--
-- WHY 40 MINUTES ON QUARTER TICKS, AND NOT ONE TICK AN HOUR. The audit asked
-- for ':52 hourly, gated at 45 minutes'. That lets the row reach about 105
-- minutes old (a pass-end write at :08 holds the :52 tick off, and the next
-- tick is an hour later), and scan-heartbeat degraded the
-- job_board_facets_cache check past 60 minutes -- a simulation over a day of
-- pass ends put that at about 18 false 'degraded' readings a day. On quarter
-- ticks a 40-minute gate skips at most two ticks in a row, so the row is never
-- older than about 55 minutes, and the cron runs at most every 45 minutes when
-- the pass is quiet: 32 runs a day at most instead of 96, fewer whenever the
-- pass end has written the row. scan-heartbeat 2026-11-09.1 judges the row
-- against 90 minutes (FACETS_STALE_MIN), so two missed rebuilds still read
-- healthy; until that build serves, its 60-minute bound has about five
-- minutes to spare. If the bound is ever raised to two hours, the hourly form
-- can follow.
--
-- THE FIFTEEN-MINUTE PROSE THIS SUPERSEDES lives only in applied migrations
-- and is not edited (applied files are never changed): 20260801000000's
-- "Every 15 minutes" beside the original schedule, 20261009100100's
-- "(refresh-board-facets, every 15 minutes)", and 20261009100200's "rebuilt
-- by the 'refresh-board-facets' cron within 15 minutes". From this file on,
-- the row is rebuilt by the pass end or, failing that, within 55 minutes.
--
-- Safe to re-run: the job is altered in place (its id and active flag kept)
-- only when it exists in cron.job, scheduled once when it does not, and the
-- self-check reads the one job back.

DO $$
DECLARE
  v_id bigint;
  v_cmd constant text :=
    'SET statement_timeout = ''10min''; '
    || 'SELECT public.refresh_job_board_facets() '
    || 'WHERE NOT EXISTS (SELECT 1 FROM public.job_board_meta m '
    || 'WHERE m.k = ''facets'' AND m.updated_at >= now() - interval ''40 minutes'');';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; refresh-board-facets is not scheduled';
    RETURN;
  END IF;

  SELECT j.jobid INTO v_id FROM cron.job j WHERE j.jobname = 'refresh-board-facets';
  IF v_id IS NOT NULL THEN
    PERFORM cron.alter_job(v_id, schedule => '2,17,32,47 * * * *', command => v_cmd);
  ELSE
    PERFORM cron.schedule('refresh-board-facets', '2,17,32,47 * * * *', v_cmd);
  END IF;
END $$;

DO $$
DECLARE
  v_n int;
  v_sched text;
  v_cmd text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  SELECT count(*), max(j.schedule), max(j.command) INTO v_n, v_sched, v_cmd
    FROM cron.job j WHERE j.jobname = 'refresh-board-facets';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'self-check: % pg_cron jobs named refresh-board-facets, want exactly one', v_n;
  END IF;
  IF v_sched <> '2,17,32,47 * * * *' THEN
    RAISE EXCEPTION 'self-check: refresh-board-facets runs on %, want 2,17,32,47 * * * *', v_sched;
  END IF;
  IF v_cmd NOT LIKE 'SET statement_timeout = ''10min''; %'
     OR v_cmd !~ 'refresh_job_board_facets\(\)'
     OR v_cmd !~ 'NOT EXISTS'
     OR v_cmd !~ 'interval ''40 minutes''' THEN
    RAISE EXCEPTION 'self-check: refresh-board-facets command is not the gated, timed form: %', v_cmd;
  END IF;
END $$;
