CREATE OR REPLACE FUNCTION public.get_category_fill_speed(p_days integer DEFAULT 90)
RETURNS TABLE (
  category text,
  closures bigint,
  median_days_open numeric,
  p75_days_open numeric,
  window_days integer
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  WITH observed AS (
    SELECT LEAST(
             p_days,
             GREATEST(1, CEIL(EXTRACT(epoch FROM (now() - MIN(closed_at))) / 86400.0))::integer
           ) AS depth
    FROM public.job_board_closures
  )
  SELECT
    c.category,
    count(*) AS closures,
    round((percentile_cont(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (c.closed_at - COALESCE(c.posted_at, c.first_seen))) / 86400.0))::numeric, 1),
    round((percentile_cont(0.75) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (c.closed_at - COALESCE(c.posted_at, c.first_seen))) / 86400.0))::numeric, 1),
    (SELECT depth FROM observed)
  FROM public.job_board_closures c
  WHERE c.closed_at > now() - (p_days || ' days')::interval
    AND c.superseded IS NOT TRUE
    AND COALESCE(c.posted_at, c.first_seen) IS NOT NULL
    AND c.closed_at >= COALESCE(c.posted_at, c.first_seen)
  GROUP BY c.category
  HAVING count(*) >= 300
  ORDER BY count(*) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_category_fill_speed(integer) TO anon, authenticated;