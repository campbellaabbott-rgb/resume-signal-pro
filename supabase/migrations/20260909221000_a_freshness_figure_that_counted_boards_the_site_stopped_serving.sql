-- A FRESHNESS FIGURE THAT COUNTED BOARDS THE SITE STOPPED SERVING.
--
-- The 'freshness' rollup (refresh_job_board_stats, every 15 min) publishes
-- boards / p50_min / p95_min / max_min over "every verification stamp whose
-- token still holds at least one posting row". That predicate was written in
-- 20260719140000 to mean "boards actually on the board", and it meant it: an
-- unverified board's rows were DELETED by the 03:41 sweep, so a token with
-- rows was a token being served.
--
-- 20260827182000 changed the sweep to STAMP missing_since instead of
-- deleting (right: the rows are history now). Nothing changed the rollup, so
-- since that day its population has silently included boards whose every
-- row is dark -- boards the site stopped serving days ago -- and their
-- stamps age without bound because the 03:51 stamp cleanup fires only for
-- tokens with ZERO rows. Live on 2026-09-10 02:45 UTC (population = every
-- stamp whose token holds >= 1 posting row, live or not): boards 33,574,
-- p50 168.8 min, p95 346.5 min, max_min 20,961.0 (14.6 d). The oldest of
-- the twelve named in 20260909218000's header are PRESUMED to be this
-- shape -- presumed, not measured: that header records stamped_at only, and
-- nothing in the tree has read live_rows for 'constructor' or 'applied'.
--
-- WHAT THIS MIGRATION DOES AND DOES NOT MOVE, stated so the post-deploy
-- reading is not a guess. A stamp leaves max_min for the dark bucket only
-- when EVERY row of its token carries missing_since; a token with even one
-- live row stays in max_min until a fetch restamps it, and for the two
-- fossil tokens that fetch is the stale lane's or the rotation's (the
-- Object.prototype maps are fixed in job-board .69), never this rollup's.
-- The check, after the first 15-minute tick past deploy: dark_max_min
-- should read about 20,961 plus the minutes elapsed since 02:45 UTC while
-- max_min falls to the live population's real tail. If max_min does NOT
-- fall, read get_stalest_boards' live_rows for the two tokens -- they hold
-- a live row, the rollup was right to keep them, and it is the fetch that
-- clears them.
--
-- WHICH WAY TO NARROW IT, decided honestly. Two candidates were on the table:
--
--   (a) the edge function writes the catalogue token set to job_board_meta
--       each pass and the rollup joins it. Refused. The catalogue is 44,519
--       tokens -- ~600 KB of JSON written per pass and re-read every 15
--       minutes, the "queue read whole every slice" cost class .28 removed;
--       and it puts a copy of sources.ts in a second runtime, which is how
--       claims go false (the "no subscriptions" incident). And the theory it
--       was written for was refuted the same night: the two tokens that
--       motivated it ('constructor', 'applied') ARE catalogued, packed
--       entries a grep could not see. Uncatalogued tokens with rows are the
--       orphan prune's business, and it already handles them.
--
--   (b) the rollup excludes stamps whose token has zero LIVE rows
--       (missing_since IS NULL) and reports the excluded count as its own
--       bucket. TAKEN. It restores 20260719140000's stated intent with the
--       predicate the serving path itself uses, needs no writer across the
--       runtime boundary, and makes the excluded population a number on the
--       status page rather than a silence.
--
-- THE POPULATION, stated: freshness figures are computed over verification
-- stamps whose token holds at least one live posting row (missing_since IS
-- NULL). Stamps whose token holds rows but none live are the DARK bucket.
--
-- EVERY EXISTING KEY KEEPS ITS MEANING. boards is still the count of the
-- population, p50_min/p95_min the percentiles of re-verification age over
-- it, max_min its oldest stamp; get_freshness_stats() projects the same four
-- keys and its signature does not move (one function per file; the RPC is
-- untouched). Two keys are ADDED to the same jsonb:
--
--   dark_boards   stamps whose token holds posting rows but none live
--   dark_max_min  the oldest such stamp, in minutes -- so the figure that
--                 used to be max_min is still visible after the narrowing
--   population    one sentence naming the basis, so a reader of the row
--                 never has to find this file
--
-- The status endpoint reads the rollup row beside the RPC and publishes
-- dark_boards / dark_max_min / population on `freshness` (job-board .69).
--
-- WHAT THIS MOVES IN 20260909218000. get_stalest_boards() deliberately uses
-- the OLD predicate (stamp EXISTS postings, no missing_since filter), so the
-- stale lane still sees dark boards -- they are stale boards and the lane's
-- classifier is where "dark" gets a cause. Its self-check ("first.age_min ==
-- freshness.max_min") therefore becomes: first.age_min == the greater of
-- max_min and dark_max_min, plus the minutes since computed_at. The RPC's
-- own comment records the check as written; this header records the change,
-- as that comment asked.
--
-- COST. One more EXISTS per stamp, on the same company_token index the first
-- one probes. For a live board it stops at the first live row, which is
-- almost every row; only a dark board scans all of its rows, and dark
-- boards are the minority this bucket counts. Same block, same first
-- position in the 4-minute budget, same per-row EXCEPTION handling: a
-- timeout still skips this row and leaves the previous value standing
-- under its own older computed_at.
--
-- Re-issued from the LATEST definition (20260904090000 -- checked: no later
-- migration redefines this function). The date_coverage and desc_coverage
-- blocks are byte-identical to it; only the freshness block changes.

CREATE OR REPLACE FUNCTION public.refresh_job_board_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '4min'
AS $$
BEGIN
  BEGIN
    INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
    SELECT
      'freshness',
      jsonb_build_object(
        'boards',       count(*) FILTER (WHERE live.is_live),
        'p50_min',      round((percentile_cont(0.5)  WITHIN GROUP (ORDER BY live.age_min) FILTER (WHERE live.is_live))::numeric, 1),
        'p95_min',      round((percentile_cont(0.95) WITHIN GROUP (ORDER BY live.age_min) FILTER (WHERE live.is_live))::numeric, 1),
        'max_min',      round((max(live.age_min) FILTER (WHERE live.is_live))::numeric, 1),
        'dark_boards',  count(*) FILTER (WHERE NOT live.is_live),
        'dark_max_min', round((max(live.age_min) FILTER (WHERE NOT live.is_live))::numeric, 1),
        'population',   'verification stamps whose token holds at least one live posting row (missing_since IS NULL); dark_boards = stamps whose token holds rows but none live'
      ),
      now()
    FROM (
      SELECT EXTRACT(EPOCH FROM (now() - ver.verified_at)) / 60.0 AS age_min,
             EXISTS (
               SELECT 1 FROM public.job_board_postings p
               WHERE p.company_token = ver.company_token
                 AND p.missing_since IS NULL
             ) AS is_live
      FROM public.job_board_verifications ver
      WHERE EXISTS (
        SELECT 1 FROM public.job_board_postings p
        WHERE p.company_token = ver.company_token
      )
    ) live
    ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, computed_at = EXCLUDED.computed_at;
  EXCEPTION
    WHEN QUERY_CANCELED THEN
      RAISE WARNING 'stats rollup: freshness unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
      RAISE WARNING 'stats rollup: freshness unavailable (%)', SQLERRM;
  END;

  BEGIN
    INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
    SELECT
      'date_coverage',
      COALESCE(jsonb_agg(jsonb_build_object('source', source, 'total', total, 'dated', dated)
                         ORDER BY total DESC), '[]'::jsonb),
      now()
    FROM (
      SELECT source, count(*) AS total, count(posted_at) AS dated
      FROM public.job_board_postings
      WHERE missing_since IS NULL
      GROUP BY source
    ) s
    ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, computed_at = EXCLUDED.computed_at;
  EXCEPTION
    WHEN QUERY_CANCELED THEN
      RAISE WARNING 'stats rollup: date_coverage unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
      RAISE WARNING 'stats rollup: date_coverage unavailable (%)', SQLERRM;
  END;

  -- Described = holds a stored description at all: the exact complement of
  -- what every sweep lane selects (description IS NULL), so total minus
  -- described per source is that source's sweep backlog. A null test reads
  -- the tuple's bitmap and never opens the value; the predicate it replaces
  -- counted characters, which detoasted every live description each tick.
  BEGIN
    INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
    SELECT
      'desc_coverage',
      COALESCE(jsonb_agg(jsonb_build_object('source', source, 'total', total, 'described', described)
                         ORDER BY total DESC), '[]'::jsonb),
      now()
    FROM (
      SELECT source,
             count(*) AS total,
             count(*) FILTER (WHERE description IS NOT NULL) AS described
      FROM public.job_board_postings
      WHERE missing_since IS NULL
      GROUP BY source
    ) s
    ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, computed_at = EXCLUDED.computed_at;
  EXCEPTION
    WHEN QUERY_CANCELED THEN
      RAISE WARNING 'stats rollup: desc_coverage unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
      RAISE WARNING 'stats rollup: desc_coverage unavailable (%)', SQLERRM;
  END;
END $$;

-- CREATE OR REPLACE keeps the function's ACL, and 20260806170446 already
-- closed it; restated by name anyway, because a rewrite is exactly the moment
-- a grant is silently carried -- or not -- and PUBLIC is not anon.
REVOKE ALL ON FUNCTION public.refresh_job_board_stats() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.refresh_job_board_stats() IS
  'Every-15-min rollup writer for freshness, date_coverage and desc_coverage. '
  'Each INSERT degrades independently — a timeout (QUERY_CANCELED, which WHEN '
  'OTHERS does not catch) or any other failure skips one row and leaves the '
  'previous value standing under its own older computed_at. freshness since '
  '2026-09-10 (20260909221000): population = verification stamps whose token '
  'holds at least one LIVE posting row (missing_since IS NULL); boards, '
  'p50_min, p95_min and max_min keep their meaning over that population, and '
  'dark_boards / dark_max_min count the stamps whose token holds rows but '
  'none live — the boards the site stopped serving, previously counted as '
  'fresh-or-stale with everything else. desc_coverage since 2026-09-04: '
  'described = description IS NOT NULL, the sweep lanes'' own selection '
  'complemented, so total - described is the sweep backlog per source.';

NOTIFY pgrst, 'reload schema';
