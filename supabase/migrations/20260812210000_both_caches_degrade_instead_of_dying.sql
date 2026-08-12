-- THE DEPLOYED refresh_stats_cache IS NOT THE WRAPPED ONE, AND IT DIES WHOLE.
--
-- Evidence, 2026-08-12 job_run_details (jobname ~ '%stats%'):
--
--     17:45 succeeded | 17:35 FAILED 57014 in "count(*) FILTER (WHERE
--     missing_since IS NULL)" | 17:30 succeeded | 17:15 succeeded |
--     17:12 FAILED 57014 in "get_entry_level_stats statement 1" |
--     17:05 FAILED | 17:00 succeeded
--
-- The repo's refresh_stats_cache (20260809222603, "survives one slow query")
-- wraps EVERY section in BEGIN/EXCEPTION with a fallback to the previous
-- value. A run of that body cannot fail whole — a slow query costs one stale
-- section, recorded in stale_parts, and the INSERT still lands. Yet these runs
-- die with the error ESCAPING from inside sections whose handlers are right
-- there in the file, and yesterday's six-hour stall left the row completely
-- untouched — a wrapped body would have kept writing rows with stale_parts
-- growing. Both observations say the same thing: the DEPLOYED body predates
-- the wrapping. This project's migration runner has re-stamped files with new
-- timestamps carrying old content before; filename order does not track what
-- is deployed. So this migration RE-ASSERTS the wrapped body rather than
-- assuming any particular one is live.
--
-- Two hardenings while re-asserting:
--
--   FUNCTION-LEVEL statement_timeout = '5min'. The cron job runs as postgres,
--   whose role-level timeout was RESET during today's vacuum incident — role
--   GUC drift is now a demonstrated event, and a refresh governed by whatever
--   the role happens to carry dies at 120s under post-incident load. A
--   function-level SET re-arms on entry (proven in this repo: a callee's 25s
--   header killed at 25.46s inside a 90s caller) and makes the budget the
--   function's own fact.
--
--   EVERY section wrapped — including the ones added after the wrapping pass.
--
-- AND THE SAME DEFECT IN refresh_explore_cache, FIXED BEFORE ITS INCIDENT
-- RATHER THAN AFTER. Its 20260812020000 body wraps transparent/hiring/
-- reposters/repost_index/denominators — and calls trending, newest, entry,
-- salary and segments UNWRAPPED inside the payload build. One slow callee
-- under load kills the entire refresh and the hour's cache write with it;
-- explore missed its 17:07 tick today under exactly the load that was timing
-- the stats sections out. Same treatment: every optional section degrades to
-- the previous row's value, the write is unconditional, and stale_parts says
-- what degraded.

-- ── 1. refresh_stats_cache, re-asserted ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_stats_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
SET statement_timeout = '5min'
AS $$
DECLARE
  prev    jsonb := '{}'::jsonb;
  payload jsonb := '{}'::jsonb;
  stale   text[] := '{}';
