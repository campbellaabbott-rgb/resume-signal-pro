CREATE OR REPLACE FUNCTION public.get_filter_coverage()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '45s'
AS $$
  SELECT jsonb_build_object(
    'open',         count(*),
    'salaryFloor',  count(*) FILTER (WHERE salary_rank_usd IS NOT NULL),
    'workMode',     count(*) FILTER (WHERE work_mode IS NOT NULL),
    'experience',   count(*) FILTER (WHERE experience_band IS NOT NULL AND experience_band <> 'unspecified'),
    'country',      count(*) FILTER (WHERE country IS NOT NULL),
    'payBasis',     count(*) FILTER (WHERE salary_period IS NOT NULL),
    'hasStatedPay', count(*) FILTER (WHERE salary_min_annual IS NOT NULL),
    'maxYears',     count(*) FILTER (WHERE min_years IS NOT NULL),
    'department',   count(*) FILTER (WHERE department IS NOT NULL)
  )
  FROM public.job_board_postings
  WHERE missing_since IS NULL
    AND effective_posted >= now() - interval '30 days';
$$;

REVOKE ALL ON FUNCTION public.get_filter_coverage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_filter_coverage() TO service_role;

COMMENT ON FUNCTION public.get_filter_coverage() IS
  'All nine filter-coverage counts in ONE scan of the serving population (missing_since IS NULL, 30-day window). Called by the refresh pass once per pass; replaces four separate PostgREST exact counts of which three were dying of timeouts, and gives live figures to the five filters that rode pinned constants.';