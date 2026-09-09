-- THE CRON STOPS BUYING TWELVE-CARD LEADERBOARDS AND STARTS BUYING THE BOARD.
--
-- /explore's five employer sections are being deleted from the page. Four of
-- them are produced HERE, by the same twelve-row slice:
--
--   hiring     get_actively_hiring_companies(2000)  FILTER (WHERE r.rn <= 12)
--   reposters  get_repost_churn_companies(9000)     FILTER (WHERE r.rn <= 12)
--   relisting  get_relisting_employers(12)
--   entry      get_entry_level_companies(12)
--
-- Twelve employer cards cannot exceed 11.09% of this board however well they
-- are ranked, and the deployed set held 1,812 open roles against ~938,000
-- served -- 0.19%. THE STATISTICS ARE NOT THE PROBLEM AND ARE NOT BEING
-- LOWERED: the same competing-risks estimator, the same sufficiency gate, the
-- same arithmetic bar, all of it survives at FIELD grain (where a field has
-- thousands of closures and the estimator PASSES the gates the employer form
-- fails) and at SLICE grain. What changes is the denominator the page is built
-- on, and the four blocks above are what the cron was spending an hour on to
-- fill a section that reached a fifth of one percent of the board.
--
-- WHAT REPLACES THEM, both wrapped exactly like their siblings:
--
--   field_grid     get_explore_field_grid -- eighteen tiles that partition the
--                  whole serving population, plus every constraint chip's count
--                  AND its own denominator, from one pass.
--   chip_coverage  get_filter_coverage -- board-wide coverage for the same
--                  chips, from the scan the refresh pass already runs. It is
--                  read HERE, rather than re-derived, because a chip on
--                  /explore and the disclosure sentence on /jobs must quote the
--                  same number or the board states its own reach twice.
--
-- AND ONE READ-THROUGH, NOT A CALL: role_rows. The role vocabulary is
-- computed by refresh_explore_role_rows on its own six-hourly cron
-- (20260909120000) because a grouped pass over every served title plus one
-- index probe per row is the most expensive query on this page and a role
-- vocabulary does not move hourly. This function reads the finished row and
-- republishes it inside its own payload, so the page still reads ONE key and
-- can still see how old that block is on its own -- the block carries its own
-- `at` and `status`, and neither is overwritten by this run's clock.
--
-- `fields` NOW COMES OFF field_grid, NOT OFF THE DENOMINATORS SCAN. Both
-- produce a per-category served count under the same `n >= 50` floor, and
-- publishing both would put two numbers on one quantity taken from two scans
-- at two instants -- so the healthy path projects field_grid's tiles into the
-- existing {category: n} shape and the denominators' copy is used only when
-- field_grid failed, in which case `field_grid` is named in stale_parts and a
-- reader can see which scan the number came from.
--
-- THREE MORE BLOCKS GO WITH THEM, AND FOR THE SAME REASON RATHER THAN AS AN
-- ECONOMY. get_explore_cache is read by exactly ONE consumer -- src/pages/
-- Explore.tsx -- so a key nothing on that page reads is a key nothing reads:
--
--   transparent (+transparent_status, 240s)  fed "Who states pay".
--   salary (180s)                            fed "Where the pay is".
--   ageout_basis (20s)                       fed "Still advertised when it
--                                            crossed day 30".
--
-- All three sections are deleted in this ship, and all three names are now on
-- Explore.tsx's RETIRED_CACHE_PARTS, which is the page saying in code that it
-- does not render them. Leaving the scans in place would be exactly the shape
-- this ship's own header forbids -- "a removed section's COMPUTATION goes with
-- it, because arithmetic with no rendered sentence is a number waiting to be
-- re-rendered by someone who does not know why it left" -- and it is the shape
-- trending and newest took for months. It would also be the largest line in
-- the budget: 440 of 715 seconds an hour spent on payloads with no reader.
--
-- get_salary_benchmarks() ITSELF IS NOT DROPPED and is still called live by
-- /jobs (Jobs.tsx:2924). What goes is the explore_cache copy of its output,
-- which had no reader. get_transparent_employers() and get_ageout_basis()
-- lose their only caller and are left in place for one ship, unreferenced, so
-- that dropping them is a separate decision with its own migration rather than
-- a side effect of a page rewrite.
--
-- WHAT IS DELIBERATELY KEPT.
--   repost_index (90s) -- STILL READ BY THE REBUILT PAGE, checked rather than
--     assumed: Explore.tsx takes it into state and consumes it on the employer
--     surface that survives this ship. The blocks above are removed only
--     because the readers that consumed THEM are gone from the same file;
--     deleting a key the deployed page still reads is how a section goes blank
--     with nothing saying so, the failure 20260907020000 was written to stop.
--     totals.repost_flagged_n is the one that loses its reader here -- it
--     counted employers flagged inside the deleted hiring leaderboard, and
--     Explore.tsx now names it only in a comment listing what was removed. It
--     is retained for one ship because dropping it also has to move a guard
--     (explore-claims pins `'repost_flagged_n', NULLIF(`), and it is free: it
--     is a key count over repost_index, which is computed anyway.
--   chip_coverage and role_rows -- KEPT, and the distinction from the three
--     above is the direction of travel. Those three are dead work outliving a
--     deleted reader. These two are the cached form of numbers sections 2 and
--     3 currently take from live probes at click time: the sections exist and
--     render, and the keys are new work arriving slightly before the reader
--     that will consume them. Explore.tsx lists both on RETIRED_CACHE_PARTS
--     meanwhile, so neither can raise a staleness warning about a section it
--     does not yet back.
--   denominators -- unchanged.
--
-- BUDGET. A callee's own SET overrides the caller's, so nothing but the outer
-- value bounds their total, and exceeding it rolls back the write and loses
-- every collection including the healthy ones. Removing the four blocks
-- returned 180s (25 + 15 + 120 + 20) and the three unread blocks a further
-- 440s (240 + 180 + 20); the three additions spend 225s (45 + 120 + 60). The
-- sum is now 90 + 20 + 45 + 120 + 60 = 335s against the same 900s ceiling,
-- down from 730s. The 60s that buys field_curves is the cheapest line in it:
-- without that key the identical 44-second anon-granted scan runs once per
-- PAGE VIEW on the site's default discovery page, which is not a budget at
-- all.
--
-- ONE NUMBER IN totals NEEDS A WARNING AND CANNOT CARRY IT ITSELF.
-- totals.postings_pay_n counts `salary IS NOT NULL` -- the widest of the three
-- pay columns, the employer wrote SOMETHING in a pay field. It is a
-- TRANSPARENCY statistic and no filter binds it. A pay chip must quote
-- chip_coverage.salaryFloor (salary_rank_usd, the only column a floor can
-- compare against); quoting postings_pay_n or hasStatedPay beside a pay
-- control overstates that control's reach. See 20260909100000, which exists
-- because this board published 20.1%, 12.9% and "~4%" for one fact.

