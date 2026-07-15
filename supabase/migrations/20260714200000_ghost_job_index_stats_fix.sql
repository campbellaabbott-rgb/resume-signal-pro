-- Fix: get_ghost_job_index_stats timed out under the anon statement_timeout —
-- percentile_cont over all ~166k live postings sorts the whole table. Two fixes:
--   1) median_days_open now uses a TABLESAMPLE (~5% of pages) — a fast, honest
--      statistical estimate instead of a full-table sort. (median_days_to_close
--      stays exact: it's over the small closures table.)
--   2) raise the function's own statement_timeout as belt-and-suspenders.
-- Counts stay exact.
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
    (SELECT count(*) FROM public.job_board_closures WHERE closed_at > now() - interval '90 days'),
    (SELECT round(percentile_cont(0.5) WITHIN GROUP (
       ORDER BY GREATEST(EXTRACT(EPOCH FROM (now() - first_seen)) / 86400.0, 0)), 1)
     FROM public.job_board_postings TABLESAMPLE SYSTEM (5)),
    (SELECT round(percentile_cont(0.5) WITHIN GROUP (
       ORDER BY EXTRACT(EPOCH FROM (closed_at - COALESCE(posted_at, first_seen))) / 86400.0), 1)
     FROM public.job_board_closures
     WHERE closed_at > now() - interval '90 days'
       AND COALESCE(posted_at, first_seen) IS NOT NULL
       AND closed_at >= COALESCE(posted_at, first_seen));
$$;
GRANT EXECUTE ON FUNCTION public.get_ghost_job_index_stats() TO anon, authenticated;
