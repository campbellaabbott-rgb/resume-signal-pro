-- The category fill-speed line publishes a 90-day window over 15 days of data.
--
-- get_category_fill_speed takes p_days DEFAULT 90 and returns that same 90 back
-- as window_days, which the lander then prints. But job_board_closures begins
-- at 2026-07-14T23:35Z — 15 days ago — so "over the last 90 days" describes a
-- window that has never existed. It is the same defect the employer benchmarks
-- had (fixed in 20260727120000) and the ghost stats had (observed_days, added
-- in 20260727180000): the REQUESTED window reported as though it were the
-- MEASURED one.
--
-- This is not cosmetic. A reader comparing "median 13.1 days to fill, over 90
-- days" against a competitor reasonably assumes a quarter of history behind it.
-- What is actually behind it is two weeks, which is a different claim about how
-- much we know — and the honest-brand fence is precisely that we never let a
-- number imply more evidence than we have.
--
-- window_days now reports the OBSERVED depth: the smaller of what was asked for
-- and how far the log actually reaches. Callers keep the same column and the
-- same type; the number simply stops overstating. Once the log genuinely spans
-- 90 days this returns 90 on its own, with no code change and no second chance
-- to forget.
CREATE OR REPLACE FUNCTION public.get_category_fill_speed(p_days integer DEFAULT 90)
RETURNS TABLE (
  category text,
  closures bigint,
  median_days_open numeric,
  p75_days_open numeric,
  window_days integer      -- OBSERVED depth, never merely the requested window
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  WITH observed AS (
    -- How deep the log actually goes, floored at 1 so a fresh log can never
    -- render as "over the last 0 days".
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