CREATE OR REPLACE FUNCTION public.refresh_explore_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
SET statement_timeout = '15min'
AS $$
DECLARE
  prev jsonb := '{}'::jsonb;
  payload jsonb;
  stale text[] := '{}';
  repost_idx jsonb := '{}'::jsonb;
  denom jsonb := '{}'::jsonb;
  totals jsonb;
  field_grid_v jsonb := '{}'::jsonb;
  field_curves_v jsonb := '{}'::jsonb;
  chip_cov_v jsonb := '{}'::jsonb;
  role_rows_v jsonb := '{}'::jsonb;
  fields_v jsonb := '{}'::jsonb;
BEGIN
  SELECT COALESCE(v, '{}'::jsonb) INTO prev
    FROM public.job_board_meta WHERE k = 'explore_cache';

  -- THE FIELD GRID: eighteen tiles over the whole serving population, plus
  -- every chip's count and its own denominator. This is the section the page
  -- now OPENS on, so its failure is the one that costs the most -- carried
  -- forward and named, never zeroed, because an empty object here is a page
  -- with no tiles and nothing saying why.
  BEGIN
    field_grid_v := COALESCE(public.get_explore_field_grid(), '{}'::jsonb);
    IF jsonb_typeof(field_grid_v -> 'fields') <> 'object' THEN
      stale := stale || 'field_grid'::text;
      RAISE WARNING 'explore cache: field grid returned no fields object';
      field_grid_v := COALESCE(prev -> 'field_grid', '{}'::jsonb);
    END IF;
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'field_grid'::text;
    field_grid_v := COALESCE(prev -> 'field_grid', '{}'::jsonb);
    RAISE WARNING 'explore cache: field grid unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
    stale := stale || 'field_grid'::text;
    field_grid_v := COALESCE(prev -> 'field_grid', '{}'::jsonb);
    RAISE WARNING 'explore cache: field grid unavailable (%)', SQLERRM;
  END;

  -- THE FIELD LIFECYCLE CURVES, WHICH IS THE HALF THAT WAS MISSING.
  --
  -- /explore's new default view prints a lifecycle sentence under every tile
  -- from get_category_fill_curve. That function is anon-granted and it is a
  -- 44-SECOND, THREE-SCAN AGGREGATE against a 60s statement timeout -- measured
  -- live, HTTP 200, eighteen rows, `sufficient` true. The page was written to
  -- read it from this cache under `field_curves` and to fall back to calling it
  -- directly when the key was absent, and NO MIGRATION WROTE THE KEY. A
  -- fallback whose condition is permanently true is not a fallback, it is the
  -- only path: every visitor to the site's default discovery page would have
  -- run that scan, on a page prerendered and sitemapped daily. This board has
  -- already paid that exact bill once -- "every visitor paid 26s of database
  -- time for a section that had never rendered" (get_transparent_employers) --
  -- and this is where the answer belongs, because an hourly scan amortises what
  -- a page view cannot.
  --
  -- SHAPED {category: row} IN THE RPC'S OWN COLUMN NAMES, because the page's
  -- cached reader is the same reader its live path feeds; a shape of ours here
  -- would let the two drift into two renderings of one measurement. The
  -- defaults are passed explicitly (90, 300) so a cached row and a live call
  -- select the same categories under the same p_min_n floor.
  --
  -- `sufficient`, `dated_coverage` and `window_days` RIDE ALONG UNTOUCHED. The
  -- page gates on all three -- the estimator's own refusal, the coverage band
  -- and the observation window -- and a cache that dropped any of them would
  -- publish a rate its own gate never saw.
  BEGIN
    field_curves_v := COALESCE((
      SELECT jsonb_object_agg(c.category, to_jsonb(c) - 'category')
        FROM public.get_category_fill_curve(90, 300) c
    ), '{}'::jsonb);
    IF field_curves_v = '{}'::jsonb THEN
      -- An empty object is not a finding about the board: at field grain this
      -- estimator passes comfortably (eighteen rows, n_at_risk in the ten
      -- thousands), so nothing coming back means the scan did not answer.
      -- Carry the previous run and name it.
      stale := stale || 'field_curves'::text;
      field_curves_v := COALESCE(prev -> 'field_curves', '{}'::jsonb);
    END IF;
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'field_curves'::text;
    field_curves_v := COALESCE(prev -> 'field_curves', '{}'::jsonb);
    RAISE WARNING 'explore cache: field curves unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
    stale := stale || 'field_curves'::text;
    field_curves_v := COALESCE(prev -> 'field_curves', '{}'::jsonb);
    RAISE WARNING 'explore cache: field curves unavailable (%)', SQLERRM;
  END;

  -- THE CHIP DENOMINATORS, read from the SAME function the job-board refresh
  -- pass reads. Not re-derived: a chip on /explore and the coverage sentence
  -- on /jobs describe one fact, and two scans of one fact is how a board comes
  -- to state its own reach twice with two numbers.
  BEGIN
    chip_cov_v := COALESCE(public.get_filter_coverage(), '{}'::jsonb);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'chip_coverage'::text;
    chip_cov_v := COALESCE(prev -> 'chip_coverage', '{}'::jsonb);
    RAISE WARNING 'explore cache: chip coverage unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
    stale := stale || 'chip_coverage'::text;
    chip_cov_v := COALESCE(prev -> 'chip_coverage', '{}'::jsonb);
    RAISE WARNING 'explore cache: chip coverage unavailable (%)', SQLERRM;
  END;

  -- THE ROLE VOCABULARY, READ RATHER THAN COMPUTED. Its own writer owns the
  -- cost and the schedule; this republishes the finished row so the page reads
  -- one key. The block keeps its own `at` and `status`, so "six hours old" and
  -- "this hour's refresh" stay distinguishable -- collapsing them would let a
  -- fresh cache timestamp vouch for a vocabulary that has not been recomputed
  -- since it started failing.
  BEGIN
    SELECT COALESCE(v, '{}'::jsonb) INTO role_rows_v
      FROM public.job_board_meta WHERE k = 'explore_role_rows';
    IF jsonb_typeof(role_rows_v -> 'fields') <> 'object' THEN
      stale := stale || 'role_rows'::text;
      role_rows_v := COALESCE(prev -> 'role_rows', '{}'::jsonb);
    END IF;
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'role_rows'::text;
    role_rows_v := COALESCE(prev -> 'role_rows', '{}'::jsonb);
    RAISE WARNING 'explore cache: role rows unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
    stale := stale || 'role_rows'::text;
    role_rows_v := COALESCE(prev -> 'role_rows', '{}'::jsonb);
    RAISE WARNING 'explore cache: role rows unavailable (%)', SQLERRM;
  END;

  BEGIN
    repost_idx := COALESCE(public.get_repost_index(), '{}'::jsonb);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    repost_idx := '{}'::jsonb;
    RAISE WARNING 'explore cache: repost index unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
    repost_idx := '{}'::jsonb;
    RAISE WARNING 'explore cache: repost index unavailable (%)', SQLERRM;
  END;

  BEGIN
    denom := COALESCE(public.get_explore_denominators(), '{}'::jsonb);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    denom := '{}'::jsonb;
    RAISE WARNING 'explore cache: denominators unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
    denom := '{}'::jsonb;
    RAISE WARNING 'explore cache: denominators unavailable (%)', SQLERRM;
  END;

  -- ONE PER-FIELD COUNT, FROM ONE SCAN. `fields` keeps its published shape
  -- ({category: n}) but is now a PROJECTION of the field grid rather than a
  -- second scan's answer to the same question. Both apply the same n >= 50
  -- floor, so the shape is identical and the number can no longer disagree
  -- with the tile printing it. The denominators' copy is the fallback for
  -- exactly the case where the grid failed -- and that case is already named
  -- in stale_parts, so a reader can tell which scan produced it.
  BEGIN
    fields_v := COALESCE(
      (SELECT jsonb_object_agg(kv.key, (kv.value ->> 'n')::int)
         FROM jsonb_each(field_grid_v -> 'fields') kv),
      COALESCE(denom -> 'fields', '{}'::jsonb));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    fields_v := COALESCE(denom -> 'fields', COALESCE(prev -> 'fields', '{}'::jsonb));
    WHEN OTHERS THEN
    fields_v := COALESCE(denom -> 'fields', COALESCE(prev -> 'fields', '{}'::jsonb));
  END;

  -- strip_nulls + NULLIF(_, 0): a zero denominator is a broken scan or a
  -- meaningless sentence, and in both cases the honest render is no sentence.
  -- The page gates on key presence, so a stripped key degrades to silence.
  totals := (denom - 'fields') || jsonb_strip_nulls(jsonb_build_object(
    'repost_flagged_n', NULLIF((SELECT count(*)::int FROM jsonb_object_keys(repost_idx)), 0)
  ));

  payload := jsonb_build_object(
    'field_grid', field_grid_v,
    'field_curves', field_curves_v,
    'chip_coverage', chip_cov_v,
    'role_rows', role_rows_v,
    'repost_index', repost_idx,
    'fields', fields_v,
    'totals', totals,
    'stale_parts', to_jsonb(stale),
    'computed_at', now()
  );
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('explore_cache', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

COMMENT ON FUNCTION public.refresh_explore_cache() IS
  'Hourly Explore cache. EVERY section is optional: a failing callee costs one '
  'stale section (previous value carried, named in stale_parts), never the '
  'hour''s write. KEYS: field_grid, field_curves, chip_coverage, role_rows, '
  'repost_index, fields, totals, stale_parts, computed_at. '
  'REMOVED 2026-09-09: hiring, reposters, relisting, entry, transparent '
  '(+transparent_status), salary and ageout_basis -- every key that fed one of '
  'the five twelve-card employer leaderboards. Twelve employer cards cannot '
  'exceed 11.09% of this board and the deployed set held 0.19% of it, so the '
  'cron was spending 620 of its 730 seconds an hour producing sections that '
  'reached a fifth of one percent of the inventory. get_explore_cache has '
  'exactly ONE consumer (src/pages/Explore.tsx), so a key that page does not '
  'read is a key nothing reads, and leaving the scans behind their deleted '
  'renderers is the shape this board has already shipped twice with trending '
  'and newest: arithmetic with no rendered sentence is a number waiting to be '
  're-rendered by someone who does not know why it left. '
  'get_salary_benchmarks() is NOT dropped -- /jobs still calls it live; what '
  'went is the explore_cache copy of its output. '
  'NONE OF THE STATISTICS WERE LOWERED OR DROPPED: '
  'the competing-risks estimator, its sufficiency gate and the arithmetic '
  'closure bar all survive at FIELD grain (get_category_fill_curve, which '
  'PASSES the gates the per-employer form fails because a field has thousands '
  'of closures where an employer has three) and at slice grain. The '
  'DENOMINATOR was the defect, not the rigour. '
  'field_curves IS get_category_fill_curve(90, 300) KEYED BY CATEGORY, in the '
  'RPC''s own column names so the cached reader and the live reader cannot '
  'drift. It is cached because it is a 44-second three-scan aggregate against a '
  '60s statement timeout AND it is anon-granted: /explore reads it under every '
  'tile of its default view, and with no writer for this key the page''s '
  '"fallback" was its only path -- one 44s scan per page view on a prerendered, '
  'daily-sitemapped page, the get_transparent_employers bill this board has '
  'already paid once. sufficient, dated_coverage and window_days ride along '
  'untouched: the page gates on all three, and a cache that dropped any of them '
  'would publish a rate its own gate never saw. '
  'ADDED: field_grid (get_explore_field_grid -- eighteen tiles partitioning the '
  'whole serving population, plus each constraint chip''s count AND its own '
  'denominator, from one pass) and chip_coverage (get_filter_coverage, READ '
  'here rather than re-derived so a chip on /explore and the coverage sentence '
  'on /jobs quote one scan). role_rows is a READ-THROUGH of the '
  'explore_role_rows meta key, written six-hourly by '
  'refresh_explore_role_rows: its own `at` and `status` ride inside the block '
  'and are NOT overwritten by this run''s clock, so a fresh cache timestamp can '
  'never vouch for a vocabulary that stopped recomputing. Those two are KEPT '
  'while unread, and the distinction from the three removed above is the '
  'direction of travel: transparent, salary and ageout_basis are dead work '
  'outliving a deleted renderer, while these are the cached form of numbers '
  'sections 2 and 3 currently take from live probes -- new work arriving before '
  'its reader, not old work outliving one. '
  '`fields` keeps its {category: n} shape but is now a PROJECTION of '
  'field_grid rather than a second scan of the same question -- two scans of '
  'one quantity at two instants is how a tile and its own number come to '
  'disagree. get_explore_denominators'' copy is the fallback for the case where '
  'the grid failed, which stale_parts already names. '
  'totals.postings_pay_n COUNTS `salary IS NOT NULL` -- the widest of the three '
  'pay columns, meaning the employer wrote something in a pay field, parseable '
  'or not. It is a TRANSPARENCY statistic and NO FILTER BINDS IT. A pay chip '
  'must quote chip_coverage.salaryFloor (salary_rank_usd, the only column a pay '
  'floor can compare against); quoting postings_pay_n or hasStatedPay beside a '
  'pay control overstates that control''s reach. See 20260909100000, which '
  'exists because this board published 20.1%, 12.9% and "~4%" for one fact. '
  'repost_index IS RETAINED BECAUSE IT IS STILL READ -- checked, not assumed: '
  'the rebuilt Explore.tsx takes it into state and consumes it on the employer '
  'surface that survives this ship. totals.repost_flagged_n is the key that '
  'loses its reader here (it counted employers flagged inside the deleted '
  'hiring leaderboard); it is kept for one ship because removing it also has to '
  'move a guard, and it costs nothing, being a key count over an index that is '
  'computed anyway. '
  'BUDGET: 15min, which must stay at or above the sum of the callees'' own '
  'ceilings -- a callee''s SET overrides the caller''s, so nothing but this '
  'value bounds their total, and exceeding it rolls back the write and loses '
  'every collection including the healthy ones. That sum is now 90 + 20 + 45 '
  '+ 120 + 60 = 335s, down from 730s: the four leaderboard removals returned '
  '180s and the three unread blocks a further 440s, against 225s of additions.';

NOTIFY pgrst, 'reload schema';
