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
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'ghost_stats';
    payload := payload || jsonb_build_object('ghost_stats', prev -> 'ghost_stats');
    WHEN OTHERS THEN
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
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'date_coverage';
    payload := payload || jsonb_build_object('date_coverage', COALESCE(prev -> 'date_coverage', '[]'::jsonb));
    WHEN OTHERS THEN
    stale := stale || 'date_coverage';
    payload := payload || jsonb_build_object('date_coverage', COALESCE(prev -> 'date_coverage', '[]'::jsonb));
  END;

  BEGIN
    payload := payload || jsonb_build_object('entry_stats',
      (SELECT row_to_json(x) FROM public.get_entry_level_stats() x LIMIT 1));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'entry_stats';
    payload := payload || jsonb_build_object('entry_stats', prev -> 'entry_stats');
    WHEN OTHERS THEN
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
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'entry_companies';
    payload := payload || jsonb_build_object('entry_companies', COALESCE(prev -> 'entry_companies', '[]'::jsonb));
    WHEN OTHERS THEN
    stale := stale || 'entry_companies';
    payload := payload || jsonb_build_object('entry_companies', COALESCE(prev -> 'entry_companies', '[]'::jsonb));
  END;

  BEGIN
    payload := payload || jsonb_build_object('hiring_trends',
      (SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_hiring_trends() x));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'hiring_trends';
    payload := payload || jsonb_build_object('hiring_trends', COALESCE(prev -> 'hiring_trends', '[]'::jsonb));
    WHEN OTHERS THEN
    stale := stale || 'hiring_trends';
    payload := payload || jsonb_build_object('hiring_trends', COALESCE(prev -> 'hiring_trends', '[]'::jsonb));
  END;

  BEGIN
    payload := payload || jsonb_build_object('trending_categories',
      (SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_trending_categories() x));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'trending_categories';
    payload := payload || jsonb_build_object('trending_categories', COALESCE(prev -> 'trending_categories', '[]'::jsonb));
    WHEN OTHERS THEN
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
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    transparent := '[]'::jsonb;
    transparent_status := 'failed: ' || left(SQLERRM, 120);
    RAISE WARNING 'explore cache: transparent employers unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
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
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    hiring_rows := '[]'::jsonb; hiring_n := 0;
    RAISE WARNING 'explore cache: hiring unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
    hiring_rows := '[]'::jsonb; hiring_n := 0;
    RAISE WARNING 'explore cache: hiring unavailable (%)', SQLERRM;
  END;

  BEGIN
    SELECT COALESCE(jsonb_agg(r.j ORDER BY r.rn) FILTER (WHERE r.rn <= 12), '[]'::jsonb),
           count(*)::int
      INTO repost_rows, repost_pool_n
    FROM (SELECT to_jsonb(c) AS j, row_number() OVER () AS rn
          FROM public.get_repost_churn_companies(9000) c) r;
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    repost_rows := '[]'::jsonb; repost_pool_n := 0;
    RAISE WARNING 'explore cache: reposters unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
    repost_rows := '[]'::jsonb; repost_pool_n := 0;
    RAISE WARNING 'explore cache: reposters unavailable (%)', SQLERRM;
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

  BEGIN
    trending_v := (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_trending_companies(12) x);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'trending';
    trending_v := COALESCE(prev -> 'trending', '[]'::jsonb);
    WHEN OTHERS THEN
    stale := stale || 'trending';
    trending_v := COALESCE(prev -> 'trending', '[]'::jsonb);
  END;
  BEGIN
    newest_v := (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_newest_companies(12) x);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'newest';
    newest_v := COALESCE(prev -> 'newest', '[]'::jsonb);
    WHEN OTHERS THEN
    stale := stale || 'newest';
    newest_v := COALESCE(prev -> 'newest', '[]'::jsonb);
  END;
  BEGIN
    entry_v := (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_entry_level_companies(12) x);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'entry';
    entry_v := COALESCE(prev -> 'entry', '[]'::jsonb);
    WHEN OTHERS THEN
    stale := stale || 'entry';
    entry_v := COALESCE(prev -> 'entry', '[]'::jsonb);
  END;
  BEGIN
    salary_v := (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_salary_benchmarks() x);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'salary';
    salary_v := COALESCE(prev -> 'salary', '[]'::jsonb);
    WHEN OTHERS THEN
    stale := stale || 'salary';
    salary_v := COALESCE(prev -> 'salary', '[]'::jsonb);
  END;
  BEGIN
    segments_v := (SELECT coalesce(public.get_size_segments(), '{}'::jsonb));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'segments';
    segments_v := COALESCE(prev -> 'segments', '{}'::jsonb);
    WHEN OTHERS THEN
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

