-- 20260715180000_salary_benchmarks_perf
CREATE INDEX IF NOT EXISTS job_board_postings_salary_category_idx
  ON public.job_board_postings (category, salary_min_annual)
  WHERE salary_min_annual IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_salary_benchmarks()
RETURNS TABLE (category text, n integer, median_annual_min numeric)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  SELECT category,
         count(*)::int AS n,
         round((percentile_cont(0.5) WITHIN GROUP (ORDER BY salary_min_annual))::numeric, 0) AS median_annual_min
  FROM public.job_board_postings
  WHERE salary_min_annual IS NOT NULL
  GROUP BY category
  HAVING count(*) >= 30
  ORDER BY n DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_salary_benchmarks() TO anon, authenticated;

-- 20260715190000_freshness_stats
CREATE OR REPLACE FUNCTION public.get_freshness_stats()
RETURNS TABLE (boards integer, p50_min numeric, p95_min numeric, max_min numeric)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  SELECT
    count(*)::int AS boards,
    round((percentile_cont(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (now() - verified_at)) / 60.0))::numeric, 1) AS p50_min,
    round((percentile_cont(0.95) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (now() - verified_at)) / 60.0))::numeric, 1) AS p95_min,
    round((max(EXTRACT(EPOCH FROM (now() - verified_at)) / 60.0))::numeric, 1) AS max_min
  FROM public.job_board_verifications;
$$;
GRANT EXECUTE ON FUNCTION public.get_freshness_stats() TO anon, authenticated;

-- 20260715200000_salary_currency
ALTER TABLE public.job_board_postings
  ADD COLUMN IF NOT EXISTS salary_currency text;

CREATE INDEX IF NOT EXISTS job_board_postings_salary_ccy_idx
  ON public.job_board_postings (category, salary_currency, salary_min_annual)
  WHERE salary_min_annual IS NOT NULL;

DROP FUNCTION IF EXISTS public.get_salary_benchmarks();
CREATE FUNCTION public.get_salary_benchmarks()
RETURNS TABLE (category text, currency text, n integer, median_annual_min numeric)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  WITH per AS (
    SELECT category,
           salary_currency AS currency,
           count(*)::int AS n,
           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY salary_min_annual))::numeric, 0) AS median_annual_min
    FROM public.job_board_postings
    WHERE salary_min_annual IS NOT NULL AND salary_currency IS NOT NULL
    GROUP BY category, salary_currency
    HAVING count(*) >= 30
  )
  SELECT DISTINCT ON (category) category, currency, n, median_annual_min
  FROM per
  ORDER BY category, n DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_salary_benchmarks() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';