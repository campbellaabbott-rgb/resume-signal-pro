-- The Jobs company landers badge "Actively hiring" off get_company_hiring_health's
-- closed_90d — a RAW closure count, so repost/feed churn qualified. Proven live
-- 2026-07-21: BoxLunch had 3093 closures with median tenure 3.0d, max 3.0d,
-- 0% >= 7d — a feed cycling roles every ~3 days, zero real fills — yet it wore
-- the badge (threshold: 3 raw closures). The "/90d" framing is also false: the
-- closure log's oldest event is 2026-07-14.
--
-- Redefine closed_90d on the signal Explore and the Ghost Job Index already use
-- (20260721210000): genuine-tenure fills — non-superseded closures where the
-- role stayed posted >= 7 days (company's stated posted_at when given, else
-- first_seen) before coming down. The OUT column keeps its name for frontend
-- compat; 90 days is now the count's upper bound, and tracking_days reports the
-- span actually measured (global log age capped at the window, the same basis
-- as get_actively_hiring_companies) so the UI says "in Nd tracked" instead of
-- claiming 90 days. median_days_to_close moves to the same genuine-fill
-- population (still stated-date-only per 20260716160000) — otherwise "Filled 3
-- · typically ~3 days" would count real fills but time churn.
CREATE OR REPLACE FUNCTION public.get_company_hiring_health(p_tokens text[])
RETURNS TABLE (company_token text, open_roles integer, closed_90d integer, superseded_90d integer, median_days_open numeric, median_days_to_close numeric, tracking_days integer)
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
  )
  SELECT toks.t AS company_token, COALESCE(live.open_roles, 0) AS open_roles,
         COALESCE(closed.closed_90d, 0) AS closed_90d, COALESCE(closed.superseded_90d, 0) AS superseded_90d,
         round(live.median_days_open, 1) AS median_days_open, round(closed.median_days_to_close, 1) AS median_days_to_close,
         (SELECT days FROM span) AS tracking_days
  FROM toks LEFT JOIN live ON live.company_token = toks.t LEFT JOIN closed ON closed.company_token = toks.t;
$$;
GRANT EXECUTE ON FUNCTION public.get_company_hiring_health(text[]) TO anon, authenticated;
