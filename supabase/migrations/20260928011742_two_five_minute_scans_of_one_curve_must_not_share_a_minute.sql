-- TWO FIVE-MINUTE SCANS OF ONE CURVE MUST NOT SHARE A MINUTE.
--
-- get_category_fill_curve(90, 300) is computed by two hourly crons:
-- refresh_explore_cache at minute 7 (fifteen-minute header; its rows land in
-- explore_cache.field_curves, which no page has rendered since Explore dropped
-- its field-grain lifecycle line) and, from 20260928004823, refresh_stats_cache
-- as its eighth and last part. refresh_stats_cache ran at minute 12: the seven
-- parts before the curve took about twelve seconds of wall time on 2026-09-28
-- (root stamp 00:12:00Z, the leaderboard part's own stamp 00:12:11Z), so its
-- curve call began at about :12:12 -- five minutes after explore's run
-- started, inside the five-minute header 20260928003117 gave the function.
-- The last complete reading of the curve was 47s and the next three did not
-- complete inside a minute, so the true wall time is unknown and rising; two
-- concurrent copies of the heaviest scan on the box is the one mechanism that
-- could push the cron-path call past its own header, which would carry
-- fill_curve forward every hour (visibly stale, never fresh) and, on a first
-- run, leave the pages at "not yet computed".
--
-- THIS FILE MOVES ONE JOB AND NOTHING ELSE. refresh-stats-cache runs at minute
-- 27: explore's outer header (900s) ends its worst run by :22, and the stats
-- run's own header (600s, 20260928004823) ends by :37, before the next explore
-- at :07 -- neither window can overlap the other, in either direction. Minute
-- 27 collides with no other hourly job in this lane (5 and 35 for the index
-- stats, 7/22/37/52 facets, 17 the layoff feed, 37 transparency, 22 on every
-- sixth hour the explore role rows). The job command is the 20260808191630
-- text unchanged: no wrapper timeout, the function's own header governs. The
-- cadence a page may claim is unchanged -- once an hour -- and
-- a-data-page-that-serves-no-number-is-an-empty-page derives that phrase from
-- the last schedule in this lane, which is now this file.
--
-- Taking away explore's own copy of the call (a re-issue of
-- refresh_explore_cache without its field-curve block) is the deliberate next
-- step and touches a fifteen-minute definer with pinned tests of its own; this
-- file removes only the overlap. Guarded by the same pg_cron-absent check every
-- schedule in this lane carries, so a replay without the extension is a no-op.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron absent -- refresh_stats_cache keeps whatever schedule the host gives it';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-stats-cache') THEN
    PERFORM cron.unschedule('refresh-stats-cache');
  END IF;
  PERFORM cron.schedule('refresh-stats-cache', '27 * * * *',
    $job$ SELECT public.refresh_stats_cache(); $job$);
END $$;
