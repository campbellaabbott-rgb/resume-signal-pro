-- The Ghost Job Index: honest, aggregate transparency stats computed from the
-- board's full posting lifecycle — the numbers no aggregator can produce because
-- they'd need the whole movie (open now + when roles actually close), not a
-- snapshot. Both functions read only public tables and return aggregates.

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
    (SELECT count(*) FROM public.job_board_closures WHERE closed_at > now() - interval '90 days'),
    (SELECT round(percentile_cont(0.5) WITHIN GROUP (
       ORDER BY GREATEST(EXTRACT(EPOCH FROM (now() - first_seen)) / 86400.0, 0)), 1)
     FROM public.job_board_postings),
    (SELECT round(percentile_cont(0.5) WITHIN GROUP (
       ORDER BY EXTRACT(EPOCH FROM (closed_at - COALESCE(posted_at, first_seen))) / 86400.0), 1)
     FROM public.job_board_closures
     WHERE closed_at > now() - interval '90 days'
       AND COALESCE(posted_at, first_seen) IS NOT NULL
       AND closed_at >= COALESCE(posted_at, first_seen));
$$;
GRANT EXECUTE ON FUNCTION public.get_ghost_job_index_stats() TO anon, authenticated;

-- Actively-hiring leaderboard: companies that have actually filled/closed the most
-- roles in the last 90 days (proof of hiring, not just open listings).
CREATE OR REPLACE FUNCTION public.get_actively_hiring_companies(p_limit int DEFAULT 20)
RETURNS TABLE (company text, company_token text, closed_90d bigint, open_roles bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT
    c.company,
    c.company_token,
    count(*) AS closed_90d,
    COALESCE((SELECT count(*) FROM public.job_board_postings p WHERE p.company_token = c.company_token), 0) AS open_roles
  FROM public.job_board_closures c
  WHERE c.closed_at > now() - interval '90 days' AND c.company <> ''
  GROUP BY c.company, c.company_token
  ORDER BY count(*) DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;
GRANT EXECUTE ON FUNCTION public.get_actively_hiring_companies(int) TO anon, authenticated;
