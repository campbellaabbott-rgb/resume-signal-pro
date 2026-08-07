CREATE OR REPLACE FUNCTION public.get_ghost_job_index_stats()
RETURNS TABLE (
  total_open bigint,
  total_companies bigint,
  total_company_names bigint,
  closed_90d bigint,
  observed_days integer,
  median_days_open numeric,
  median_days_to_close numeric,
  posted_coverage_pct numeric
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '60s'
AS $$
  WITH RECURSIVE
  counts AS (
    SELECT
      count(*) FILTER (WHERE missing_since IS NULL)         AS open_n,
      count(posted_at) FILTER (WHERE missing_since IS NULL) AS dated_n
    FROM public.job_board_postings
  ),
  tok AS (
      (SELECT p.company_token AS v
         FROM public.job_board_postings p
        WHERE p.company_token IS NOT NULL AND p.missing_since IS NULL
        ORDER BY p.company_token
        LIMIT 1)
    UNION ALL
      SELECT (SELECT p.company_token
                FROM public.job_board_postings p
               WHERE p.company_token > tok.v AND p.missing_since IS NULL
               ORDER BY p.company_token
               LIMIT 1)
        FROM tok
       WHERE tok.v IS NOT NULL
  ),
  nm AS (
      (SELECT p.company AS v
         FROM public.job_board_postings p
        WHERE p.company <> '' AND p.missing_since IS NULL
        ORDER BY p.company
        LIMIT 1)
    UNION ALL
      SELECT (SELECT p.company
                FROM public.job_board_postings p
               WHERE p.company > nm.v AND p.company <> '' AND p.missing_since IS NULL
               ORDER BY p.company
               LIMIT 1)
        FROM nm
       WHERE nm.v IS NOT NULL
  )
  SELECT
    (SELECT open_n FROM counts),
    (SELECT count(*) FROM tok WHERE v IS NOT NULL),
    (SELECT count(*) FROM nm  WHERE v IS NOT NULL),
    (SELECT count(*) FROM public.job_board_closures WHERE closed_at > now() - interval '90 days'),
    (SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (now() - MIN(closed_at))) / 86400.0))::integer
       FROM public.job_board_closures),
    (SELECT round(GREATEST(EXTRACT(EPOCH FROM (now() - p.posted_at)) / 86400.0, 0)::numeric, 1)
       FROM public.job_board_postings p
      WHERE p.missing_since IS NULL AND p.posted_at IS NOT NULL
      ORDER BY p.posted_at
     OFFSET GREATEST((SELECT dated_n FROM counts) / 2, 0)
      LIMIT 1),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (
       ORDER BY EXTRACT(EPOCH FROM (closed_at - posted_at)) / 86400.0))::numeric, 1)
     FROM public.job_board_closures
     WHERE closed_at > now() - interval '90 days'
       AND posted_at IS NOT NULL
       AND closed_at >= posted_at),
    (SELECT CASE WHEN open_n > 0 THEN round(100.0 * dated_n / open_n, 1) END FROM counts);
$$;

GRANT EXECUTE ON FUNCTION public.get_ghost_job_index_stats() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_stats_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  prev    jsonb := '{}'::jsonb;
  payload jsonb := '{}'::jsonb;
  stale   text[] := '{}';
BEGIN
  SELECT COALESCE(v, '{}'::jsonb) INTO prev
    FROM public.job_board_meta WHERE k = 'stats_cache';

  BEGIN
    SET LOCAL statement_timeout = '20s';
    payload := payload || jsonb_build_object('ghost_stats',
      (SELECT row_to_json(x) FROM public.get_ghost_job_index_stats() x LIMIT 1));
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'ghost_stats';
    payload := payload || jsonb_build_object('ghost_stats', prev -> 'ghost_stats');
  END;

  BEGIN
    SET LOCAL statement_timeout = '20s';
    payload := payload || jsonb_build_object('date_coverage',
      (SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_date_coverage() x));
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'date_coverage';
    payload := payload || jsonb_build_object('date_coverage', COALESCE(prev -> 'date_coverage', '[]'::jsonb));
  END;

  BEGIN
    SET LOCAL statement_timeout = '20s';
    payload := payload || jsonb_build_object('entry_stats',
      (SELECT row_to_json(x) FROM public.get_entry_level_stats() x LIMIT 1));
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'entry_stats';
    payload := payload || jsonb_build_object('entry_stats', prev -> 'entry_stats');
  END;

  BEGIN
    SET LOCAL statement_timeout = '20s';
    payload := payload || jsonb_build_object('entry_companies',
      (SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_entry_level_companies(25) x));
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'entry_companies';
    payload := payload || jsonb_build_object('entry_companies', COALESCE(prev -> 'entry_companies', '[]'::jsonb));
  END;

  BEGIN
    SET LOCAL statement_timeout = '20s';
    payload := payload || jsonb_build_object('hiring_trends',
      (SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_hiring_trends() x));
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'hiring_trends';
    payload := payload || jsonb_build_object('hiring_trends', COALESCE(prev -> 'hiring_trends', '[]'::jsonb));
  END;

  BEGIN
    SET LOCAL statement_timeout = '20s';
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
  'Rebuilds the hourly stats cache. Each of the six statistics is computed in '
  'its own block with a 20s timeout; a failing one keeps its previous value and '
  'names itself in stale_parts, so one slow query can never again blank the '
  'other five. On 2026-08-07 that is exactly what had happened, for four days.';