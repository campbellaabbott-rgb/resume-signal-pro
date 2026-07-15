-- Closure-log accuracy: "Actively hiring" must mean the company actually took
-- roles down — not artifacts of our own pipeline. Three false-positive sources
-- are fixed at ingest (job-board refresh): age-outs at the 30-day freshness cap,
-- truncated SmartRecruiters fetches (SR_CAP displacement), and repost/relisting
-- churn. This migration adds the churn marker, purges the rows the old logger
-- polluted, and excludes churn from every hiring-health stat.

-- (1) Repost/relisting churn marker: a closure whose exact title was still live
-- at the same company when it vanished is a shuffle, not a fill.
ALTER TABLE public.job_board_closures
  ADD COLUMN IF NOT EXISTS superseded boolean NOT NULL DEFAULT false;

-- (2) Purge known-bad rows the old logger created (the log is days old; better
-- to drop identifiable pollution than report wrong numbers):
--   a) age-outs: closed ~30d after posting = our freshness cap, not a fill;
DELETE FROM public.job_board_closures
  WHERE closed_at - COALESCE(posted_at, first_seen) >= interval '29 days';
--   b) cap-displacement: closures for SmartRecruiters boards currently sitting
--      at the 800-posting fetch ceiling — their "closures" are indistinguishable
--      from postings displaced past the cap.
DELETE FROM public.job_board_closures c
  WHERE c.source = 'smartrecruiters'
    AND (SELECT count(*) FROM public.job_board_postings p
         WHERE p.company_token = c.company_token) >= 800;

-- (3) Exclude superseded churn from all three stats functions (definitions match
-- the live ::numeric versions, with the NOT superseded filters added).
CREATE OR REPLACE FUNCTION public.get_company_hiring_health(p_tokens text[])
RETURNS TABLE (
  company_token text,
  open_roles integer,
  closed_90d integer,
  median_days_open numeric,
  median_days_to_close numeric,
  tracking_days integer
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH toks AS (
    SELECT DISTINCT unnest(p_tokens) AS t
  ),
  live AS (
    SELECT company_token,
           count(*)::int AS open_roles,
           percentile_cont(0.5) WITHIN GROUP (
             ORDER BY GREATEST(EXTRACT(EPOCH FROM (now() - first_seen)) / 86400.0, 0)
           )::numeric AS median_days_open
    FROM public.job_board_postings
    WHERE company_token = ANY (p_tokens)
    GROUP BY company_token
  ),
  closed AS (
    SELECT company_token,
           count(*) FILTER (WHERE closed_at > now() - interval '90 days' AND NOT superseded)::int AS closed_90d,
           (percentile_cont(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (closed_at - COALESCE(posted_at, first_seen))) / 86400.0
           ) FILTER (
             WHERE closed_at > now() - interval '90 days'
               AND NOT superseded
               AND COALESCE(posted_at, first_seen) IS NOT NULL
               AND closed_at >= COALESCE(posted_at, first_seen)
           ))::numeric AS median_days_to_close,
           EXTRACT(DAY FROM (now() - min(closed_at)))::int AS tracking_days
    FROM public.job_board_closures
    WHERE company_token = ANY (p_tokens)
    GROUP BY company_token
  )
  SELECT
    toks.t AS company_token,
    COALESCE(live.open_roles, 0) AS open_roles,
    COALESCE(closed.closed_90d, 0) AS closed_90d,
    round(live.median_days_open, 1) AS median_days_open,
    round(closed.median_days_to_close, 1) AS median_days_to_close,
    COALESCE(closed.tracking_days, 0) AS tracking_days
  FROM toks
  LEFT JOIN live ON live.company_token = toks.t
  LEFT JOIN closed ON closed.company_token = toks.t;
$$;
GRANT EXECUTE ON FUNCTION public.get_company_hiring_health(text[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_ghost_job_index_stats()
RETURNS TABLE (
  total_open bigint,
  total_companies bigint,
  closed_90d bigint,
  median_days_open numeric,
  median_days_to_close numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT
    (SELECT count(*) FROM public.job_board_postings),
    (SELECT count(DISTINCT company_token) FROM public.job_board_postings),
    (SELECT count(*) FROM public.job_board_closures
      WHERE closed_at > now() - interval '90 days' AND NOT superseded),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (
       ORDER BY GREATEST(EXTRACT(EPOCH FROM (now() - first_seen)) / 86400.0, 0)))::numeric, 1)
     FROM public.job_board_postings),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (
       ORDER BY EXTRACT(EPOCH FROM (closed_at - COALESCE(posted_at, first_seen))) / 86400.0))::numeric, 1)
     FROM public.job_board_closures
     WHERE closed_at > now() - interval '90 days'
       AND NOT superseded
       AND COALESCE(posted_at, first_seen) IS NOT NULL
       AND closed_at >= COALESCE(posted_at, first_seen));
$$;
GRANT EXECUTE ON FUNCTION public.get_ghost_job_index_stats() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_actively_hiring_companies(p_limit int DEFAULT 20)
RETURNS TABLE (company text, company_token text, closed_90d bigint, open_roles bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT
    c.company,
    c.company_token,
    count(*) AS closed_90d,
    COALESCE((SELECT count(*) FROM public.job_board_postings p WHERE p.company_token = c.company_token), 0) AS open_roles
  FROM public.job_board_closures c
  WHERE c.closed_at > now() - interval '90 days' AND NOT c.superseded AND c.company <> ''
  GROUP BY c.company, c.company_token
  ORDER BY count(*) DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;
GRANT EXECUTE ON FUNCTION public.get_actively_hiring_companies(int) TO anon, authenticated;
