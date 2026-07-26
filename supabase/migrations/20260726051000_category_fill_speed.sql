-- Per-FIELD time-to-fill from the closure log (wave-2 rank 9). Every published
-- close-speed stat is per-company; the seeker question "how fast do roles in
-- my field close?" was unanswerable although the 100k-event log holds it.
--
-- Same fill-vs-churn semantics as get_employer_benchmarks v2, verbatim: only
-- closures that stayed posted 7+ days count (same-day churn is not hiring),
-- company-stated posted_at preferred over our first_seen, 365-day sanity cap.
-- The n-floor is 300 PER CATEGORY — far above the per-company floor because
-- this number will be published on a public page and quoted; a category that
-- can't clear it returns no row (we show nothing rather than a guess).
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
