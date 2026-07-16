-- Salary currency correctness: the benchmark medians were mixing currencies —
-- a €50.000 and a $50,000 posting both counted as "50000". The parser now
-- captures the currency the posting itself states (explicit ISO code wins,
-- else €→EUR £→GBP bare-$→USD, CA$/A$ caught first) and benchmarks are
-- computed per category over its DOMINANT currency only, labeled as such.
ALTER TABLE public.job_board_postings
  ADD COLUMN IF NOT EXISTS salary_currency text;

-- Covering index for the per-currency aggregate (replaces the category+floor
-- one for the benchmarks path; the plain floor-filter index remains).
CREATE INDEX IF NOT EXISTS job_board_postings_salary_ccy_idx
  ON public.job_board_postings (category, salary_currency, salary_min_annual)
  WHERE salary_min_annual IS NOT NULL;

-- Return signature changes (adds currency) — drop + recreate.
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
