INSERT INTO public.company_profiles (company_token, employee_count, employee_basis, yc_batch)
VALUES
  ('BoschGroup', 413000, 'public_records', NULL),
  ('ghr~wd1~Lateral-US', 213000, 'public_records', NULL),
  ('HMGroup', 177000, 'public_records', NULL),
  ('generalmotors~wd5~Careers_GM', 164000, 'public_records', NULL),
  ('tysonfoods~wd5~TSN', 133000, 'public_records', NULL),
  ('tysonfoods~wd5~TSN5', 133000, 'public_records', NULL),
  ('philips~wd3~jobs-and-careers', 81592, 'public_records', NULL),
  ('philips~wd3~internal-job-postings-list-for-philips-contingent-workers', 81592, 'public_records', NULL),
  ('cigna~wd5~cignacareers', 73800, 'public_records', NULL),
  ('abbott~wd5~abbottcareers', 73000, 'public_records', NULL),
  ('abbott~wd5~abbottcareers2', 73000, 'public_records', NULL),
  ('StandardBankGroup', 69000, 'public_records', NULL),
  ('usbank~wd1~US_Bank_Careers', 68108, 'public_records', NULL),
  ('ing~wd3~ICSGBLCOR', 64298, 'public_records', NULL),
  ('ing~wd3~jvsgblcor', 64298, 'public_records', NULL),
  ('bakerhughes~wd5~BakerHughes', 59400, 'public_records', NULL),
  ('micron~wd1~external', 48000, 'public_records', NULL),
  ('bmo~wd3~External', 46778, 'public_records', NULL),
  ('fmr~wd1~fidelitycareers', 45000, 'public_records', NULL),
  ('bunnings~wd3~Careers', 31000, 'public_records', NULL),
  ('bristolmyerssquibb~wd5~BMS', 30000, 'public_records', NULL),
  ('my7elevenhr~wd12~Careers', 20700, 'public_records', NULL),
  ('Vattenfall', 20000, 'public_records', NULL),
  ('wasteconnections~wd1~Careers', 19998, 'public_records', NULL),
  ('motorolasolutions~wd5~Careers', 18000, 'public_records', NULL),
  ('RedBull', 17848, 'public_records', NULL),
  ('covestro~wd3~cov_external', 17520, 'public_records', NULL),
  ('gilead~wd1~gileadcareers', 17000, 'public_records', NULL),
  ('gilead~wd1~gileadhotjobcareers', 17000, 'public_records', NULL),
  ('paloaltonetworks~wd5~panwexternalcareers', 13900, 'public_records', NULL),
  ('nexstar~wd5~nexstar', 12832, 'public_records', NULL),
  ('campingworld~wd5~Jobs', 7221, 'public_records', NULL),
  ('marvell~wd1~MarvellCareers', 7000, 'public_records', NULL),
  ('iki-1732802603', 5258, 'public_records', NULL),
  ('Ignitisgroup', 4688, 'public_records', NULL)
ON CONFLICT (company_token) DO NOTHING;

DELETE FROM public.company_profiles WHERE company_token = 'autostore~wd3~autostore';

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
           sum(remote_n)::int AS remote_n,
           sum(entry_n)::int AS entry_n,
           NULLIF(sum(feed_total), 0)::int AS company_total,
           GREATEST(sum(on_board), sum(feed_total))::int AS effective,
           max(employee_count) AS employees,
           (array_agg(employee_basis ORDER BY employee_count DESC NULLS LAST))[1] AS employee_basis,
           (array_agg(yc_batch ORDER BY employee_count DESC NULLS LAST))[1] AS yc_batch
    FROM normed GROUP BY norm
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
    JOIN normed n ON n.company_token = p.company_token
    JOIN banded b ON b.norm = n.norm
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
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

NOTIFY pgrst, 'reload schema';