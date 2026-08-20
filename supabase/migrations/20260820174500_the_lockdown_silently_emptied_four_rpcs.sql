-- MY LOCK MIGRATION SAID "WHAT BREAKS: nothing". IT BROKE FOUR FUNCTIONS.
--
-- 20260818110000_the_moat_was_open.sql dropped the public SELECT policy on
-- job_board_closures — correct, the raw lifecycle log should never have been
-- anon-readable. Its comment then asserted:
--
--     "WHAT BREAKS: nothing. ... every public surface that uses closure data
--      is a SECURITY DEFINER aggregate that bypasses RLS by design"
--
-- That was checked by READING, not by running. Four anon-granted functions read
-- closure data as SECURITY INVOKER, so under the new policy they see zero rows
-- there — and none of them errors.
--
-- MEASURED live 2026-08-20 with the anon key:
--   get_hiring_trends       returns ONE row, closed 0. Its `epoch` CTE takes
--                           min(closed_at); with no visible rows that is NULL,
--                           the week series collapses to the current week and
--                           the closes join contributes nothing. /hiring-trends
--                           rendered a single bar and a "Filled or closed"
--                           series flat at zero.
--   get_trending_categories returns prior7 NULL on all 15 rows — the
--                           week-over-week comparison is gated on the same
--                           min(closed_at), so every field delta showed "-".
--   get_takedowns_today     returns 0, while get_board_flow reported ~14,500
--                           closures in the same 24 hours. The published value
--                           is a bare "0", which is maximally believable.
--   get_ghost_job_index_stats  still returns real data (closed_90d 389,244,
--                           observed_days 37) — but ONLY because its live path
--                           reads a service-role-populated cache. The direct
--                           closure read behind that cache carries the same
--                           defect, so the day the cache stalls it publishes
--                           zeros instead of failing. Latent, not safe.
--
-- DECISIVE CONTROL, same table, same minute, anon key: get_employer_benchmarks
-- is SECURITY DEFINER and reports observed_days 37. So min(closed_at) really is
-- 37 days back; the only difference is DEFINER vs INVOKER under RLS.
--
-- THE FAILURE MODE IS THE POINT. All four returned HTTP 200 with well-formed
-- JSON. A permission failure arriving as an empty AGGREGATE is indistinguishable
-- from "the data says zero", so public pages published "no roles filled or
-- closed" as a finding about the labour market, for two days, with nothing red
-- anywhere. I checked these RPCs right after the lockdown, saw 200s, and moved
-- on. The 200 was the whole trap.
--
-- ALTER FUNCTION, NOT CREATE OR REPLACE, AND THAT MATTERS HERE.
--
-- The obvious way to write this is to paste each body back with the mode
-- changed. I started that way and it nearly caused a real regression: the
-- LAST-SORTING definition of get_ghost_job_index_stats is not the deployed one.
-- Lovable re-stamps migrations, so a hash-named file can sort earlier while
-- carrying newer SQL — the runbook records this exact trap. The body I picked
-- up predates the stats-rollup fix and recomputes percentiles inline, which is
-- what caused the 57014 timeouts that froze the stats cache for four days. A
-- test caught it ("the reader must read the rollup, not recompute"), but only
-- because that guard happened to exist.
--
-- ALTER FUNCTION ... SECURITY DEFINER changes the mode and touches nothing
-- else. No body is transcribed, so no body can be reverted. It is also the
-- honest expression of the change: the logic was never wrong.
--
-- All four aggregate — counts, medians, min() — and none returns a raw closure
-- row, which is the standard that makes DEFINER appropriate rather than a hole.

ALTER FUNCTION public.get_hiring_trends() SECURITY DEFINER;
ALTER FUNCTION public.get_trending_categories() SECURITY DEFINER;
ALTER FUNCTION public.get_takedowns_today() SECURITY DEFINER;
ALTER FUNCTION public.get_ghost_job_index_stats() SECURITY DEFINER;

-- Belt and braces: a DEFINER function without a pinned search_path is its own
-- vulnerability, and these are now DEFINER. Re-pinning is idempotent and cheap,
-- and it means this migration cannot leave one in that state even if some
-- future redefinition drops the SET clause.
ALTER FUNCTION public.get_hiring_trends() SET search_path = public;
ALTER FUNCTION public.get_trending_categories() SET search_path = public;
ALTER FUNCTION public.get_takedowns_today() SET search_path = public;
ALTER FUNCTION public.get_ghost_job_index_stats() SET search_path = public;
