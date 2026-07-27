-- Follow-up to 20260727180000 (already applied — never edit an applied file).
--
-- Two things, both measured against production after that migration landed:
--
-- 1. get_ghost_job_index_stats() is unreachable for anon. Verified 3x:
--        57014 canceling statement due to statement timeout, at ~3.4s
--    This is NOT new — src/pages/GhostJobIndex.tsx already carries a retry
--    with the comment "The stats RPC can time out on a cold cache", and commit
--    9cdacda logged a ghost-stats timeout before today. The function does two
--    percentile_cont passes plus several full counts over 581k postings and
--    121k closures, against the anon role's ~3s statement_timeout.
--    The page reads the cached copy first so this rarely shows, but the
--    fallback has simply never worked. Same fix already used by
--    get_employer_benchmarks (20260727120000): raise the ceiling inside the
--    function so the fallback can actually complete.
--
-- 2. The distinct-employer count is made cheaper AND more faithful.
--    20260727180000 used count(DISTINCT lower(btrim(company))), which calls
--    two functions per row across 581k rows. The merge rule this number is
--    meant to mirror — the `named` CTE in get_size_segments — groups by the
--    RAW company string. Matching it exactly is both correct and cheaper, and
--    it means the headline count and the segments page can never disagree
--    about what "one employer" is.
--
-- The cached path needs no change: refresh_stats_cache() builds ghost_stats
-- with row_to_json over this function, so total_company_names and
-- observed_days flow into the cache automatically on the next hourly run
-- (cron 'refresh-stats-cache', 12 past the hour), executing as service_role
-- where the timeout does not bite.
CREATE OR REPLACE FUNCTION public.get_ghost_job_index_stats()
RETURNS TABLE (
  total_open bigint,
  total_companies bigint,        -- feed tokens; kept so existing readers don't break
  total_company_names bigint,    -- distinct employers, boards merged by name
  closed_90d bigint,
  observed_days integer,         -- how deep the closure log ACTUALLY is
  median_days_open numeric,
  median_days_to_close numeric
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '25s'
AS $$
  SELECT
    (SELECT count(*) FROM public.job_board_postings),
    (SELECT count(DISTINCT company_token) FROM public.job_board_postings),
    -- Same grouping key as get_size_segments' `named` CTE, so the two
    -- surfaces cannot disagree about what counts as one employer.
    (SELECT count(DISTINCT company)
       FROM public.job_board_postings WHERE company <> ''),
    (SELECT count(*) FROM public.job_board_closures WHERE closed_at > now() - interval '90 days'),
    (SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (now() - MIN(closed_at))) / 86400.0))::integer
       FROM public.job_board_closures),
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
