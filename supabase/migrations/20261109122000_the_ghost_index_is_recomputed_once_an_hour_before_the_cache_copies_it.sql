-- lovable-cron-fallback-reviewed: no sub-hourly cron; every job this file schedules runs at most once an hour (reviewed 2026-11-16 by the project owner).
--
-- THE GHOST INDEX IS RECOMPUTED ONCE AN HOUR, BEFORE THE CACHE COPIES IT
-- (cost audit 2026-11-08, db-cadence lane, "do first" #7).
--
-- 'refresh-ghost-stats' has run refresh_ghost_stats() twice an hour
-- ('5,35 * * * *', 20260808190000), writing job_board_stats_rollup
-- k = 'ghost_stats'. The hourly stats cache (refresh-stats-cache, minute 27)
-- copies that row, and the cache is what the data pages and /v1/stats
-- publish -- so of the two runs an hour, the :35 one was superseded by the
-- next :05 before the cache ever took it, and only the Ghost Job Index's own
-- live read could see it.
--
-- THE GATE, CHECKED BEFORE BUILDING. The audit allowed this only while the
-- job's longest run stays under ten minutes. Read-only from get_cron_health on
-- 2026-11-08: ch_max_seconds 12.3 s over 24 hours and 16.1 s over seven days,
-- ch_last_seconds 7.9 s -- far inside it, so an hourly run cannot overlap the
-- next one or the :27 copy.
--
-- WHAT THIS DOES: alters the job in place to '15 * * * *' (its id and active
-- flag kept), twelve minutes before the :27 copy, so the cache takes a
-- figure at most about twelve minutes old where it used to take one about
-- twenty-two minutes old. The command keeps its SET statement_timeout =
-- '15min' in front of the call (20261004010000 put it there; a function's own
-- SET never times a cron run), and gets it back if it ever lost it.
--
-- PUBLISHED CADENCE. The Ghost Job Index's prerendered sentence already reads
-- "recomputed once an hour" (scripts/prerender-seo.mjs DATA_PAGE_CADENCE,
-- 'refresh-ghost-stats'). Until this file applies it understates the
-- twice-an-hour runs, which review 2026-11-15 accepted.
--
-- Safe to re-run: the alter runs only when the job exists in cron.job, and the
-- self-check reads it back.

DO $$
DECLARE
  v_id bigint;
  v_cmd text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; refresh-ghost-stats is not rescheduled';
    RETURN;
  END IF;
  SELECT j.jobid, j.command INTO v_id, v_cmd FROM cron.job j WHERE j.jobname = 'refresh-ghost-stats';
  IF v_id IS NULL THEN
    RAISE NOTICE 'no refresh-ghost-stats job here; nothing to reschedule';
    RETURN;
  END IF;
  IF v_cmd !~ '^[[:space:]]*SET statement_timeout' THEN
    v_cmd := 'SET statement_timeout = ''15min''; SELECT public.refresh_ghost_stats();';
  END IF;
  PERFORM cron.alter_job(v_id, schedule => '15 * * * *', command => v_cmd);
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
    FROM cron.job j WHERE j.jobname = 'refresh-ghost-stats';
  IF v_n = 0 THEN
    RETURN;
  END IF;
  IF v_n > 1 OR v_sched <> '15 * * * *' THEN
    RAISE EXCEPTION 'self-check: refresh-ghost-stats is % job(s) on %, want one on 15 * * * *', v_n, v_sched;
  END IF;
  IF v_cmd !~ '^[[:space:]]*SET statement_timeout' OR v_cmd !~ 'refresh_ghost_stats\(\)' THEN
    RAISE EXCEPTION 'self-check: refresh-ghost-stats command is not the timed call: %', v_cmd;
  END IF;
END $$;
