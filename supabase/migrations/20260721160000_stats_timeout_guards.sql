-- Bug sweep (part 2): two more public aggregate functions were returning 500
-- to anon callers — statement timeout (57014), same root cause as
-- get_date_coverage. Neither had the timeout guard the sibling stats
-- functions carry, so their full-table scans over 557k rows hit the anon
-- role's short cap and cancelled.
--   - get_job_board_facets: hit at BUILD TIME by scripts/prerender-seo.mjs
--     (anon key) — it 500s on every retry, so SEO pages were being baked
--     without the live facet data. Real user-facing (SEO) impact.
--   - get_stale_board_count: only called in production by scan-heartbeat
--     under the service role (which has no cap, so it works there) — but it
--     500s for any anon caller, which is untidy and breaks smoke checks.
-- Both fixed with the same SET statement_timeout guard so they RETURN
-- instead of erroring. Bodies unchanged.

CREATE OR REPLACE FUNCTION public.get_job_board_facets()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM job_board_postings),
    'companiesFacet', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('token', company_token, 'name', company, 'count', n) ORDER BY company)
      FROM (
        SELECT company_token, max(company) AS company, count(*) AS n
        FROM job_board_postings
        GROUP BY company_token
      ) c(company_token, company, n)
    ), '[]'::jsonb),
    'categoriesFacet', COALESCE((
      SELECT jsonb_object_agg(category, n)
      FROM (
        SELECT category, count(*) AS n FROM job_board_postings GROUP BY category
      ) k(category, n)
    ), '{}'::jsonb)
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_job_board_facets() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_stale_board_count()
RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
SET statement_timeout = '20s'
AS $$
  SELECT count(*)::int FROM (
    SELECT DISTINCT p.company_token
    FROM public.job_board_postings p
    LEFT JOIN public.job_board_verifications v ON v.company_token = p.company_token
    WHERE v.verified_at IS NULL OR v.verified_at < now() - interval '24 hours'
  ) stale;
$$;
GRANT EXECUTE ON FUNCTION public.get_stale_board_count() TO anon, authenticated;
