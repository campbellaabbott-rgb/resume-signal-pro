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