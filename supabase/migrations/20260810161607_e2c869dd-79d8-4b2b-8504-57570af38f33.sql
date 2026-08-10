CREATE OR REPLACE FUNCTION public.get_board_vendor_counts()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
       'sourcesFacet', COALESCE(v -> 'sourcesFacet', '{}'::jsonb),
       'openTotal',    v -> 'openTotal',
       'as_of',        v -> 'as_of',
       'cached',       true
     )
     FROM public.job_board_meta WHERE k = 'facets'),
    jsonb_build_object(
      'sourcesFacet', '{}'::jsonb, 'openTotal', NULL,
      'as_of', NULL, 'cached', false)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_board_vendor_counts() TO anon, authenticated;

COMMENT ON FUNCTION public.get_board_vendor_counts() IS
  'Vendor-wall subset of the cached board facets: sourcesFacet + openTotal + as_of only.';