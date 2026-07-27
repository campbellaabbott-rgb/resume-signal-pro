-- Benchmarks v3 — v2 published false statements about NAMED companies.
--
-- Verified live 2026-07-27 before this fix:
--   Valuenet Group  — "29 fills observed", 29 of 29 closures superseded
--   KEYENCE FRANCE  — "26 fills observed", 26 superseded
-- rendered on /ghost-job-index under a caption reading "same-day churn and
-- reposts don't count as fills. Measured over the last 90 days."
--
-- Three things were wrong at once:
--
-- 1. NO superseded FILTER. The sibling surfaces treat a superseded closure as
--    a RE-LIST, not a fill — the hiring-health panel even reports
--    superseded_90d separately so a churny employer can't look like a filler.
--    This function counted them as fills, so an employer that relists the same
--    role forever ranked as one that hires. Fixed: NOT c.superseded.
--
-- 2. window_days WAS THE REQUEST, NOT THE MEASUREMENT. It returned
--    LEAST(GREATEST(p_days,7),365) — i.e. the caller's own argument clamped —
--    and the page printed it as "measured over the last N days". The closure
--    log's earliest event is 2026-07-14; the real depth is under two weeks.
--    Fixed: observed_days is derived from the actual data (now() - the oldest
--    qualifying closure), so the surface can only ever claim what it watched.
--
-- 3. The floor was applied to an inflated count. With reposts excluded the
--    n>=25 floor now gates on GENUINE fills. If that empties the table, that
--    is the correct outcome and the page must render nothing — the fence is
--    "we show nothing rather than a guess", and a leaderboard of employers we
--    have not watched long enough is a guess with a company name attached.
--
-- window_days is kept in the signature (frontends read it) but now carries the
-- honest observed depth; observed_days is added as the explicit name.
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
      -- A re-list is not a fill. Counting superseded closures let an employer
      -- that recycles the same requisition outrank one that actually hires.
      AND NOT c.superseded
      -- a week on the board is the fill-vs-churn line this page already uses
      AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'
      AND c.closed_at - COALESCE(c.posted_at, c.first_seen) <= interval '365 days'
  ),
  depth AS (
    -- How long we have ACTUALLY been watching, floored at 1 day. This is what
    -- the surface is allowed to say; the caller's requested window is not
    -- evidence of anything.
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