BEGIN
  SELECT COALESCE(v, '{}'::jsonb) INTO prev
    FROM public.job_board_meta WHERE k = 'stats_cache';

  BEGIN
    payload := payload || jsonb_build_object('ghost_stats',
      (SELECT row_to_json(x) FROM public.get_ghost_job_index_stats() x LIMIT 1));
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'ghost_stats';
    payload := payload || jsonb_build_object('ghost_stats', prev -> 'ghost_stats');
  END;
  IF (payload -> 'ghost_stats') IS NULL OR jsonb_typeof(payload -> 'ghost_stats') = 'null' THEN
    stale := stale || 'ghost_stats';
    payload := payload || jsonb_build_object('ghost_stats', prev -> 'ghost_stats');
  END IF;

  BEGIN
    payload := payload || jsonb_build_object('date_coverage',
      (SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_date_coverage() x));
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'date_coverage';
    payload := payload || jsonb_build_object('date_coverage', COALESCE(prev -> 'date_coverage', '[]'::jsonb));
  END;

  BEGIN
    payload := payload || jsonb_build_object('entry_stats',
      (SELECT row_to_json(x) FROM public.get_entry_level_stats() x LIMIT 1));
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'entry_stats';
    payload := payload || jsonb_build_object('entry_stats', prev -> 'entry_stats');
  END;
  IF (payload -> 'entry_stats') IS NULL OR jsonb_typeof(payload -> 'entry_stats') = 'null' THEN
    stale := stale || 'entry_stats';
    payload := payload || jsonb_build_object('entry_stats', prev -> 'entry_stats');
  END IF;

  BEGIN
    payload := payload || jsonb_build_object('entry_companies',
      (SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_entry_level_companies(25) x));
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'entry_companies';
    payload := payload || jsonb_build_object('entry_companies', COALESCE(prev -> 'entry_companies', '[]'::jsonb));
  END;

  BEGIN
    payload := payload || jsonb_build_object('hiring_trends',
      (SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_hiring_trends() x));
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'hiring_trends';
    payload := payload || jsonb_build_object('hiring_trends', COALESCE(prev -> 'hiring_trends', '[]'::jsonb));
  END;

  BEGIN
    payload := payload || jsonb_build_object('trending_categories',
      (SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_trending_categories() x));
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'trending_categories';
    payload := payload || jsonb_build_object('trending_categories', COALESCE(prev -> 'trending_categories', '[]'::jsonb));
  END;

  payload := payload
    || jsonb_build_object('computed_at', now())
    || jsonb_build_object('stale_parts', to_jsonb(stale));

  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('stats_cache', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

COMMENT ON FUNCTION public.refresh_stats_cache() IS
  'Hourly stats cache. EVERY section is wrapped: a failing callee costs one '
  'stale section (named in stale_parts, previous value carried), never the '
  'run — a version without the wrapping was found deployed 2026-08-12, dying '
  'whole on intermittent 57014s. Function-level 5min budget so role-GUC drift '
  '(the vacuum-incident RESET) cannot re-cap it at 120s. The old SET LOCAL '
  '20s per section is gone: the callees carry their own 5-20s budgets, which '
  'override anyway (proven 25.46s), so the inner SET LOCALs only added a '
  'second, weaker copy of a fact the callees already own.';

-- ── 2. refresh_explore_cache, every section now optional ──────────────────
CREATE OR REPLACE FUNCTION public.refresh_explore_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
SET statement_timeout = '15min'
AS $$
DECLARE
  prev jsonb := '{}'::jsonb;
  payload jsonb;
  stale text[] := '{}';
  transparent jsonb := '[]'::jsonb;
  transparent_status text := 'ok';
  hiring_rows jsonb := '[]'::jsonb;
  hiring_n int := 0;
  repost_rows jsonb := '[]'::jsonb;
  repost_pool_n int := 0;
  repost_idx jsonb := '{}'::jsonb;
  denom jsonb := '{}'::jsonb;
  totals jsonb;
  trending_v jsonb;
  newest_v jsonb;
  entry_v jsonb;
  salary_v jsonb;
  segments_v jsonb;
BEGIN
  SELECT COALESCE(v, '{}'::jsonb) INTO prev
    FROM public.job_board_meta WHERE k = 'explore_cache';

  BEGIN
    transparent := COALESCE(public.get_transparent_employers(12), '[]'::jsonb);
    IF jsonb_typeof(transparent) <> 'array' THEN
      transparent_status := 'failed: expected array, got ' || jsonb_typeof(transparent);
      transparent := '[]'::jsonb;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    transparent := '[]'::jsonb;
    transparent_status := 'failed: ' || left(SQLERRM, 120);
    RAISE WARNING 'explore cache: transparent employers unavailable (%)', SQLERRM;
  END;

  BEGIN
    SELECT COALESCE(jsonb_agg(r.j ORDER BY r.rn) FILTER (WHERE r.rn <= 12), '[]'::jsonb),
           count(*)::int
      INTO hiring_rows, hiring_n
    FROM (SELECT to_jsonb(h) AS j, row_number() OVER () AS rn
          FROM public.get_actively_hiring_companies(2000) h) r;
  EXCEPTION WHEN OTHERS THEN
    hiring_rows := '[]'::jsonb; hiring_n := 0;
    RAISE WARNING 'explore cache: hiring unavailable (%)', SQLERRM;
  END;

  BEGIN
    SELECT COALESCE(jsonb_agg(r.j ORDER BY r.rn) FILTER (WHERE r.rn <= 12), '[]'::jsonb),
           count(*)::int
      INTO repost_rows, repost_pool_n
    FROM (SELECT to_jsonb(c) AS j, row_number() OVER () AS rn
          FROM public.get_repost_churn_companies(9000) c) r;
  EXCEPTION WHEN OTHERS THEN
    repost_rows := '[]'::jsonb; repost_pool_n := 0;
    RAISE WARNING 'explore cache: reposters unavailable (%)', SQLERRM;
  END;

  BEGIN
    repost_idx := COALESCE(public.get_repost_index(), '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    repost_idx := '{}'::jsonb;
    RAISE WARNING 'explore cache: repost index unavailable (%)', SQLERRM;
  END;

  BEGIN
    denom := COALESCE(public.get_explore_denominators(), '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    denom := '{}'::jsonb;
    RAISE WARNING 'explore cache: denominators unavailable (%)', SQLERRM;
  END;

  -- THE FIVE THAT WERE NEVER WRAPPED. Any one of them dying under load —
  -- get_salary_benchmarks at its 20s budget was enough today — killed the
  -- whole refresh and the hour's write. Each now degrades to the previous
  -- row's value and is named in stale_parts, exactly like stats_cache.
  BEGIN
    trending_v := (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_trending_companies(12) x);
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'trending';
    trending_v := COALESCE(prev -> 'trending', '[]'::jsonb);
  END;
  BEGIN
    newest_v := (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_newest_companies(12) x);
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'newest';
    newest_v := COALESCE(prev -> 'newest', '[]'::jsonb);
  END;
  BEGIN
    entry_v := (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_entry_level_companies(12) x);
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'entry';
    entry_v := COALESCE(prev -> 'entry', '[]'::jsonb);
  END;
  BEGIN
    salary_v := (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_salary_benchmarks() x);
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'salary';
    salary_v := COALESCE(prev -> 'salary', '[]'::jsonb);
  END;
  BEGIN
    segments_v := (SELECT coalesce(public.get_size_segments(), '{}'::jsonb));
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'segments';
    segments_v := COALESCE(prev -> 'segments', '{}'::jsonb);
  END;

  totals := (denom - 'fields') || jsonb_strip_nulls(jsonb_build_object(
    'hiring_n',        NULLIF(hiring_n, 0),
    'repost_pool_n',   NULLIF(repost_pool_n, 0),
    'repost_flagged_n', NULLIF((SELECT count(*)::int FROM jsonb_object_keys(repost_idx)), 0)
  ));

  payload := jsonb_build_object(
    'trending', trending_v,
    'newest',   newest_v,
    'entry',    entry_v,
    'hiring',   hiring_rows,
    'reposters', repost_rows,
    'salary',   salary_v,
    'segments', segments_v,
    'transparent', transparent,
    'transparent_status', transparent_status,
    'repost_index', repost_idx,
    'fields', COALESCE(denom -> 'fields', '{}'::jsonb),
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
  'Hourly Explore cache. EVERY section is optional: a failing callee costs '
  'one stale section (previous value carried, named in stale_parts), never '
  'the hour''s write. trending/newest/entry/salary/segments were unwrapped '
  'until 2026-08-12, when one of them dying under post-incident load cost the '
  '17:07 tick entirely. hiring/reposters are sliced to twelve from the SAME '
  'call that yields hiring_n/repost_pool_n so a collection and its stated '
  'denominator cannot disagree.';

NOTIFY pgrst, 'reload schema';
