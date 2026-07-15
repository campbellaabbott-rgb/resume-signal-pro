-- Fix: get_ghost_job_index_stats fails ~half the time with statement timeout
-- (57014) on a cold cache — the median-age percentile sorts ALL ~166k postings.
-- (An earlier cast fix made the function correct; this makes it fast.) Verified
-- live: 2 consecutive 500s cold, then 200s warm.
--   1) median_days_open estimates from a ~5% TABLESAMPLE — an honest statistical
--      estimate labelled "median age", not a claim of exactness. Counts stay exact.
--   2) median_days_to_close stays exact (small closures table).
--   3) function-local statement_timeout as belt-and-suspenders.
CREATE OR REPLACE FUNCTION public.get_ghost_job_index_stats()
RETURNS TABLE (
  total_open bigint,
  total_companies bigint,
  closed_90d bigint,
  median_days_open numeric,
  median_days_to_close numeric
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
       ORDER BY GREATEST(EXTRACT(EPOCH FROM (now() - first_seen)) / 86400.0, 0)))::numeric, 1)
     FROM public.job_board_postings TABLESAMPLE SYSTEM (5)),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (
       ORDER BY EXTRACT(EPOCH FROM (closed_at - COALESCE(posted_at, first_seen))) / 86400.0))::numeric, 1)
     FROM public.job_board_closures
     WHERE closed_at > now() - interval '90 days'
       AND NOT superseded
       AND COALESCE(posted_at, first_seen) IS NOT NULL
       AND closed_at >= COALESCE(posted_at, first_seen));
$$;
GRANT EXECUTE ON FUNCTION public.get_ghost_job_index_stats() TO anon, authenticated;
