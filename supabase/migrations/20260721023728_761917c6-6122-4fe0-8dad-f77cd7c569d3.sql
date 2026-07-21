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

-- Prime the stats cache so get_stats_cache() returns data now instead of waiting for the :12 cron run.
SELECT public.refresh_stats_cache();