-- THE FIELD CURVE THE PAGE WAITED A MINUTE FOR JOINS THE HOURLY CACHE.
--
-- Two data pages compute get_category_fill_curve live on every visit:
-- src/pages/GhostJobIndex.tsx at (90, 300) and src/pages/Jobs.tsx with no
-- arguments, which resolve to the same (90, 300) because those are the
-- function's defaults -- one variant, so one cache key serves both. The call
-- answered in 34s on 2026-09-25 and stopped answering inside its sixty-second
-- header on 2026-09-27 (47s at 14:xx; the full minute and no rows at 18:xx and
-- 23:xx, 57014). Each page holds the call inside a caught Promise.all, so a
-- timeout does not shorten the section, it removes it. The companion
-- migration 20260928003117 raises the function's own header to five minutes;
-- this file gives the rows a place a page can read in under a second.
--
-- THE SHAPE IS THE SEVENTH PART'S SHAPE, for the reason 20260909228000 gave:
--
--     fill_curve: { computed_at: <when THESE rows were computed>,
--                   variant:     { p_days: 90, p_min_n: 300 },
--                   rows:        [ ...get_category_fill_curve(90, 300)... ] }
--
-- The rows are stored whole, in the function's own thirty column names, so
-- the Ghost Job Index (which reads the day-30 columns), /jobs (which reads the
-- day-14 columns) and /v1 (which maps twelve of them) all read one object.
-- The stamp is the part's own, not the row's: on a healthy run it is this
-- run's clock; on a run where the curve fails the previous object is carried
-- forward WHOLE -- rows, variant and stamp together -- and the part is named
-- in stale_parts, so a carried copy dates itself to the run that produced it
-- and a page can print that date and say "carried" beside it. A first run
-- that fails has nothing to carry and writes a JSON null under the key, which
-- a reader renders as "not yet computed", never as an error.
--
-- THE FAILURE IS RECORDED, NOT JUST NAMED. stale_parts says WHICH part was
-- carried; a second key beside it says WHY, because the two timers that can
-- fire here (the callee's five minutes, this function's ten) and an empty
-- answer are three different events with one consequence, and the verifier
-- should not have to guess which one it is looking at:
--
--     fill_curve_error: { at, reason: 'query_canceled' | 'error' | 'empty',
--                         sqlstate, message }
--
-- The payload is assembled fresh every run, so the key is present exactly
-- when THIS run's curve failed and absent when it did not; the history is in
-- cron.job_run_details. The seven existing parts are not touched by any of
-- this: the block is isolated in its own BEGIN/EXCEPTION, both arms are named
-- (a bare OTHERS arm does not catch a statement timeout, 20260812220000), and
-- the row is written unconditionally after it, as before.
--
-- THE BLOCK SITS LAST, AND THE HEADER RISES TO TEN MINUTES. Last, so the
-- curve's cost -- the largest ceiling in this function by a factor of five --
-- can never delay the seven parts a visitor's tiles paint from, and so that
-- if the outer timer is the one that fires, it fires inside this block's
-- handler with the seven parts already computed. Ten minutes, because the
-- budget is derived, not quoted: each callee is bounded by its own header
-- (a callee's SET overrides the caller's for the duration of the call, this
-- repo's live evidence at 20260812210000), so the outer value must cover the
-- SUM. Read from the live definitions, the seven ceilings today are 60 + 20 +
-- 20 + 20 + 20 + 20 + 25 = 185s -- the 20260909228000 header quoted 130s,
-- having taken the ghost and date-coverage headers as 20s and 5s where their
-- live definitions say 60s and 20s -- and the curve adds 300s: 485s against
-- 600s, 115s of margin. The old five-minute header would not have covered
-- the sum (485 > 300); a test derives both numbers from the source so the
-- next added callee fails in CI rather than at the cron's minute. The cron
-- job itself carries no wrapper timeout; the role default above it is thirty
-- minutes.
--
-- pglite carries no statement timers, so which timer fires is not something
-- a test can prove; what the test proves by RUNNING the function is that a
-- query cancel, a generic error and an empty answer each carry the previous
-- object with its old stamp, name the part, record the reason and leave the
-- other seven parts refreshed -- and that the pre-fix definer over the same
-- stubs writes no such key at all.
--
-- THE SAME ROWS ARE ALREADY COMPUTED HOURLY FOR A KEY NOTHING READS.
-- refresh_explore_cache (minute 7) computes this exact call into
-- explore_cache.field_curves as an object keyed by category with no stamp of
-- its own, and Explore.tsx stopped rendering it. This file does not read
-- that: coupling the stats row to another cache's carry state would make the
-- stamp mean "when explore last succeeded", not "when these rows were
-- computed", and the object shape is not what the pages or /v1 consume.
-- The cost of computing it twice an hour -- one extra call per hour, 47s at
-- the last complete reading -- is stated here so it can be taken away
-- deliberately (re-issuing refresh_explore_cache without its field_curves
-- block) rather than discovered. What is taken away now is the OVERLAP:
-- this job ran at minute 12, five minutes behind explore's start, so under
-- two five-minute headers the two copies of the scan could run together;
-- 20260928011742 moves refresh-stats-cache to minute 27, outside explore's
-- fifteen-minute window in both directions.
--
-- WHAT IS AND IS NOT CHANGED. refresh_stats_cache is re-issued from
-- 20260909228000 with ONE block added between the actively_hiring guard and
-- the payload assembly, the ONE DECLARE line that block needs, and the header
-- value. Every other block, every label cast, the null guards on ghost_stats
-- and entry_stats and the unconditional write are byte-identical, because
-- guards in published-claims and instrument-recovery pin literal spellings in
-- this body; a guard removes the new block and masks the header and compares
-- what is left to the 20260909228000 text. One function per file. The
-- reachable set is restated at the foot by name rather than inherited: the
-- function was locked to service_role in 20260730070000 and CREATE OR REPLACE
-- preserves grants, but a file that relies on that is asserting a history it
-- cannot see (project_definer_exposure), and a self-check at the foot proves
-- the stored body, the header and the lock rather than reporting success on
-- a file the staged runner may have edited.
--
-- The seed of this part is the next cron tick, not a synchronous populate: a
-- migration statement holding a five-minute callee is the kind of lock
-- 20260909211000 exists to forbid. Until the first tick writes the key the
-- pages render the section as not yet computed.

CREATE OR REPLACE FUNCTION public.refresh_stats_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
SET statement_timeout = '10min'
AS $$
DECLARE
  prev    jsonb := '{}'::jsonb;
  payload jsonb := '{}'::jsonb;
  stale   text[] := '{}';
  hiring_at timestamptz;
  curve_at timestamptz;
BEGIN
  SELECT COALESCE(v, '{}'::jsonb) INTO prev
    FROM public.job_board_meta WHERE k = 'stats_cache';

  BEGIN
    payload := payload || jsonb_build_object('ghost_stats',
      (SELECT row_to_json(x) FROM public.get_ghost_job_index_stats() x LIMIT 1));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'ghost_stats'::text;
    payload := payload || jsonb_build_object('ghost_stats', prev -> 'ghost_stats');
    WHEN OTHERS THEN
    stale := stale || 'ghost_stats'::text;
    payload := payload || jsonb_build_object('ghost_stats', prev -> 'ghost_stats');
  END;
  IF (payload -> 'ghost_stats') IS NULL OR jsonb_typeof(payload -> 'ghost_stats') = 'null' THEN
    stale := stale || 'ghost_stats'::text;
    payload := payload || jsonb_build_object('ghost_stats', prev -> 'ghost_stats');
  END IF;

  BEGIN
    payload := payload || jsonb_build_object('date_coverage',
      (SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_date_coverage() x));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'date_coverage'::text;
    payload := payload || jsonb_build_object('date_coverage', COALESCE(prev -> 'date_coverage', '[]'::jsonb));
    WHEN OTHERS THEN
    stale := stale || 'date_coverage'::text;
    payload := payload || jsonb_build_object('date_coverage', COALESCE(prev -> 'date_coverage', '[]'::jsonb));
  END;

  BEGIN
    payload := payload || jsonb_build_object('entry_stats',
      (SELECT row_to_json(x) FROM public.get_entry_level_stats() x LIMIT 1));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'entry_stats'::text;
    payload := payload || jsonb_build_object('entry_stats', prev -> 'entry_stats');
    WHEN OTHERS THEN
    stale := stale || 'entry_stats'::text;
    payload := payload || jsonb_build_object('entry_stats', prev -> 'entry_stats');
  END;
  IF (payload -> 'entry_stats') IS NULL OR jsonb_typeof(payload -> 'entry_stats') = 'null' THEN
    stale := stale || 'entry_stats'::text;
    payload := payload || jsonb_build_object('entry_stats', prev -> 'entry_stats');
  END IF;

  BEGIN
    payload := payload || jsonb_build_object('entry_companies',
      (SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_entry_level_companies(25) x));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'entry_companies'::text;
    payload := payload || jsonb_build_object('entry_companies', COALESCE(prev -> 'entry_companies', '[]'::jsonb));
    WHEN OTHERS THEN
    stale := stale || 'entry_companies'::text;
    payload := payload || jsonb_build_object('entry_companies', COALESCE(prev -> 'entry_companies', '[]'::jsonb));
  END;

  BEGIN
    payload := payload || jsonb_build_object('hiring_trends',
      (SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_hiring_trends() x));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'hiring_trends'::text;
    payload := payload || jsonb_build_object('hiring_trends', COALESCE(prev -> 'hiring_trends', '[]'::jsonb));
    WHEN OTHERS THEN
    stale := stale || 'hiring_trends'::text;
    payload := payload || jsonb_build_object('hiring_trends', COALESCE(prev -> 'hiring_trends', '[]'::jsonb));
  END;

  BEGIN
    payload := payload || jsonb_build_object('trending_categories',
      (SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_trending_categories() x));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'trending_categories'::text;
    payload := payload || jsonb_build_object('trending_categories', COALESCE(prev -> 'trending_categories', '[]'::jsonb));
    WHEN OTHERS THEN
    stale := stale || 'trending_categories'::text;
    payload := payload || jsonb_build_object('trending_categories', COALESCE(prev -> 'trending_categories', '[]'::jsonb));
  END;

  -- THE SEVENTH PART. Its stamp is taken on the clock, not from now(): now()
  -- is the transaction's start, which is the row's top-level computed_at, and
  -- this part must carry a stamp that is its own -- on a carried run the
  -- previous object's stamp survives untouched, so the page can date the list
  -- to the run that actually produced it.
  BEGIN
    hiring_at := clock_timestamp();
    payload := payload || jsonb_build_object('actively_hiring', jsonb_build_object(
      'computed_at', hiring_at,
      'rows', (SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_actively_hiring_companies(20) x)));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'actively_hiring'::text;
    payload := payload || jsonb_build_object('actively_hiring', prev -> 'actively_hiring');
    WHEN OTHERS THEN
    stale := stale || 'actively_hiring'::text;
    payload := payload || jsonb_build_object('actively_hiring', prev -> 'actively_hiring');
  END;
  IF NOT ('actively_hiring' = ANY(stale))
     AND jsonb_array_length(COALESCE(payload -> 'actively_hiring' -> 'rows', '[]'::jsonb)) = 0 THEN
    stale := stale || 'actively_hiring'::text;
    payload := payload || jsonb_build_object('actively_hiring', prev -> 'actively_hiring');
  END IF;

  -- THE EIGHTH PART: the field fill curve the two data pages used to compute
  -- live on every visit, at the (90, 300) variant both of them resolve to. Its
  -- stamp is taken on the clock for the same reason the seventh's is: on a
  -- carried run the previous object survives whole, stamp included, so a
  -- reader dates the rows to the run that produced them. The callee's own
  -- header bounds this block; it sits LAST so its cost can never delay the
  -- seven parts before it, and whichever timer fires lands in the handler
  -- below, which keeps the previous object, names the part stale and records
  -- what fired under its own key. An empty answer is treated as the failure it
  -- is at production scale (eighteen fields today), exactly as the seventh
  -- part treats an empty leaderboard.
  BEGIN
    curve_at := clock_timestamp();
    payload := payload || jsonb_build_object('fill_curve', jsonb_build_object(
      'computed_at', curve_at,
      'variant', jsonb_build_object('p_days', 90, 'p_min_n', 300),
      'rows', (SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_category_fill_curve(90, 300) x)));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'fill_curve'::text;
    payload := payload || jsonb_build_object('fill_curve', prev -> 'fill_curve');
    payload := payload || jsonb_build_object('fill_curve_error', jsonb_build_object(
      'at', clock_timestamp(), 'reason', 'query_canceled', 'sqlstate', SQLSTATE, 'message', SQLERRM));
    WHEN OTHERS THEN
    stale := stale || 'fill_curve'::text;
    payload := payload || jsonb_build_object('fill_curve', prev -> 'fill_curve');
    payload := payload || jsonb_build_object('fill_curve_error', jsonb_build_object(
      'at', clock_timestamp(), 'reason', 'error', 'sqlstate', SQLSTATE, 'message', SQLERRM));
  END;
  IF NOT ('fill_curve' = ANY(stale))
     AND jsonb_array_length(COALESCE(payload -> 'fill_curve' -> 'rows', '[]'::jsonb)) = 0 THEN
    stale := stale || 'fill_curve'::text;
    payload := payload || jsonb_build_object('fill_curve', prev -> 'fill_curve');
    payload := payload || jsonb_build_object('fill_curve_error', jsonb_build_object(
      'at', clock_timestamp(), 'reason', 'empty', 'message', 'get_category_fill_curve(90, 300) returned zero rows'));
  END IF;

  payload := payload
    || jsonb_build_object('computed_at', now())
    || jsonb_build_object('stale_parts', to_jsonb(stale));

  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('stats_cache', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

COMMENT ON FUNCTION public.refresh_stats_cache() IS
  'Hourly (cron refresh-stats-cache, minute 27 from 20260928011742) writer of job_board_meta.stats_cache. '
  'Eight parts, each in its own guarded block, each degrading to the previous '
  'row''s value and named in stale_parts when it does: ghost_stats, '
  'date_coverage, entry_stats, entry_companies, hiring_trends, '
  'trending_categories, actively_hiring (from 20260909228000; the Ghost Job '
  'Index leaderboard, get_actively_hiring_companies(20)) and, from '
  '20260928004823, fill_curve -- get_category_fill_curve(90, 300), the field '
  'fill table both data pages used to compute live -- each of the last two '
  'stored as {computed_at, rows} so a carried copy keeps the stamp of the run '
  'that produced it. An empty leaderboard or an empty curve is carried and '
  'named stale, not published; a carried curve also writes fill_curve_error '
  '{at, reason, sqlstate, message} for that run. The row is always written. '
  'Budget: this function''s own 10min header; each callee is bounded by its own '
  'header (sum of live ceilings 485s).';

-- THE REACHABLE SET, STATED NOT INHERITED. The cron runs this as the job
-- owner, never through these grants; anon and authenticated are named because
-- PUBLIC is not the same set as either.
REVOKE ALL ON FUNCTION public.refresh_stats_cache() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_stats_cache() TO service_role;

-- Self-verifying: exactly one definition must remain, its stored body must
-- carry the eighth part and the key that records a failed run, its own
-- proconfig must carry the ten-minute header, and neither anon nor
-- authenticated may execute it -- a re-issue the staged runner edited into
-- something else must not be able to report success.
DO $$
DECLARE n int; cfg text[]; src text;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'refresh_stats_cache';
  IF n <> 1 THEN
    RAISE EXCEPTION 'refresh_stats_cache: expected exactly one definition, found %', n;
  END IF;
  SELECT p.proconfig, p.prosrc INTO cfg, src
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'refresh_stats_cache';
  IF cfg IS NULL OR NOT ('statement_timeout=10min' = ANY(cfg)) THEN
    RAISE EXCEPTION 'refresh_stats_cache: re-issued without the ten-minute header: %', cfg;
  END IF;
  IF src NOT LIKE '%''fill_curve''%'
     OR src NOT LIKE '%''fill_curve_error''%'
     OR src NOT LIKE '%public.get_category_fill_curve(90, 300)%' THEN
    RAISE EXCEPTION 'refresh_stats_cache: the stored body does not carry the eighth part';
  END IF;
  IF has_function_privilege('anon', 'public.refresh_stats_cache()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.refresh_stats_cache()', 'EXECUTE') THEN
    RAISE EXCEPTION 'refresh_stats_cache: still executable by anon or authenticated';
  END IF;
END $$;
