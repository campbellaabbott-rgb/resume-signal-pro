-- 20260722193500_headcount_integrity.sql
UPDATE public.company_profiles
SET employee_count = 194000
WHERE company_token = 'santander~wd3~SantanderCareers';

DELETE FROM public.company_profiles
WHERE company_token IN ('bhvr', 'cohesity~wd5~cohesity_careers');

INSERT INTO public.company_profiles (company_token, employee_count, employee_basis, yc_batch)
VALUES
  ('pwc~wd3~NonPublic_Postings', 295371, 'public_records', NULL),
  ('ghr~wd1~us-emplsv', 213000, 'public_records', NULL),
  ('globalhr~wd5~REC_RTX_Ext_Gateway', 182000, 'public_records', NULL),
  ('hpe~wd5~acjobsite', 60000, 'public_records', NULL),
  ('nuffieldhealth~wd3~NH_Careers', 19361, 'public_records', NULL),
  ('thomsonreuters~wd5~External_Career_Site', 24000, 'public_records', NULL)
ON CONFLICT (company_token) DO UPDATE
  SET employee_count = EXCLUDED.employee_count,
      employee_basis = EXCLUDED.employee_basis;

CREATE OR REPLACE FUNCTION public.get_size_segments()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '25s'
AS $$
  WITH co AS (
    SELECT p.company_token,
           max(p.company) AS company,
           count(*)::int AS on_board,
           count(*) FILTER (WHERE p.remote)::int AS remote_n,
           count(*) FILTER (WHERE p.experience_band = 'entry')::int AS entry_n,
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
  named AS (
    SELECT company,
           (array_agg(company_token ORDER BY GREATEST(on_board, feed_total) DESC))[1] AS company_token,
           sum(on_board)::int AS on_board,
           sum(remote_n)::int AS remote_n,
           sum(entry_n)::int AS entry_n,
           NULLIF(sum(feed_total), 0)::int AS company_total,
           GREATEST(sum(on_board), sum(feed_total))::int AS effective,
           max(employee_count) AS employees,
           (array_agg(employee_basis ORDER BY employee_count DESC NULLS LAST))[1] AS employee_basis,
           (array_agg(yc_batch ORDER BY employee_count DESC NULLS LAST))[1] AS yc_batch
    FROM co GROUP BY company
  ),
  verified AS (
    SELECT * FROM named
    WHERE employees IS NOT NULL AND employees > 0
      AND effective <= employees * 1.2
  ),
  banded AS (
    SELECT *,
           CASE WHEN employees >= 1000 THEN 'enterprise'
                WHEN employees >= 100 THEN 'mid'
                ELSE 'small' END AS band
    FROM verified
  ),
  sal AS (
    SELECT b.band,
           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY p.salary_min_annual))::numeric, 0) AS median_usd_floor,
           count(*)::int AS usd_n
    FROM public.job_board_postings p
    JOIN co ON co.company_token = p.company_token
    JOIN banded b ON b.company = co.company
    WHERE p.salary_currency = 'USD' AND p.salary_min_annual IS NOT NULL AND p.salary_min_annual > 0
    GROUP BY b.band
  ),
  agg AS (
    SELECT band,
           count(*)::int AS companies,
           count(*)::int AS with_headcount,
           sum(on_board)::int AS open_roles,
           round(100.0 * sum(remote_n) / GREATEST(sum(on_board), 1), 0) AS remote_pct,
           round(100.0 * sum(entry_n) / GREATEST(sum(on_board), 1), 0) AS entry_pct
    FROM banded GROUP BY band
  ),
  top AS (
    SELECT band, jsonb_agg(jsonb_build_object(
             'company', company, 'company_token', company_token,
             'on_board', on_board, 'company_total', company_total,
             'employees', employees, 'employee_basis', employee_basis,
             'yc_batch', yc_batch)
             ORDER BY employees DESC, effective DESC) AS top
    FROM (
      SELECT *, row_number() OVER (PARTITION BY band
               ORDER BY employees DESC, effective DESC) AS rn
      FROM banded
    ) r WHERE rn <= 12
    GROUP BY band
  )
  SELECT jsonb_object_agg(a.band, jsonb_build_object(
           'companies', a.companies, 'with_headcount', a.with_headcount,
           'open_roles', a.open_roles,
           'remote_pct', a.remote_pct, 'entry_pct', a.entry_pct,
           'median_usd_floor', s.median_usd_floor, 'usd_n', s.usd_n,
           'top', COALESCE(t.top, '[]'::jsonb)))
  FROM agg a
  LEFT JOIN sal s ON s.band = a.band
  LEFT JOIN top t ON t.band = a.band;
$$;
GRANT EXECUTE ON FUNCTION public.get_size_segments() TO anon, authenticated;

DO $$
BEGIN
  SET LOCAL statement_timeout = '55s';
  PERFORM public.refresh_explore_cache();
END $$;

NOTIFY pgrst, 'reload schema';