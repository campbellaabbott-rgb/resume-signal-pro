-- Facets computed by SQL instead of refresh-pass accumulation: at ~90k
-- postings and tiered refresh cursors, DB aggregation is simpler, always
-- consistent with what the board actually serves, and immune to the
-- partial-pass bookkeeping bugs the accumulator needed guards for.

CREATE OR REPLACE FUNCTION public.get_job_board_facets()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM job_board_postings),
    'companiesFacet', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('token', company_token, 'name', company, 'count', n) ORDER BY name)
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

-- The edge function calls this with the service role; no anon grant needed,
-- but harmless if PostgREST exposes it read-only.
GRANT EXECUTE ON FUNCTION public.get_job_board_facets() TO anon, authenticated, service_role;
