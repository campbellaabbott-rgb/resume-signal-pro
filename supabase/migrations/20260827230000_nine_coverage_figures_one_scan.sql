-- FOUR COVERAGE COUNTS WERE FOUR SEPARATE SCANS, AND THREE OF THEM DIED.
--
-- The refresh pass measures what each filter costs the searcher — the share of
-- the board that states a salary, a work mode, an experience band, a country —
-- as four PostgREST exact head-counts over ~600k rows. Measured live
-- 2026-08-27: three of the four were failing (timeout class) and the board was
-- publishing ONE figure ({"experience": 0.394}); a searcher with a pay floor
-- saw ~20% of the board and was told nothing. The carry-forward machinery
-- masked the deaths instead of removing their cause: four full scans issued
-- separately, each against its own statement budget.
--
-- And FIVE MORE figures never had live counts at all: payBasis, hasStatedPay,
-- maxYears, department, vendor ride pinned constants measured 2026-08-25 —
-- honest, dated, and already drifting.
--
-- ONE SCAN, NINE COUNTS. count(*) FILTER computes every figure in a single
-- pass over the serving population (both fences, same denominator), inside one
-- statement budget sized like the transparency aggregates (measured 14.9s for
-- a heavier scan). The pass calls this instead of issuing four counts; the
-- old path remains in the function as the deploy-window fallback.
--
-- Service-role only: it is the refresh pass's instrument, and a public exact
-- scan over the whole table is a free load-test endpoint for anyone else.
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
