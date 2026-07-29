-- Repairs a regression I introduced in 20260729090000, and lands the fix that
-- migration was actually for.
--
-- WHAT WENT WRONG
-- The live function is get_category_fill_speed(p_days, p_min_closures) — TWO
-- parameters. I wrote CREATE OR REPLACE with ONE. Different arity is a
-- different function, so instead of replacing it I created an overload; and
-- because every parameter on both has a DEFAULT, a no-argument call became
-- ambiguous:
--     PGRST203 "Could not choose the best candidate function"
-- The fill-speed line on 18 category landers went from overstating its window
-- to not rendering at all. That is strictly worse than the defect being fixed,
-- and it is the exact failure mode of assuming a signature instead of reading
-- it — the same mistake shape as three earlier today.
--
-- Two further errors in that migration, corrected here: it dropped
-- p_min_closures (hardcoding 300, so the caller lost control of the floor) and
-- it flipped SECURITY DEFINER to INVOKER, which would have put the whole query
-- under the anon statement_timeout on a table anon cannot read directly.
--
-- THE ORIGINAL FIX, now applied to the real signature
-- window_days returned LEAST(GREATEST(p_days,7),365) — the REQUESTED window,
-- echoed back. job_board_closures begins 2026-07-14, so the landers published
-- "over the last 90 days" against 15 days of evidence. Same defect as
-- get_employer_benchmarks (20260727120000) and the ghost stats observed_days
-- (20260727180000). It now reports the OBSERVED depth, and will return 90 on
-- its own once the log genuinely spans 90 days.
--
-- Everything else is carried over verbatim: the 7-365 day sanity clamp on the
-- interval, the >= 7 day / <= 365 day closure filters, the p_min_closures floor
-- and its GREATEST(...,50) guard, SECURITY DEFINER, and the ordering.

DROP FUNCTION IF EXISTS public.get_category_fill_speed(integer);

CREATE OR REPLACE FUNCTION public.get_category_fill_speed(
  p_days integer DEFAULT 90,
  p_min_closures integer DEFAULT 300
)
RETURNS TABLE (
  category text,
  closures bigint,
  median_days_open numeric,
  p75_days_open numeric,
  window_days integer      -- OBSERVED depth, never merely the requested window
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
    -- The requested window, clamped DOWN to how far the log actually reaches.
    -- Floored at 1 so a fresh log can never render as "over the last 0 days".
    LEAST(
      LEAST(GREATEST(p_days, 7), 365),
      (SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (now() - MIN(closed_at))) / 86400.0))::integer
         FROM public.job_board_closures)
    ) AS window_days
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
