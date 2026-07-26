CREATE OR REPLACE FUNCTION public.get_category_fill_speed(
  p_days integer DEFAULT 90,
  p_min_closures integer DEFAULT 300
)
RETURNS TABLE (
  category text,
  closures bigint,
  median_days_open numeric,
  p75_days_open numeric,
  window_days integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  SELECT
    c.category,
    count(*)::bigint AS closures,
    round(percentile_cont(0.5) WITHIN GROUP (
      ORDER BY extract(epoch FROM (c.closed_at - COALESCE(c.posted_at, c.first_seen))) / 86400.0
    )::numeric, 1) AS median_days_open,
    round(percentile_cont(0.75) WITHIN GROUP (
      ORDER BY extract(epoch FROM (c.closed_at - COALESCE(c.posted_at, c.first_seen))) / 86400.0
    )::numeric, 1) AS p75_days_open,
    LEAST(GREATEST(p_days, 7), 365) AS window_days
  FROM public.job_board_closures c
  WHERE c.closed_at >= now() - make_interval(days => LEAST(GREATEST(p_days, 7), 365))
    AND c.category <> ''
    AND COALESCE(c.posted_at, c.first_seen) IS NOT NULL
    AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'
    AND c.closed_at - COALESCE(c.posted_at, c.first_seen) <= interval '365 days'
  GROUP BY c.category
  HAVING count(*) >= GREATEST(p_min_closures, 50)
  ORDER BY median_days_open ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_category_fill_speed(integer, integer) TO anon, authenticated, service_role;