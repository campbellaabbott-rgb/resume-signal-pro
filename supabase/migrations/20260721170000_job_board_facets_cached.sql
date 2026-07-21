-- Kill the last full-table-scan-on-anon-path time bomb.
--
-- get_job_board_facets() does three full-table aggregates (total count +
-- companies facet + categories facet) over ~557k job_board_postings rows.
-- It measured 17.3s live and grows with the catalog, so it will eventually
-- blow past the 20s statement-timeout guard added in
-- 20260721160000_stats_timeout_guards.sql and 500 again — which breaks the
-- SEO prerender that fetches it at build time with the anon key.
--
-- But the refresh pass (job-board edge function, service role) ALREADY runs
-- exactly this aggregate at the end of every completed pass and stores the
-- result in job_board_meta under k='refresh' — v carries {total, boards,
-- failedSources, companiesFacet, categoriesFacet, refreshedAt}. So a fresh,
-- maintained copy of what get_job_board_facets returns lives in a single
-- indexed row, refreshed every pass.
--
-- This RPC reads that maintained row instead of recomputing. It's a single
-- primary-key lookup (microseconds, cannot time out), safe on the anon path.
-- Prerender points here first and falls back to the live full-scan RPC only
-- if the meta row is missing (e.g. a fresh DB before its first refresh pass).
--
-- Shape matches get_job_board_facets exactly: {total, companiesFacet,
-- categoriesFacet}. Missing row -> the WHERE matches nothing, the function
-- returns NULL, and the anon caller's shape check fails cleanly into fallback.

CREATE OR REPLACE FUNCTION public.get_job_board_facets_cached()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total', v->'total',
    'companiesFacet', COALESCE(v->'companiesFacet', '[]'::jsonb),
    'categoriesFacet', COALESCE(v->'categoriesFacet', '{}'::jsonb)
  )
  FROM job_board_meta
  WHERE k = 'refresh';
$$;

GRANT EXECUTE ON FUNCTION public.get_job_board_facets_cached() TO anon, authenticated, service_role;
