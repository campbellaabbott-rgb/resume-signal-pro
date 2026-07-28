DROP FUNCTION IF EXISTS public.get_ghost_job_index_stats();

CREATE FUNCTION public.get_ghost_job_index_stats()
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
  WITH counts AS (
    SELECT
      count(*) FILTER (WHERE missing_since IS NULL)                        AS open_n,
      count(posted_at) FILTER (WHERE missing_since IS NULL)                AS dated_n,
      count(DISTINCT company_token) FILTER (WHERE missing_since IS NULL)   AS tokens_n,
      count(DISTINCT company) FILTER (WHERE missing_since IS NULL AND company <> '') AS names_n
    FROM public.job_board_postings
  )
  SELECT
    (SELECT open_n FROM counts),
    (SELECT tokens_n FROM counts),
    (SELECT names_n FROM counts),
    (SELECT count(*) FROM public.job_board_closures WHERE closed_at > now() - interval '90 days'),
    (SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (now() - MIN(closed_at))) / 86400.0))::integer
       FROM public.job_board_closures),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (
       ORDER BY GREATEST(EXTRACT(EPOCH FROM (now() - posted_at)) / 86400.0, 0)))::numeric, 1)
     FROM public.job_board_postings
     WHERE missing_since IS NULL AND posted_at IS NOT NULL),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (
       ORDER BY EXTRACT(EPOCH FROM (closed_at - posted_at)) / 86400.0))::numeric, 1)
     FROM public.job_board_closures
     WHERE closed_at > now() - interval '90 days'
       AND posted_at IS NOT NULL
       AND closed_at >= posted_at),
    (SELECT CASE WHEN open_n > 0 THEN round(100.0 * dated_n / open_n, 1) END FROM counts);
$$;

GRANT EXECUTE ON FUNCTION public.get_ghost_job_index_stats() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_date_coverage()
RETURNS TABLE (source text, total bigint, dated bigint)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  SELECT source, count(*) AS total, count(posted_at) AS dated
  FROM public.job_board_postings
  WHERE missing_since IS NULL
  GROUP BY source
  ORDER BY count(*) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_date_coverage() TO anon, authenticated;