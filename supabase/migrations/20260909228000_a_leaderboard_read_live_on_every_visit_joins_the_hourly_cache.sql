-- THE LEADERBOARD THE PAGE WAITED TWENTY SECONDS FOR WAS COMPUTABLE AN HOUR AGO.
--
-- Measured live, 2026-09-14, five runs of get_actively_hiring_companies(20)
-- as the Ghost Job Index calls it: 13.8s, 25.7s (that one brushed the
-- function's own 25s header), and three between. get_stats_cache, which the
-- same page reads first for ghost_stats and date_coverage, answered in 0.24s.
-- The page was already built around that split -- the tiles paint off the
-- cache and stopped waiting for the leaderboard on 2026-09-10 -- but the
-- leaderboard itself was still read LIVE on every visit, so the section that
-- gives the page its name arrived last, or not at all when the 25s fired.
--
-- WHY THE AGGREGATION IS SLOW IS NOT KNOWN. A 2,000-token pglite fixture runs
-- the same body in 378ms, and the fill curve it calls once is 1.5s live for
-- twenty tokens; the orchestrator has asked for a live EXPLAIN. This is the
-- interim that makes the page instant regardless: the hourly refresh that
-- already computes six parts of this cache computes a seventh, and the page
-- reads it the way it reads the other six.
--
-- THE SHAPE. `actively_hiring` is an object, not a bare array, because a
-- statistic names its date basis and this one's basis is NOT the run that
-- wrote the row:
--
--     actively_hiring: { computed_at: <when THESE rows were computed>,
--                        rows: [ ...get_actively_hiring_companies(20)... ] }
--
-- On a healthy run computed_at is this run's clock. On a run where the
-- leaderboard fails, the previous object is carried forward WHOLE -- rows and
-- stamp together -- and 'actively_hiring' is appended to stale_parts, exactly
-- the contract ghost_stats and the five others have carried since
-- 20260807214412. A carried part therefore dates itself to the run that
-- actually produced it, which can be many hours behind the row's top-level
-- computed_at; the page prints the part's own stamp, never the row's, and says
-- "carried" beside it when stale_parts names the part.
--
-- AN EMPTY ANSWER IS NOT PUBLISHED AS A GOOD ONE, the rule 20260809223000
-- wrote for ghost_stats after four hours of good values were overwritten by a
-- null that no handler had fired for. Every one of today's five live runs
-- returned twenty rows; zero rows from this function at production scale is
-- the signature of a callee that has stopped answering (the curve refusing
-- every employer, an empty closure window), not a finding that nobody is
-- hiring. So an empty array is treated as the failure it almost certainly is:
-- the previous object is carried and the part is named stale. The page then
-- shows the last real list, dated and labelled, rather than nothing. Guarded
-- against a double append: a part already named stale is not named twice.
--
-- BUDGET. This function runs hourly at minute 12 under its own 5-minute
-- header (20260812210000: role-GUC drift is a demonstrated event). Nothing
-- inside it sets a per-part budget; each callee's own header bounds it,
-- because a callee's SET overrides the caller's for the duration of the call.
-- The ceilings today: ghost_stats 20s (measured ~4.9s), date_coverage 5s,
-- entry_stats 20s, entry_companies 20s, hiring_trends 20s, trending_categories
-- 20s -- 105s worst case against 300s. The leaderboard adds its own 25s
-- header, the one today's slowest run brushed (25.7s wall clock, rows
-- returned): 130s worst case, still inside the 5-minute budget with room for
-- the run-to-run variance the five measurements showed. That a callee's
-- header bounds its part inside a caller is this repo's LIVE evidence
-- (20260812210000, explore-claims: a 25s callee header killed at 25.46s
-- inside a caller that had set 90s), not a property re-verified here --
-- pglite carries no statement timers. Nothing below depends on it: the
-- handler catches whichever timer fires, and the row is written either way.
-- Post-deploy, cron.job_run_details for 'refresh-stats-cache' says which:
-- runs lengthening by the leaderboard's real duration with the part
-- uncarried would mean the header did not re-arm. A SET LOCAL inside the
-- block would NOT be the remedy -- the same evidence found the inner SET
-- LOCALs inert (20260812210000's COMMENT); the budget would then have to be
-- armed before the call, at the cron command. When the 25s fires, QUERY_CANCELED lands in THIS
-- block's handler (named explicitly, since WHEN OTHERS does not catch it --
-- 20260812220000), the previous list is carried and named stale, and the six
-- other parts are untouched. If the callee's header is ever raised past what
-- the sum below can absorb, this budget is the line to revisit, not the
-- handler.
--
-- WHAT IS AND IS NOT CHANGED. refresh_stats_cache is re-issued from
-- 20260812230000 with ONE block added between trending_categories and the
-- payload assembly, plus the one DECLARE line that block needs. Every other
-- block, every label cast, the null guards on ghost_stats and entry_stats, the
-- 5-minute header and the unconditional write are byte-identical, because
-- guards in published-claims and instrument-recovery pin literal spellings in
-- this body. The other two functions that file defines
-- (refresh_explore_cache, refresh_transparency_cache) stay where they are: one
-- function per file, so the OUT-param guard's newest-mentioning-file slice
-- keeps pointing at exactly one definition. Grants are untouched: the function
-- was locked to service_role by name in 20260730070000, and CREATE OR REPLACE
-- preserves grants.
--
-- The seed of this part is the next cron tick, not a synchronous populate: a
-- migration statement holding this function's 130s worst case is the kind of
-- lock 20260909211000 exists to forbid, and the page falls back to the live
-- read -- off its critical path -- until the first tick writes the key.

CREATE OR REPLACE FUNCTION public.refresh_stats_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
SET statement_timeout = '5min'
AS $$
DECLARE
  prev    jsonb := '{}'::jsonb;
  payload jsonb := '{}'::jsonb;
  stale   text[] := '{}';
  hiring_at timestamptz;
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

  payload := payload
    || jsonb_build_object('computed_at', now())
    || jsonb_build_object('stale_parts', to_jsonb(stale));

  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('stats_cache', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

COMMENT ON FUNCTION public.refresh_stats_cache() IS
  'Hourly (cron refresh-stats-cache, minute 12) writer of job_board_meta.stats_cache. '
  'Seven parts, each in its own guarded block, each degrading to the previous '
  'row''s value and named in stale_parts when it does: ghost_stats, '
  'date_coverage, entry_stats, entry_companies, hiring_trends, '
  'trending_categories and, from 20260909228000, actively_hiring -- the Ghost '
  'Job Index leaderboard, get_actively_hiring_companies(20), stored as '
  '{computed_at, rows} so a carried copy keeps the stamp of the run that '
  'produced it. An empty leaderboard is carried and named stale, not '
  'published. The row is always written. Budget: this function''s own 5min '
  'header; each callee is bounded by its own header (sum of ceilings 130s).';
