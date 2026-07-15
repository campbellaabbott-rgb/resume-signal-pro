-- get_salary_benchmarks timed out on a cold cache in production (57014 on the
-- first call after deploy, fine warm) — same failure mode the ghost-index
-- stats had. Same treatment: a covering partial index so the aggregate never
-- touches the heap for unsalaried rows, and a function-local statement_timeout
-- with headroom over the anon default.
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
