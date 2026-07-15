-- Salary-floor filter + benchmarks: postings' freeform salary text (vendor
-- fields + description mining) gets a comparable annualized lower bound,
-- parsed by the edge at ingest (hourly x2080, weekly x52, monthly x12; no
-- period stated = only unambiguously-annual magnitudes; no currency
-- conversion — the number is as the posting states it).
ALTER TABLE public.job_board_postings
  ADD COLUMN IF NOT EXISTS salary_min_annual numeric;

-- Partial index: the floor filter only ever scans salaried rows (~7%).
CREATE INDEX IF NOT EXISTS job_board_postings_salary_floor_idx
  ON public.job_board_postings (salary_min_annual)
  WHERE salary_min_annual IS NOT NULL;

-- Category benchmarks: median advertised pay floor per category, only where
-- the sample is meaningful (>=30 salaried postings) — never a thin claim.
CREATE OR REPLACE FUNCTION public.get_salary_benchmarks()
RETURNS TABLE (category text, n integer, median_annual_min numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
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
