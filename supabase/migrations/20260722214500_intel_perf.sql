-- Perf rewrite for the lander intel RPCs, measured on production:
-- get_company_intel ran 11-14s (the slug predicate full-scanned 572k postings
-- once per subquery - 8 scans), get_similar_companies 8s. Both now scan the
-- postings table ONCE into a MATERIALIZED CTE and read everything from that.
-- Same outputs, same shapes.

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
