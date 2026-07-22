-- 20260722212400_trending_newest_exclusions.sql
CREATE OR REPLACE FUNCTION public.get_trending_companies(p_limit int DEFAULT 12)
RETURNS TABLE (company text, company_token text, recent bigint, open_roles bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH latest AS (
    SELECT max(snapshot_date) AS d FROM public.job_board_company_snapshots
  ),
  baseline AS (
    SELECT min(snapshot_date) AS d
    FROM public.job_board_company_snapshots
    WHERE snapshot_date >= (SELECT d FROM latest) - 7
      AND snapshot_date <  (SELECT d FROM latest)
  )
  SELECT n.company,
         n.company_token,
         (n.open_roles - b.open_roles)::bigint AS recent,
         n.open_roles::bigint                  AS open_roles
  FROM public.job_board_company_snapshots n
  JOIN public.job_board_company_snapshots b
    ON b.company_token = n.company_token
   AND b.snapshot_date = (SELECT d FROM baseline)
  WHERE n.snapshot_date = (SELECT d FROM latest)
    AND (n.open_roles - b.open_roles) >= 3
    AND n.company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
  ORDER BY recent DESC, n.open_roles DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.get_trending_companies(int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_newest_companies(p_limit int DEFAULT 12)
RETURNS TABLE (company text, company_token text, open_roles bigint, first_added timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH bounds AS (
    SELECT min(snapshot_date) AS first_day, max(snapshot_date) AS last_day
    FROM public.job_board_company_snapshots
  ),
  appearances AS (
    SELECT company_token, min(snapshot_date) AS appeared
    FROM public.job_board_company_snapshots
    GROUP BY company_token
  )
  SELECT s.company, s.company_token, s.open_roles::bigint, a.appeared::timestamptz AS first_added
  FROM appearances a
  JOIN public.job_board_company_snapshots s
    ON s.company_token = a.company_token
   AND s.snapshot_date = (SELECT last_day FROM bounds)
  WHERE a.appeared > (SELECT first_day FROM bounds)
    AND a.appeared >= (SELECT last_day FROM bounds) - 14
    AND s.open_roles >= 3
    AND s.company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
  ORDER BY a.appeared DESC, s.open_roles DESC
  LIMIT GREATEST(p_limit, 1);
$$;
GRANT EXECUTE ON FUNCTION public.get_newest_companies(int) TO anon, authenticated;

SET LOCAL statement_timeout = '30min';

UPDATE public.job_board_postings SET category = 'healthcare'
WHERE category = 'engineering'
  AND title ~* '\y(behavior|behavioral|behaviour|patient care|pharmacy|veterinary|vet|sterile processing|dialysis|surgical|radiologic|ultrasound|phlebotomy|medical lab\w*|clinical)\y'
  AND title ~* '\ytech(nician)?s?\y';

UPDATE public.job_board_postings SET category = 'other'
WHERE category = 'engineering'
  AND title ~* '\ytechnicians?\y'
  AND title !~* '\y(engineer\w*|developer|software|devops|network|electronics|desktop|help ?desk|service desk|sdet|qa|information technology|datacenter|data center)\y'
  AND title !~* '\yit\y';

DO $$
BEGIN
  SET LOCAL statement_timeout = '55s';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 20260722214500_intel_perf.sql
CREATE OR REPLACE FUNCTION public.get_company_intel(p_token text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH posts AS MATERIALIZED (
    SELECT p.company_token, p.category, p.country, p.salary_currency, p.salary_min_annual
    FROM public.job_board_postings p
    WHERE split_part(p.company_token, '~', 1) = split_part(p_token, '~', 1)
  ),
  prof AS (
    SELECT max(pr.employee_count) AS employees,
           (array_agg(pr.employee_basis ORDER BY pr.employee_count DESC NULLS LAST))[1] AS employee_basis,
           (array_agg(pr.yc_batch ORDER BY pr.employee_count DESC NULLS LAST))[1] AS yc_batch
    FROM public.company_profiles pr
    WHERE pr.company_token IN (SELECT DISTINCT company_token FROM posts)
  ),
  sal AS (
    SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY salary_min_annual))::numeric, 0) AS median_usd_floor,
           count(*)::int AS usd_n
    FROM posts
    WHERE salary_currency = 'USD' AND salary_min_annual IS NOT NULL AND salary_min_annual > 0
  ),
  cats AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('category', category, 'n', n) ORDER BY n DESC), '[]'::jsonb) AS v
    FROM (
      SELECT category, count(*)::int AS n FROM posts
      WHERE category IS NOT NULL AND category <> '' AND category <> 'other'
      GROUP BY category ORDER BY n DESC LIMIT 3
    ) c
  ),
  countries AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('country', country, 'n', n) ORDER BY n DESC), '[]'::jsonb) AS v
    FROM (
      SELECT country, count(*)::int AS n FROM posts
      WHERE country IS NOT NULL AND country <> ''
      GROUP BY country ORDER BY n DESC LIMIT 3
    ) c
  ),
  snaps AS MATERIALIZED (
    SELECT s.snapshot_date, sum(s.open_roles)::int AS open_roles
    FROM public.job_board_company_snapshots s
    WHERE split_part(s.company_token, '~', 1) = split_part(p_token, '~', 1)
      AND s.snapshot_date >= current_date - 7
    GROUP BY s.snapshot_date
  ),
  trend AS (
    SELECT CASE WHEN (SELECT count(*) FROM snaps) >= 2 THEN
             (SELECT open_roles FROM snaps ORDER BY snapshot_date DESC LIMIT 1)
             - (SELECT open_roles FROM snaps ORDER BY snapshot_date ASC LIMIT 1)
           END::int AS net_7d
  )
  SELECT jsonb_build_object(
    'employees', prof.employees,
    'employee_basis', prof.employee_basis,
    'yc_batch', prof.yc_batch,
    'median_usd_floor', sal.median_usd_floor,
    'usd_n', sal.usd_n,
    'categories', cats.v,
    'countries', countries.v,
    'net_7d', trend.net_7d
  )
  FROM prof, sal, cats, countries, trend;
$$;
GRANT EXECUTE ON FUNCTION public.get_company_intel(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_similar_companies(p_token text, p_limit int DEFAULT 6)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH dom AS MATERIALIZED (
    SELECT p.category
    FROM public.job_board_postings p
    WHERE split_part(p.company_token, '~', 1) = split_part(p_token, '~', 1)
      AND p.category IS NOT NULL AND p.category <> '' AND p.category <> 'other'
    GROUP BY p.category ORDER BY count(*) DESC LIMIT 1
  ),
  sim AS (
    SELECT max(p.company) AS company,
           p.company_token,
           count(*)::int AS open_roles,
           max(pr.employee_count) AS employees,
           (array_agg(pr.employee_basis))[1] AS employee_basis
    FROM public.job_board_postings p
    LEFT JOIN public.company_profiles pr ON pr.company_token = p.company_token
    WHERE p.category = (SELECT category FROM dom)
      AND split_part(p.company_token, '~', 1) <> split_part(p_token, '~', 1)
      AND p.company <> ''
      AND p.company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
    GROUP BY p.company_token
    HAVING count(*) >= 3
    ORDER BY count(*) DESC
    LIMIT GREATEST(p_limit, 1)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'company', company, 'company_token', company_token,
           'open_roles', open_roles, 'employees', employees,
           'employee_basis', employee_basis,
           'category', (SELECT category FROM dom))), '[]'::jsonb)
  FROM sim;
$$;
GRANT EXECUTE ON FUNCTION public.get_similar_companies(text, int) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';