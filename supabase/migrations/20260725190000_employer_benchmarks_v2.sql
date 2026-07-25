-- Benchmarks v2, one day after v1 — the first live rows exposed a metric flaw.
-- The "fastest fills" ASC sort surfaced employers with 0.3-0.8 DAY medians:
-- that is same-day posting churn (reposts, error postings), not hiring. This
-- page's own actively-hiring leaderboard already counts a fill ONLY when the
-- role stayed posted at least a week, exactly to filter that noise. The
-- benchmark now uses the same definition: closures with under 7 days on the
-- board are excluded from the median, and the surface says so. Truncation
-- biases the median upward by construction, which is why the label reads
-- "among roles posted at least a week", not "median time to fill".
CREATE OR REPLACE FUNCTION public.get_employer_benchmarks(
  p_days integer DEFAULT 90,
  p_min_closures integer DEFAULT 25,
  p_limit integer DEFAULT 30
)
RETURNS TABLE (
  company text,
  closures bigint,
  median_days_open numeric,
  window_days integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.company,
    count(*)::bigint AS closures,
    round(percentile_cont(0.5) WITHIN GROUP (
      ORDER BY extract(epoch FROM (c.closed_at - COALESCE(c.posted_at, c.first_seen))) / 86400.0
    )::numeric, 1) AS median_days_open,
    LEAST(GREATEST(p_days, 7), 365) AS window_days
  FROM public.job_board_closures c
  WHERE c.closed_at >= now() - make_interval(days => LEAST(GREATEST(p_days, 7), 365))
    AND c.company <> ''
    AND COALESCE(c.posted_at, c.first_seen) IS NOT NULL
    -- a week on the board is the fill-vs-churn line this page already uses
    AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'
    AND c.closed_at - COALESCE(c.posted_at, c.first_seen) <= interval '365 days'
  GROUP BY c.company
  HAVING count(*) >= GREATEST(p_min_closures, 5)
  ORDER BY median_days_open ASC, closures DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;
GRANT EXECUTE ON FUNCTION public.get_employer_benchmarks(integer, integer, integer) TO anon, authenticated, service_role;
