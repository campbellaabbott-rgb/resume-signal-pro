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
    stale := stale || 'trending'::text;
    trending_v := COALESCE(prev -> 'trending', '[]'::jsonb);
    WHEN OTHERS THEN
    stale := stale || 'trending'::text;
    trending_v := COALESCE(prev -> 'trending', '[]'::jsonb);
  END;
  BEGIN
    newest_v := (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_newest_companies(12) x);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'newest'::text;
    newest_v := COALESCE(prev -> 'newest', '[]'::jsonb);
    WHEN OTHERS THEN
    stale := stale || 'newest'::text;
    newest_v := COALESCE(prev -> 'newest', '[]'::jsonb);
  END;
  BEGIN
    entry_v := (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_entry_level_companies(12) x);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'entry'::text;
    entry_v := COALESCE(prev -> 'entry', '[]'::jsonb);
    WHEN OTHERS THEN
    stale := stale || 'entry'::text;
    entry_v := COALESCE(prev -> 'entry', '[]'::jsonb);
  END;
  BEGIN
    salary_v := (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_salary_benchmarks() x);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'salary'::text;
    salary_v := COALESCE(prev -> 'salary', '[]'::jsonb);
    WHEN OTHERS THEN
    stale := stale || 'salary'::text;
    salary_v := COALESCE(prev -> 'salary', '[]'::jsonb);
  END;
  BEGIN
    segments_v := (SELECT coalesce(public.get_size_segments(), '{}'::jsonb));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'segments'::text;
    segments_v := COALESCE(prev -> 'segments', '{}'::jsonb);
    WHEN OTHERS THEN
    stale := stale || 'segments'::text;
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

CREATE OR REPLACE FUNCTION public.refresh_transparency_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET statement_timeout = '3min'
AS $$
DECLARE
  prev jsonb := '{}'::jsonb;
  pay_v jsonb;
  cov_v jsonb;
  stale text[] := '{}';
BEGIN
  SELECT COALESCE(v, '{}'::jsonb) INTO prev
    FROM public.job_board_meta WHERE k = 'transparency_cache';

  BEGIN
    pay_v := public.get_pay_transparency();
  EXCEPTION
    WHEN QUERY_CANCELED THEN
      stale := stale || 'pay'::text;
      pay_v := prev -> 'pay';
    WHEN OTHERS THEN
      stale := stale || 'pay'::text;
      pay_v := prev -> 'pay';
  END;

  BEGIN
    cov_v := public.get_transparency_coverage();
  EXCEPTION
    WHEN QUERY_CANCELED THEN
      stale := stale || 'coverage'::text;
      cov_v := prev -> 'coverage';
    WHEN OTHERS THEN
      stale := stale || 'coverage'::text;
      cov_v := prev -> 'coverage';
  END;

  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('transparency_cache', jsonb_build_object(
    'pay', pay_v,
    'coverage', cov_v,
    'stale_parts', to_jsonb(stale),
    'computed_at', now()), now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

NOTIFY pgrst, 'reload schema';