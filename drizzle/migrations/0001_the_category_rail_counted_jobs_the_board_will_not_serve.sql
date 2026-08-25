CREATE OR REPLACE FUNCTION public.refresh_job_board_facets()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10min'
AS $$
DECLARE
  v jsonb;
BEGIN
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
        SELECT category, count(*) AS n
        FROM job_board_postings
        WHERE missing_since IS NULL
          AND effective_posted >= now() - interval '30 days'
        GROUP BY category
      ) k(category, n)
    ), '{}'::jsonb),
    'sourcesFacet', COALESCE((
      SELECT jsonb_object_agg(source, n)
      FROM (
        SELECT source, count(*) AS n
        FROM job_board_postings
        WHERE missing_since IS NULL
          AND effective_posted >= now() - interval '30 days'
          AND source IS NOT NULL AND source <> ''
        GROUP BY source
      ) s(source, n)
    ), '{}'::jsonb),
    'openTotal', (
      SELECT count(*) FROM job_board_postings
      WHERE missing_since IS NULL AND effective_posted >= now() - interval '30 days'
    ),
    'as_of', now()
  ) INTO v;

  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('facets', v, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now();

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_job_board_facets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_job_board_facets() TO service_role;

COMMENT ON FUNCTION public.refresh_job_board_facets() IS
  'Rebuilds the cached facet row. categoriesFacet, sourcesFacet and openTotal all carry the FULL serving rule (missing_since IS NULL AND effective_posted within 30 days) so their counts match what /jobs actually serves and the parts sum to the whole. companiesFacet is intentionally UNFILTERED because the refresh pass uses it to drive an orphan prune that deletes postings; filtering it would let a freshness window delete live rows.';

CREATE OR REPLACE FUNCTION public.get_job_board_facets()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  cached jsonb;
BEGIN
  SELECT v INTO cached FROM public.job_board_meta WHERE k = 'facets';

  IF cached IS NOT NULL AND cached ? 'total' THEN
    RETURN cached || jsonb_build_object(
      'cached', true,
      'stale', (SELECT updated_at < now() - interval '6 hours'
                FROM public.job_board_meta WHERE k = 'facets')
    );
  END IF;

  RETURN jsonb_build_object(
    'total', NULL, 'companiesFacet', '[]'::jsonb, 'categoriesFacet', '{}'::jsonb,
    'sourcesFacet', '{}'::jsonb, 'openTotal', NULL,
    'cached', false, 'stale', true, 'as_of', NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_job_board_facets() TO anon, authenticated, service_role;

SELECT public.refresh_job_board_facets();
