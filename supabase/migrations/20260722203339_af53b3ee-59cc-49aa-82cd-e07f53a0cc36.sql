CREATE OR REPLACE FUNCTION public.get_company_intel(p_token text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH slug AS (
    SELECT split_part(p_token, '~', 1) AS s
  ),
  toks AS (
    SELECT DISTINCT p.company_token
    FROM public.job_board_postings p, slug
    WHERE split_part(p.company_token, '~', 1) = slug.s
  ),
  prof AS (
    SELECT max(pr.employee_count) AS employees,
           (array_agg(pr.employee_basis ORDER BY pr.employee_count DESC NULLS LAST))[1] AS employee_basis,
           (array_agg(pr.yc_batch ORDER BY pr.employee_count DESC NULLS LAST))[1] AS yc_batch
    FROM public.company_profiles pr
    WHERE pr.company_token IN (SELECT company_token FROM toks)
  ),
  sal AS (
    SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY p.salary_min_annual))::numeric, 0) AS median_usd_floor,
           count(*)::int AS usd_n
    FROM public.job_board_postings p
    WHERE p.company_token IN (SELECT company_token FROM toks)
      AND p.salary_currency = 'USD' AND p.salary_min_annual IS NOT NULL AND p.salary_min_annual > 0
  ),
  cats AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('category', category, 'n', n) ORDER BY n DESC), '[]'::jsonb) AS v
    FROM (
      SELECT p.category, count(*)::int AS n
      FROM public.job_board_postings p
      WHERE p.company_token IN (SELECT company_token FROM toks)
        AND p.category IS NOT NULL AND p.category <> '' AND p.category <> 'other'
      GROUP BY p.category ORDER BY n DESC LIMIT 3
    ) c
  ),
  countries AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('country', country, 'n', n) ORDER BY n DESC), '[]'::jsonb) AS v
    FROM (
      SELECT p.country, count(*)::int AS n
      FROM public.job_board_postings p
      WHERE p.company_token IN (SELECT company_token FROM toks)
        AND p.country IS NOT NULL AND p.country <> ''
      GROUP BY p.country ORDER BY n DESC LIMIT 3
    ) c
  ),
  trend AS (
    SELECT CASE WHEN count(DISTINCT s.snapshot_date) >= 2 THEN
             (SELECT sum(s2.open_roles) FROM public.job_board_company_snapshots s2
               WHERE s2.company_token IN (SELECT company_token FROM toks)
                 AND s2.snapshot_date = (SELECT max(s3.snapshot_date) FROM public.job_board_company_snapshots s3
                                          WHERE s3.company_token IN (SELECT company_token FROM toks)))
             -
             (SELECT sum(s2.open_roles) FROM public.job_board_company_snapshots s2
               WHERE s2.company_token IN (SELECT company_token FROM toks)
                 AND s2.snapshot_date = (SELECT min(s3.snapshot_date) FROM public.job_board_company_snapshots s3
                                          WHERE s3.company_token IN (SELECT company_token FROM toks)
                                            AND s3.snapshot_date >= current_date - 7))
           END::int AS net_7d
    FROM public.job_board_company_snapshots s
    WHERE s.company_token IN (SELECT company_token FROM toks)
      AND s.snapshot_date >= current_date - 7
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
  WITH slug AS (SELECT split_part(p_token, '~', 1) AS s),
  dom AS (
    SELECT p.category FROM public.job_board_postings p, slug
    WHERE split_part(p.company_token, '~', 1) = slug.s
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
    CROSS JOIN slug
    WHERE p.category = (SELECT category FROM dom)
      AND split_part(p.company_token, '~', 1) <> slug.s
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

CREATE OR REPLACE FUNCTION public.get_size_segment_companies(p_band text, p_limit int DEFAULT 60, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '25s'
AS $$
  WITH co AS (
    SELECT p.company_token,
           max(p.company) AS company,
           count(*)::int AS on_board,
           COALESCE(v.feed_total, 0) AS feed_total,
           pr.employee_count, pr.employee_basis, pr.yc_batch
    FROM public.job_board_postings p
    LEFT JOIN public.job_board_verifications v ON v.company_token = p.company_token
    LEFT JOIN public.company_profiles pr ON pr.company_token = p.company_token
    WHERE p.company <> ''
      AND p.company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
    GROUP BY p.company_token, v.feed_total, pr.employee_count, pr.employee_basis, pr.yc_batch
    HAVING count(*) >= 3
  ),
  normed AS (
    SELECT *, lower(regexp_replace(company,
             '\s+(gmbh|ag|inc\.?|llc|ltd\.?|limited|s\.a\.|p\.a\.|corp\.?|corporation|plc)\s*$',
             '', 'i')) AS norm
    FROM co
  ),
  named AS (
    SELECT norm,
           (array_agg(company ORDER BY length(company) ASC, company ASC))[1] AS company,
           (array_agg(company_token ORDER BY GREATEST(on_board, feed_total) DESC))[1] AS company_token,
           sum(on_board)::int AS on_board,
           NULLIF(sum(feed_total), 0)::int AS company_total,
           GREATEST(sum(on_board), sum(feed_total))::int AS effective,
           max(employee_count) AS employees,
           (array_agg(employee_basis ORDER BY employee_count DESC NULLS LAST))[1] AS employee_basis,
           (array_agg(yc_batch ORDER BY employee_count DESC NULLS LAST))[1] AS yc_batch
    FROM normed GROUP BY norm
  ),
  banded AS (
    SELECT * FROM named
    WHERE employees IS NOT NULL AND employees > 0
      AND effective <= employees * 1.2
      AND CASE WHEN employees >= 1000 THEN 'enterprise'
               WHEN employees >= 100 THEN 'mid'
               ELSE 'small' END = p_band
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM banded),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'company', company, 'company_token', company_token,
        'on_board', on_board, 'company_total', company_total,
        'employees', employees, 'employee_basis', employee_basis,
        'yc_batch', yc_batch))
      FROM (
        SELECT * FROM banded
        ORDER BY employees DESC, effective DESC
        LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)
      ) page), '[]'::jsonb)
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_size_segment_companies(text, int, int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_company_claim_status(p_token text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object('verified', true, 'verified_at', c.verified_at, 'website', c.website)
       FROM public.company_claims c
      WHERE c.company_token = p_token AND c.status = 'verified'
      ORDER BY c.verified_at DESC NULLS LAST
      LIMIT 1),
    jsonb_build_object('verified', false)
  );
$$;

NOTIFY pgrst, 'reload schema';