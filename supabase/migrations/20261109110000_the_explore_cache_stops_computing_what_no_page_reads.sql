-- THE EXPLORE CACHE STOPS COMPUTING WHAT NO PAGE READS (cost audit
-- 2026-11-08, db-cadence lane, "do first" #4).
--
-- get_explore_cache has one consumer, src/pages/Explore.tsx, and the page
-- reads three things from the row: field_grid (the chips' per-field coverage
-- sentence), repost_index (the employer surface) and stale_parts (the
-- staleness line, which ignores every name on its UNRENDERED_CACHE_PARTS
-- list). Read-only on 2026-11-08 the row was 36,435 bytes, and 28,935 of
-- them were keys nothing reads: field_curves 15,042, role_rows 12,997,
-- chip_coverage 362, fields 342, totals 192. The :07 run that writes it took
-- 171.9 s last and 241.3 s at most over 24 hours (get_cron_health), every
-- hour.
--
-- WHAT GOES, AND WHERE EACH ONE'S NUMBER STILL LIVES.
--   field_curves   the per-field fill curve at (90, 300). The hourly stats
--                  cache (refresh_stats_cache, :27, 20260928004823) computes
--                  the same rows with its own stamp and variant, and that is
--                  the copy the data pages and section 7h of the verifier now
--                  read. Computing it here too was a second full pass over
--                  the closure record every hour for a key with no reader.
--   chip_coverage  the board-wide filter coverage. The job-board pass end
--                  still computes and stores it for /jobs; this copy had no
--                  reader since the chips moved to field_grid.
--   denominators   the pool sizes behind totals. The last sentence that
--                  quoted them left the page with the old reach fraction.
--                  `totals` keeps only repost_flagged_n (a key count over
--                  repost_index, computed anyway, still pinned by a guard),
--                  and `fields` falls back to the previous run's copy instead
--                  of to the denominators when the grid fails.
--   role_rows      a read-through of the explore_role_rows row, which only
--                  the deleted role sections ever read. Its writer's cron,
--                  'refresh-explore-role-rows' ('22 */6 * * *', 32.8 s last),
--                  is unscheduled below.
--
-- KEPT: field_grid and repost_index, both read; fields and totals, both
-- cheap projections; stale_parts and computed_at. The header stays at 15min,
-- above the sum of the two remaining callees' own ceilings (120 s + 90 s).
-- refresh_explore_role_rows(), get_explore_denominators() and the stored
-- explore_role_rows row are left in place, unreferenced: re-arming the role
-- vocabulary is one cron.schedule call, and dropping a function is its own
-- decision, never a side effect of a cost change.
--
-- THE ROW IS NOT EDITED HERE. The next :07 run replaces the whole row with
-- the smaller payload, so a row without the four keys is the proof the new
-- body ran; until then today's row keeps serving and the page renders the
-- same from either (src/test/the-explore-page-renders-the-same-from-the-
-- slimmer-cache.test.tsx mounts it against both).
--
-- Safe to re-run: the function is replaced whole, the unschedule runs only
-- for a job that exists in cron.job, and the self-check reads the catalogue.

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
  totals jsonb;
  field_grid_v jsonb := '{}'::jsonb;
  fields_v jsonb := '{}'::jsonb;
BEGIN
  SELECT COALESCE(v, '{}'::jsonb) INTO prev
    FROM public.job_board_meta WHERE k = 'explore_cache';

  -- THE FIELD GRID: eighteen tiles over the whole serving population, plus
  -- every chip's count and its own denominator. Carried forward and named on
  -- failure, never zeroed: an empty object here is a coverage sentence with
  -- nothing saying why.
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

  -- THE REPOST INDEX, read by the employer surface.
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

  -- ONE PER-FIELD COUNT, FROM ONE SCAN: a projection of the grid. When the
  -- grid failed it is the carried grid's projection, and stale_parts already
  -- names field_grid; the previous run's copy is the last fallback.
  BEGIN
    fields_v := COALESCE(
      (SELECT jsonb_object_agg(kv.key, (kv.value ->> 'n')::int)
         FROM jsonb_each(field_grid_v -> 'fields') kv),
      COALESCE(prev -> 'fields', '{}'::jsonb));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    fields_v := COALESCE(prev -> 'fields', '{}'::jsonb);
    WHEN OTHERS THEN
    fields_v := COALESCE(prev -> 'fields', '{}'::jsonb);
  END;

  -- strip_nulls + NULLIF(_, 0): a zero here is a broken scan, and the honest
  -- render is no key at all.
  totals := jsonb_strip_nulls(jsonb_build_object(
    'repost_flagged_n', NULLIF((SELECT count(*)::int FROM jsonb_object_keys(repost_idx)), 0)
  ));

  payload := jsonb_build_object(
    'field_grid', field_grid_v,
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

REVOKE ALL ON FUNCTION public.refresh_explore_cache() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.refresh_explore_cache() IS
  'Hourly Explore cache (cron refresh-explore-cache, minute 7). KEYS: field_grid, '
  'repost_index, fields, totals, stale_parts, computed_at. Every block is '
  'optional: a failing callee costs one stale section (previous value carried, '
  'named in stale_parts), never the hour''s write. get_explore_cache has one '
  'consumer, src/pages/Explore.tsx, and it reads field_grid, repost_index and '
  'stale_parts. REMOVED 2026-11-09 (20261109110000) because nothing read them: '
  'field_curves (the stats cache carries the same per-field curve at (90, 300) '
  'with its own stamp), chip_coverage (the job-board pass end still stores it '
  'for /jobs), the denominators behind totals, and the role_rows read-through '
  '(its six-hourly writer is unscheduled in the same file). fields is a '
  'projection of field_grid; totals keeps only repost_flagged_n. BUDGET: 15min, '
  'at or above the sum of the callees'' own ceilings (field grid 120 s, repost '
  'index 90 s): a callee''s SET overrides the caller''s, so only this value '
  'bounds their total.';

DO $$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; there is no role-rows schedule to remove';
    RETURN;
  END IF;

  FOR r IN
    SELECT j.jobid, j.jobname FROM cron.job j
     WHERE j.jobname = 'refresh-explore-role-rows'
        OR j.command ~ 'refresh_explore_role_rows[[:space:]]*\('
     ORDER BY j.jobid
  LOOP
    IF coalesce(r.jobname, '') <> '' THEN
      PERFORM cron.unschedule(r.jobname);
    ELSE
      PERFORM cron.unschedule(r.jobid);
    END IF;
    RAISE NOTICE 'unscheduled pg_cron job % (%), which rebuilt role rows nothing reads',
      r.jobid, coalesce(nullif(r.jobname, ''), 'unnamed');
  END LOOP;
END $$;

DO $$
DECLARE
  v_src text;
  v_cfg text[];
  v_left int;
BEGIN
  SELECT p.prosrc, p.proconfig INTO v_src, v_cfg
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.refresh_explore_cache()');
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'self-check: refresh_explore_cache() does not exist';
  END IF;
  IF v_src ~ 'get_category_fill_curve|get_filter_coverage|get_explore_denominators|explore_role_rows' THEN
    RAISE EXCEPTION 'self-check: refresh_explore_cache() still computes or reads a part no page reads';
  END IF;
  IF v_src !~ 'get_explore_field_grid' OR v_src !~ 'get_repost_index' THEN
    RAISE EXCEPTION 'self-check: refresh_explore_cache() lost a part the page reads';
  END IF;
  IF v_cfg IS NULL OR NOT ('statement_timeout=15min' = ANY(v_cfg)) THEN
    RAISE EXCEPTION 'self-check: refresh_explore_cache() header is %, want statement_timeout=15min', v_cfg;
  END IF;
  IF to_regprocedure('public.refresh_explore_role_rows()') IS NULL THEN
    RAISE EXCEPTION 'self-check: refresh_explore_role_rows() is gone; this migration only stops its schedule';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  SELECT count(*) INTO v_left
    FROM cron.job j
   WHERE j.jobname = 'refresh-explore-role-rows'
      OR j.command ~ 'refresh_explore_role_rows[[:space:]]*\(';
  IF v_left > 0 THEN
    RAISE EXCEPTION 'self-check: % pg_cron job(s) still rebuild the explore role rows', v_left;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
