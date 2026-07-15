-- Entry-Level Index + weekly Hiring Trends: public transparency pages built on
-- the board's own live data. Every figure is computed from real postings and
-- real closures; where history hasn't accrued yet the pages say so instead of
-- faking one. All functions read public tables and return aggregates only.

-- ── Entry-level headline stats ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_entry_level_stats()
RETURNS TABLE (
  total_entry bigint,
  total_open bigint,
  companies_with_entry bigint,
  remote_entry bigint,
  by_category jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  SELECT
    count(*) FILTER (WHERE experience_band = 'entry'),
    count(*),
    count(DISTINCT company_token) FILTER (WHERE experience_band = 'entry'),
    count(*) FILTER (WHERE experience_band = 'entry' AND remote),
    (SELECT jsonb_object_agg(t.category, t.n)
     FROM (SELECT category, count(*)::int AS n
           FROM public.job_board_postings
           WHERE experience_band = 'entry'
           GROUP BY category ORDER BY n DESC LIMIT 12) t)
  FROM public.job_board_postings;
$$;
GRANT EXECUTE ON FUNCTION public.get_entry_level_stats() TO anon, authenticated;

-- Leaderboard: companies with the most entry-level openings right now.
-- >=5 entry roles keeps it meaningful (no one-off appearances).
CREATE OR REPLACE FUNCTION public.get_entry_level_companies(p_limit int DEFAULT 25)
RETURNS TABLE (company text, company_token text, entry_roles int, open_roles int)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  SELECT
    company,
    company_token,
    (count(*) FILTER (WHERE experience_band = 'entry'))::int AS entry_roles,
    count(*)::int AS open_roles
  FROM public.job_board_postings
  WHERE company <> ''
  GROUP BY company, company_token
  HAVING count(*) FILTER (WHERE experience_band = 'entry') >= 5
  ORDER BY 3 DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;
GRANT EXECUTE ON FUNCTION public.get_entry_level_companies(int) TO anon, authenticated;

-- ── Weekly hiring trends ────────────────────────────────────────────────────
-- New postings per week by the COMPANY'S OWN stated posting date, restricted to
-- postings we observed near their posting time (first_seen within 3 days of
-- posted_at). That guard makes week-over-week honest: when new companies join
-- the catalog their backlog would otherwise appear as a fake hiring spike.
-- Closures come from the lifecycle log (repost-supersessions excluded).
CREATE OR REPLACE FUNCTION public.get_hiring_trends()
RETURNS TABLE (week_start date, new_postings int, entry_new int, remote_new int, closed int)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  WITH weeks AS (
    SELECT date_trunc('week', d)::date AS week_start
    FROM generate_series(date_trunc('week', now() - interval '28 days'), now(), interval '1 week') d
  ),
  posted AS (
    SELECT date_trunc('week', posted_at)::date AS w,
      count(*)::int AS new_postings,
      (count(*) FILTER (WHERE experience_band = 'entry'))::int AS entry_new,
      (count(*) FILTER (WHERE remote))::int AS remote_new
    FROM public.job_board_postings
    WHERE posted_at IS NOT NULL
      AND posted_at > now() - interval '35 days'
      AND first_seen - posted_at < interval '3 days'
    GROUP BY 1
  ),
  closes AS (
    SELECT date_trunc('week', closed_at)::date AS w, count(*)::int AS closed
    FROM public.job_board_closures
    WHERE closed_at > now() - interval '35 days' AND NOT superseded
    GROUP BY 1
  )
  SELECT weeks.week_start,
         COALESCE(posted.new_postings, 0),
         COALESCE(posted.entry_new, 0),
         COALESCE(posted.remote_new, 0),
         COALESCE(closes.closed, 0)
  FROM weeks
  LEFT JOIN posted ON posted.w = weeks.week_start
  LEFT JOIN closes ON closes.w = weeks.week_start
  ORDER BY weeks.week_start;
$$;
GRANT EXECUTE ON FUNCTION public.get_hiring_trends() TO anon, authenticated;

-- Which fields are hiring this week: rolling 7-day vs prior-7-day new postings
-- per category (rolling windows avoid partial-week artifacts). Same
-- catalog-growth guard; >=20 postings this week keeps deltas meaningful.
CREATE OR REPLACE FUNCTION public.get_trending_categories()
RETURNS TABLE (category text, last7 int, prior7 int)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  SELECT category,
    (count(*) FILTER (WHERE posted_at > now() - interval '7 days'))::int AS last7,
    (count(*) FILTER (WHERE posted_at <= now() - interval '7 days'))::int AS prior7
  FROM public.job_board_postings
  WHERE posted_at IS NOT NULL
    AND posted_at > now() - interval '14 days'
    AND first_seen - posted_at < interval '3 days'
  GROUP BY category
  HAVING count(*) FILTER (WHERE posted_at > now() - interval '7 days') >= 20
  ORDER BY 2 DESC
  LIMIT 15;
$$;
GRANT EXECUTE ON FUNCTION public.get_trending_categories() TO anon, authenticated;