CREATE OR REPLACE FUNCTION public.refresh_ghost_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15min'
AS $$
DECLARE
  prev    jsonb := '{}'::jsonb;
  payload jsonb := '{}'::jsonb;
  stale   text[] := '{}';
  open_n   bigint;
  dated_n  bigint;
  tokens_n bigint;
  names_n  bigint;
BEGIN
  SELECT COALESCE(v, '{}'::jsonb) INTO prev
    FROM public.job_board_stats_rollup WHERE k = 'ghost_stats';

  BEGIN
    SET LOCAL statement_timeout = '8min';
    SELECT
      count(*) FILTER (WHERE missing_since IS NULL),
      count(posted_at) FILTER (WHERE missing_since IS NULL),
      count(DISTINCT company_token) FILTER (WHERE missing_since IS NULL),
      count(DISTINCT company) FILTER (WHERE missing_since IS NULL AND company <> '')
    INTO open_n, dated_n, tokens_n, names_n
    FROM public.job_board_postings;

    payload := jsonb_build_object(
      'total_open',          open_n,
      'total_companies',     tokens_n,
      'total_company_names', names_n,
      'posted_coverage_pct',
        CASE WHEN open_n > 0 THEN round(100.0 * dated_n / open_n, 1) END);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'counts';
    payload := jsonb_build_object(
      'total_open',          prev -> 'total_open',
      'total_companies',     prev -> 'total_companies',
      'total_company_names', prev -> 'total_company_names',
      'posted_coverage_pct', prev -> 'posted_coverage_pct');
    WHEN OTHERS THEN
    stale := stale || 'counts';
    payload := jsonb_build_object(
      'total_open',          prev -> 'total_open',
      'total_companies',     prev -> 'total_companies',
      'total_company_names', prev -> 'total_company_names',
      'posted_coverage_pct', prev -> 'posted_coverage_pct');
  END;

  BEGIN
    SET LOCAL statement_timeout = '5min';
    payload := payload || jsonb_build_object('median_days_open', (
      SELECT round(percentile_cont(0.5) WITHIN GROUP (
               ORDER BY GREATEST(EXTRACT(EPOCH FROM (now() - posted_at)) / 86400.0, 0)
             )::numeric, 1)
      FROM public.job_board_postings
      WHERE missing_since IS NULL AND posted_at IS NOT NULL));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'median_days_open';
    payload := payload || jsonb_build_object('median_days_open', prev -> 'median_days_open');
    WHEN OTHERS THEN
    stale := stale || 'median_days_open';
    payload := payload || jsonb_build_object('median_days_open', prev -> 'median_days_open');
  END;

  BEGIN
    SET LOCAL statement_timeout = '2min';
    payload := payload || jsonb_build_object(
      'closed_90d', (SELECT count(*) FROM public.job_board_closures
                      WHERE closed_at > now() - interval '90 days'),
      'observed_days', (SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (now() - MIN(closed_at))) / 86400.0))::integer
                          FROM public.job_board_closures),
      'median_days_to_close', (
        SELECT round((percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY EXTRACT(EPOCH FROM (closed_at - posted_at)) / 86400.0))::numeric, 1)
        FROM public.job_board_closures
        WHERE closed_at > now() - interval '90 days'
          AND posted_at IS NOT NULL
          AND closed_at >= posted_at));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'closures';
    payload := payload || jsonb_build_object(
      'closed_90d',           prev -> 'closed_90d',
      'observed_days',        prev -> 'observed_days',
      'median_days_to_close', prev -> 'median_days_to_close');
    WHEN OTHERS THEN
    stale := stale || 'closures';
    payload := payload || jsonb_build_object(
      'closed_90d',           prev -> 'closed_90d',
      'observed_days',        prev -> 'observed_days',
      'median_days_to_close', prev -> 'median_days_to_close');
  END;

  payload := payload || jsonb_build_object('stale_parts', to_jsonb(stale));

  INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
  VALUES ('ghost_stats', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, computed_at = EXCLUDED.computed_at;
END $$;

REVOKE ALL ON FUNCTION public.refresh_ghost_stats() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';