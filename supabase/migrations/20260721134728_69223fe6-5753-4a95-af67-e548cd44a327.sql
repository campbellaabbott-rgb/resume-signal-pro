-- ============ 20260721250000_repost_churn_collection.sql ============
CREATE OR REPLACE FUNCTION public.get_repost_churn_companies(p_limit int DEFAULT 12)
RETURNS TABLE (
  company text, company_token text,
  repost_events bigint, reposted_roles bigint,
  worst_title text, worst_count bigint,
  tracking_days int
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH sup AS (
    SELECT company_token, max(company) AS company, title,
           count(*) AS n, min(closed_at) AS first_ev
    FROM public.job_board_closures
    WHERE superseded
    GROUP BY company_token, title
  ),
  agg AS (
    SELECT company_token, max(company) AS company,
           sum(n)::bigint AS repost_events,
           count(*)::bigint AS reposted_roles,
           GREATEST(EXTRACT(DAY FROM now() - min(first_ev))::int, 1) AS tracking_days
    FROM sup
    GROUP BY company_token
    HAVING sum(n) >= 20
  ),
  worst AS (
    SELECT DISTINCT ON (company_token) company_token, title, n
    FROM sup ORDER BY company_token, n DESC
  )
  SELECT a.company, a.company_token, a.repost_events, a.reposted_roles,
         w.title AS worst_title, w.n::bigint AS worst_count, a.tracking_days
  FROM agg a
  JOIN worst w USING (company_token)
  ORDER BY a.repost_events DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.get_repost_churn_companies(int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_explore_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE payload jsonb;
BEGIN
  payload := jsonb_build_object(
    'trending', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_trending_companies(12) x),
    'newest',   (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_newest_companies(12) x),
    'entry',    (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_entry_level_companies(12) x),
    'hiring',   (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_actively_hiring_companies(12) x),
    'reposters',(SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_repost_churn_companies(12) x),
    'salary',   (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_salary_benchmarks() x),
    'computed_at', now()
  );
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('explore_cache', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

DO $$
BEGIN
  SET LOCAL statement_timeout = '40s';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- ============ 20260721260000_datapage_accuracy.sql ============
DROP FUNCTION IF EXISTS public.get_ghost_job_index_stats();
CREATE FUNCTION public.get_ghost_job_index_stats()
RETURNS TABLE (
  total_open bigint,
  total_companies bigint,
  closed_90d bigint,
  median_days_open numeric,
  median_days_to_close numeric,
  posted_coverage_pct numeric,
  tracking_days integer
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  SELECT
    (SELECT count(*) FROM public.job_board_postings),
    (SELECT count(DISTINCT company_token) FROM public.job_board_postings),
    (SELECT count(*) FROM public.job_board_closures
      WHERE closed_at > now() - interval '90 days' AND NOT superseded),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (
       ORDER BY GREATEST(EXTRACT(EPOCH FROM (now() - posted_at)) / 86400.0, 0)))::numeric, 1)
     FROM public.job_board_postings TABLESAMPLE SYSTEM (5)
     WHERE posted_at IS NOT NULL),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (
       ORDER BY EXTRACT(EPOCH FROM (closed_at - posted_at)) / 86400.0))::numeric, 1)
     FROM public.job_board_closures
     WHERE closed_at > now() - interval '90 days'
       AND NOT superseded
       AND posted_at IS NOT NULL
       AND closed_at >= posted_at),
    (SELECT round(100.0 * count(*) FILTER (WHERE posted_at IS NOT NULL) / GREATEST(count(*), 1), 0)
     FROM public.job_board_postings),
    (SELECT CASE WHEN min(closed_at) IS NULL THEN 0
                 ELSE LEAST(GREATEST(EXTRACT(DAY FROM now() - min(closed_at))::int, 1), 90) END
     FROM public.job_board_closures);
$$;
GRANT EXECUTE ON FUNCTION public.get_ghost_job_index_stats() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_hiring_trends()
RETURNS TABLE (week_start date, new_postings int, entry_new int, remote_new int, closed int)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public SET statement_timeout = '20s' AS $$
  WITH epoch AS (
    SELECT date_trunc('week', min(closed_at))::date AS w0 FROM public.job_board_closures
  ),
  weeks AS (
    SELECT date_trunc('week', d)::date AS week_start
    FROM generate_series(date_trunc('week', now() - interval '28 days'), now(), interval '1 week') d
    WHERE date_trunc('week', d)::date >= COALESCE((SELECT w0 FROM epoch), date_trunc('week', now())::date)
  ),
  posted_live AS (
    SELECT date_trunc('week', posted_at)::date AS w, count(*)::int AS n,
      (count(*) FILTER (WHERE experience_band = 'entry'))::int AS entry_new,
      (count(*) FILTER (WHERE remote))::int AS remote_new
    FROM public.job_board_postings
    WHERE posted_at IS NOT NULL AND posted_at > now() - interval '35 days'
      AND first_seen - posted_at < interval '3 days'
    GROUP BY 1
  ),
  posted_closed AS (
    SELECT date_trunc('week', posted_at)::date AS w, count(*)::int AS n
    FROM public.job_board_closures
    WHERE posted_at IS NOT NULL AND posted_at > now() - interval '35 days'
      AND NOT superseded
      AND first_seen IS NOT NULL AND first_seen - posted_at < interval '3 days'
    GROUP BY 1
  ),
  closes AS (
    SELECT date_trunc('week', closed_at)::date AS w, count(*)::int AS closed
    FROM public.job_board_closures
    WHERE closed_at > now() - interval '35 days' AND NOT superseded
    GROUP BY 1
  )
  SELECT weeks.week_start,
         COALESCE(posted_live.n, 0) + COALESCE(posted_closed.n, 0),
         COALESCE(posted_live.entry_new, 0),
         COALESCE(posted_live.remote_new, 0),
         COALESCE(closes.closed, 0)
  FROM weeks
  LEFT JOIN posted_live ON posted_live.w = weeks.week_start
  LEFT JOIN posted_closed ON posted_closed.w = weeks.week_start
  LEFT JOIN closes ON closes.w = weeks.week_start
  ORDER BY weeks.week_start;
$$;
GRANT EXECUTE ON FUNCTION public.get_hiring_trends() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_trending_categories()
RETURNS TABLE (category text, last7 int, prior7 int)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public SET statement_timeout = '20s' AS $$
  SELECT category,
    (count(*) FILTER (WHERE posted_at > now() - interval '7 days'))::int AS last7,
    CASE WHEN (SELECT min(closed_at) FROM public.job_board_closures) <= now() - interval '14 days'
         THEN (count(*) FILTER (WHERE posted_at <= now() - interval '7 days'))::int
         ELSE NULL END AS prior7
  FROM public.job_board_postings
  WHERE posted_at IS NOT NULL AND posted_at > now() - interval '14 days'
    AND first_seen - posted_at < interval '3 days'
  GROUP BY category
  HAVING count(*) FILTER (WHERE posted_at > now() - interval '7 days') >= 20
  ORDER BY 2 DESC LIMIT 15;
$$;
GRANT EXECUTE ON FUNCTION public.get_trending_categories() TO anon, authenticated;

DO $$
BEGIN
  SET LOCAL statement_timeout = '55s';
  PERFORM public.refresh_stats_cache();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;