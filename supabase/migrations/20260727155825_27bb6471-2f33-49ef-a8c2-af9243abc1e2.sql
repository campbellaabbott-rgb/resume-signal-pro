-- Benchmarks v3 — v2 published false statements about NAMED companies.
DROP FUNCTION IF EXISTS public.get_employer_benchmarks(integer, integer, integer);

CREATE OR REPLACE FUNCTION public.get_employer_benchmarks(
  p_days integer DEFAULT 90,
  p_min_closures integer DEFAULT 25,
  p_limit integer DEFAULT 30
)
RETURNS TABLE (
  company text,
  closures bigint,
  median_days_open numeric,
  window_days integer,
  observed_days integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  WITH q AS (
    SELECT
      c.company,
      extract(epoch FROM (c.closed_at - COALESCE(c.posted_at, c.first_seen))) / 86400.0 AS days_open,
      c.closed_at
    FROM public.job_board_closures c
    WHERE c.closed_at >= now() - make_interval(days => LEAST(GREATEST(p_days, 7), 365))
      AND c.company <> ''
      AND COALESCE(c.posted_at, c.first_seen) IS NOT NULL
      AND NOT c.superseded
      AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'
      AND c.closed_at - COALESCE(c.posted_at, c.first_seen) <= interval '365 days'
  ),
  depth AS (
    SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (now() - MIN(closed_at))) / 86400.0))::integer AS d
    FROM q
  )
  SELECT
    q.company,
    count(*)::bigint AS closures,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY q.days_open)::numeric, 1) AS median_days_open,
    (SELECT d FROM depth) AS window_days,
    (SELECT d FROM depth) AS observed_days
  FROM q
  GROUP BY q.company
  HAVING count(*) >= GREATEST(p_min_closures, 5)
  ORDER BY median_days_open ASC, closures DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

GRANT EXECUTE ON FUNCTION public.get_employer_benchmarks(integer, integer, integer) TO anon, authenticated, service_role;