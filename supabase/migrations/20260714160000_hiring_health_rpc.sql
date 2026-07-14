-- Company Hiring-Health: the signal aggregators can't build, because it needs the
-- full lifecycle (open roles now + how fast roles actually CLOSE/fill), not a
-- snapshot. Reads two public tables:
--   job_board_postings  — live roles (open_roles, how long they've been open)
--   job_board_closures  — the closure event log (roles filled/pulled over time)
--
-- Honest by construction: closure data accrues only from when logging started, so
-- the function also returns tracking_days (how long we've watched THIS company's
-- closures). The UI uses it to gate claims — we never assert a company "doesn't
-- hire" from a short window; we say "still gathering" until the data is real.

CREATE OR REPLACE FUNCTION public.get_company_hiring_health(p_tokens text[])
RETURNS TABLE (
  company_token text,
  open_roles integer,
  closed_90d integer,
  median_days_open numeric,
  median_days_to_close numeric,
  tracking_days integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH toks AS (
    SELECT DISTINCT unnest(p_tokens) AS t
  ),
  live AS (
    SELECT company_token,
           count(*)::int AS open_roles,
           percentile_cont(0.5) WITHIN GROUP (
             ORDER BY GREATEST(EXTRACT(EPOCH FROM (now() - first_seen)) / 86400.0, 0)
           ) AS median_days_open
    FROM public.job_board_postings
    WHERE company_token = ANY (p_tokens)
    GROUP BY company_token
  ),
  closed AS (
    SELECT company_token,
           count(*) FILTER (WHERE closed_at > now() - interval '90 days')::int AS closed_90d,
           percentile_cont(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (closed_at - COALESCE(posted_at, first_seen))) / 86400.0
           ) FILTER (
             WHERE closed_at > now() - interval '90 days'
               AND COALESCE(posted_at, first_seen) IS NOT NULL
               AND closed_at >= COALESCE(posted_at, first_seen)
           ) AS median_days_to_close,
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

-- Public board data: callable by the anonymous board client (same as the facets RPC).
GRANT EXECUTE ON FUNCTION public.get_company_hiring_health(text[]) TO anon, authenticated;
