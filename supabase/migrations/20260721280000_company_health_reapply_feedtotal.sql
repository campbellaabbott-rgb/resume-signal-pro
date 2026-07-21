-- Data audit finding #1: the company-lander Hiring Health card still serves the
-- OLD raw-closure numbers (probed live: BoxLunch closed_90d = 2512 — the exact
-- churn fiction removed from Explore). Root cause: TWO migrations shared the
-- 20260721230000 timestamp (windowed_closure_purge + company_health_real_fills)
-- and the migration runner applied only one. Never reuse a timestamp prefix.
-- This re-applies the genuine-fills definition under a unique timestamp, and —
-- audit finding #2 — adds feed_total: the company's own advertised posting
-- count captured at fetch time (Workday), so windowed boards can display
-- "500+" instead of a false-precision floor ("503 open" while Caterpillar
-- advertises 942). Plain nullable ADD COLUMN: no table rewrite, no index.

ALTER TABLE public.job_board_verifications
  ADD COLUMN IF NOT EXISTS feed_total integer;

DROP FUNCTION IF EXISTS public.get_company_hiring_health(text[]);
CREATE FUNCTION public.get_company_hiring_health(p_tokens text[])
RETURNS TABLE (
  company_token text, open_roles integer, closed_90d integer, superseded_90d integer,
  median_days_open numeric, median_days_to_close numeric, tracking_days integer,
  feed_total integer
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH toks AS (SELECT DISTINCT unnest(p_tokens) AS t),
  span AS (
    SELECT LEAST(GREATEST(EXTRACT(DAY FROM now() - min(closed_at))::int, 1), 90) AS days
    FROM public.job_board_closures
  ),
  live AS (
    SELECT company_token, count(*)::int AS open_roles,
           (percentile_cont(0.5) WITHIN GROUP (ORDER BY GREATEST(EXTRACT(EPOCH FROM (now() - posted_at)) / 86400.0, 0))
             FILTER (WHERE posted_at IS NOT NULL))::numeric AS median_days_open
    FROM public.job_board_postings WHERE company_token = ANY (p_tokens) GROUP BY company_token
  ),
  closed AS (
    SELECT company_token,
           count(*) FILTER (
             WHERE closed_at > now() - interval '90 days'
               AND NOT superseded
               AND closed_at - COALESCE(posted_at, first_seen) >= interval '7 days'
           )::int AS closed_90d,
           count(*) FILTER (WHERE closed_at > now() - interval '90 days' AND superseded)::int AS superseded_90d,
           (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (closed_at - posted_at)) / 86400.0)
             FILTER (WHERE closed_at > now() - interval '90 days'
                       AND NOT superseded
                       AND posted_at IS NOT NULL
                       AND closed_at - posted_at >= interval '7 days'))::numeric AS median_days_to_close
    FROM public.job_board_closures WHERE company_token = ANY (p_tokens) GROUP BY company_token
  ),
  ver AS (
    SELECT company_token, feed_total FROM public.job_board_verifications
    WHERE company_token = ANY (p_tokens)
  )
  SELECT toks.t AS company_token,
         COALESCE(live.open_roles, 0) AS open_roles,
         COALESCE(closed.closed_90d, 0) AS closed_90d,
         COALESCE(closed.superseded_90d, 0) AS superseded_90d,
         round(live.median_days_open, 1) AS median_days_open,
         round(closed.median_days_to_close, 1) AS median_days_to_close,
         (SELECT days FROM span) AS tracking_days,
         ver.feed_total
  FROM toks
  LEFT JOIN live ON live.company_token = toks.t
  LEFT JOIN closed ON closed.company_token = toks.t
  LEFT JOIN ver ON ver.company_token = toks.t;
$$;
GRANT EXECUTE ON FUNCTION public.get_company_hiring_health(text[]) TO anon, authenticated;
