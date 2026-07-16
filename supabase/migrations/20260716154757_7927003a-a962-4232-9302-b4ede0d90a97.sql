DROP FUNCTION IF EXISTS public.get_ghost_job_index_stats();
CREATE FUNCTION public.get_ghost_job_index_stats()
RETURNS TABLE (
  total_open bigint,
  total_companies bigint,
  closed_90d bigint,
  median_days_open numeric,
  median_days_to_close numeric,
  posted_coverage_pct numeric
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
     FROM public.job_board_postings);
$$;
GRANT EXECUTE ON FUNCTION public.get_ghost_job_index_stats() TO anon, authenticated;

DROP FUNCTION IF EXISTS public.get_company_hiring_health(text[]);
CREATE FUNCTION public.get_company_hiring_health(p_tokens text[])
RETURNS TABLE (company_token text, open_roles integer, closed_90d integer, superseded_90d integer, median_days_open numeric, median_days_to_close numeric, tracking_days integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH toks AS (SELECT DISTINCT unnest(p_tokens) AS t),
  live AS (
    SELECT company_token, count(*)::int AS open_roles,
           (percentile_cont(0.5) WITHIN GROUP (ORDER BY GREATEST(EXTRACT(EPOCH FROM (now() - posted_at)) / 86400.0, 0))
             FILTER (WHERE posted_at IS NOT NULL))::numeric AS median_days_open
    FROM public.job_board_postings WHERE company_token = ANY (p_tokens) GROUP BY company_token
  ),
  closed AS (
    SELECT company_token,
           count(*) FILTER (WHERE closed_at > now() - interval '90 days' AND NOT superseded)::int AS closed_90d,
           count(*) FILTER (WHERE closed_at > now() - interval '90 days' AND superseded)::int AS superseded_90d,
           (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (closed_at - posted_at)) / 86400.0)
             FILTER (WHERE closed_at > now() - interval '90 days' AND NOT superseded AND posted_at IS NOT NULL AND closed_at >= posted_at))::numeric AS median_days_to_close,
           EXTRACT(DAY FROM (now() - min(closed_at)))::int AS tracking_days
    FROM public.job_board_closures WHERE company_token = ANY (p_tokens) GROUP BY company_token
  )
  SELECT toks.t AS company_token, COALESCE(live.open_roles, 0) AS open_roles, COALESCE(closed.closed_90d, 0) AS closed_90d, COALESCE(closed.superseded_90d, 0) AS superseded_90d,
         round(live.median_days_open, 1) AS median_days_open, round(closed.median_days_to_close, 1) AS median_days_to_close, COALESCE(closed.tracking_days, 0) AS tracking_days
  FROM toks LEFT JOIN live ON live.company_token = toks.t LEFT JOIN closed ON closed.company_token = toks.t;
$$;
GRANT EXECUTE ON FUNCTION public.get_company_hiring_health(text[]) TO anon, authenticated;