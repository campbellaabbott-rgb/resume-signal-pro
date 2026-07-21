-- Data-page accuracy audit (Ghost Job Index + Weekly Hiring Trends). Three
-- inaccuracies, all descendants of provenance classes proven earlier today:
--
-- (1) get_hiring_trends charted weeks BEFORE our tracking began. Its honesty
--     guard (first_seen - posted_at < 3d) depends on first_seen, which was
--     mass-reset 2026-07-11 — so pre-reset weeks show near-zero counts that
--     read as a hiring explosion. And closure counts before the log's first
--     event (2026-07-14) are structurally zero. The trend SHAPE was an
--     artifact of our resets, not the market. Fix: clamp the series to weeks
--     from the tracking epoch (the closure log's first week — a fixed date,
--     180d retention), and correct survivorship by counting posted dates from
--     closed rows too (a role posted last week that already closed must still
--     count as posted last week; superseded rows excluded or relists would
--     double-count).
--
-- (2) get_trending_categories compared last-7d counts against a prior-7d
--     window that is still reset-crippled (undercounted) — inflating every
--     "+N%" arrow. Fix: return prior7 = NULL until the full 14-day window
--     lies inside the tracking epoch; the page shows no delta rather than a
--     wrong one.
--
-- (3) get_ghost_job_index_stats' median_days_to_close is right-censored: a
--     days-old log cannot yet contain slow closes, so "a typical role closes
--     in ~Nd" reads artificially fast. The RPC now reports tracking_days so
--     the page can state the record's true span and withhold the median
--     until the record is deep enough to support it (>= 21d, frontend-gated).

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
  -- Survivorship-corrected posted counts: live rows + already-closed rows
  -- (non-superseded only; a relist would count its reset date twice). The
  -- 3-day observation guard applies to both sides.
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

-- Recompute the stats cache so the pages serve corrected numbers now, not at
-- the next hourly cron. Guarded: the combined compute can exceed a migration
-- statement's patience; the :12 cron is the backstop.
DO $$
BEGIN
  SET LOCAL statement_timeout = '55s';
  PERFORM public.refresh_stats_cache();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
