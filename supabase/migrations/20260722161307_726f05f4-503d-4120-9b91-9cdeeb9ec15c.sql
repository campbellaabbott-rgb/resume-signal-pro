-- See supabase/migrations/20260722160000_reapply_showcase_names.sql
INSERT INTO public.company_name_overrides (slug, display_name) VALUES
  ('campingworld','Camping World'),
  ('madixinc','Madix')
ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name;

UPDATE public.job_board_postings p SET company = o.display_name
  FROM public.company_name_overrides o
 WHERE p.company_token LIKE '%~wd%'
   AND split_part(p.company_token,'~',1) = o.slug AND p.company <> o.display_name;
UPDATE public.job_board_closures c SET company = o.display_name
  FROM public.company_name_overrides o
 WHERE c.company_token LIKE '%~wd%'
   AND split_part(c.company_token,'~',1) = o.slug AND c.company <> o.display_name;
UPDATE public.job_board_company_snapshots s SET company = o.display_name
  FROM public.company_name_overrides o
 WHERE s.company_token LIKE '%~wd%'
   AND split_part(s.company_token,'~',1) = o.slug AND s.company <> o.display_name;

DELETE FROM public.job_board_postings WHERE company_token = 'globalelitecareers';
DELETE FROM public.job_board_closures WHERE company_token = 'globalelitecareers';
DELETE FROM public.job_board_company_snapshots WHERE company_token = 'globalelitecareers';

CREATE TABLE IF NOT EXISTS public.showcase_excluded (
  company_token text PRIMARY KEY,
  reason text NOT NULL DEFAULT ''
);
GRANT SELECT ON public.showcase_excluded TO anon, authenticated;
GRANT ALL ON public.showcase_excluded TO service_role;
ALTER TABLE public.showcase_excluded ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "showcase_excluded_public_read" ON public.showcase_excluded;
CREATE POLICY "showcase_excluded_public_read" ON public.showcase_excluded FOR SELECT USING (true);

INSERT INTO public.showcase_excluded (company_token, reason) VALUES
  ('parallelemployment', 'staffing agency (verified: varied client-industrial postings)'),
  ('drive-time-transports', 'driver-recruiting board, mass-duplicated identical ads'),
  ('c3-trucking', 'driver-recruiting board, mass-duplicated identical ads'),
  ('liquidpersonnel', 'staffing agency (healthcare/social-work recruiting)'),
  ('PSGGlobalSolutions2', 'BPO/staffing recruiter'),
  ('myview~wd3~paradox_careers', 'unidentifiable operator (slug and tenant both ambiguous)')
ON CONFLICT (company_token) DO UPDATE SET reason = EXCLUDED.reason;

INSERT INTO public.company_name_overrides (slug, display_name) VALUES
  ('fifththird','Fifth Third Bank'), ('thermofisher','Thermo Fisher Scientific'),
  ('thomsonreuters','Thomson Reuters'), ('rockwellautomation','Rockwell Automation'),
  ('gevernova','GE Vernova'), ('lambweston','Lamb Weston'),
  ('independencepetgroup','Independence Pet Group'), ('spectrumhealth','Spectrum Health'),
  ('bannerhealth','Banner Health'), ('capitalone','Capital One'),
  ('firststudent','First Student'), ('highmarkhealth','Highmark Health'),
  ('calibercollision','Caliber Collision'), ('sunbeltrentals','Sunbelt Rentals'),
  ('aspendental','Aspen Dental'), ('bristolmyerssquibb','Bristol Myers Squibb'),
  ('generalmotors','General Motors'), ('paloaltonetworks','Palo Alto Networks'),
  ('panerabread','Panera Bread'), ('wasteconnections','Waste Connections'),
  ('airliquidehr','Air Liquide'), ('bakerhughes','Baker Hughes'),
  ('brighthorizons','Bright Horizons'), ('cardinalhealth','Cardinal Health'),
  ('carilionclinic','Carilion Clinic'), ('cecentertainment','CEC Entertainment'),
  ('coffeeandbagelbrands','Coffee and Bagel Brands'), ('dentsuaegis','Dentsu'),
  ('memorialhealthcare','Memorial Healthcare System'), ('bjswholesaleclub','BJ''s Wholesale Club'),
  ('jeffersonhealth','Jefferson Health'), ('knitwellgroup','KnitWell Group'),
  ('brownhealth','Brown University Health'), ('daveandbusters','Dave & Buster''s'),
  ('nuffieldhealth','Nuffield Health'), ('ohiohealth','OhioHealth'),
  ('spartannash','SpartanNash'), ('tysonfoods','Tyson Foods'),
  ('kansashealthsystem','The University of Kansas Health System'),
  ('motorolasolutions','Motorola Solutions'), ('sluhn','St. Luke''s University Health Network'),
  ('lvhn','Lehigh Valley Health Network'), ('umiami','University of Miami'),
  ('wustl','Washington University in St. Louis'), ('osu','Ohio State University'),
  ('psu','Penn State University'), ('mtb','M&T Bank'),
  ('genpt','Genuine Parts Company'), ('globalhr','RTX'),
  ('ghr','Bank of America'), ('aah','Advocate Health'),
  ('investpsp','PSP Investments'), ('my7elevenhr','7-Eleven'),
  ('ivytech','Ivy Tech Community College'), ('ummc','University of Mississippi Medical Center'),
  ('tamus','Texas A&M University System'), ('ur','University of Rochester'),
  ('vumc','Vanderbilt University Medical Center'), ('musc','Medical University of South Carolina'),
  ('amat','Applied Materials'), ('carmax','CarMax'), ('flextronics','Flex')
ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name;

UPDATE public.job_board_postings p SET company = o.display_name
  FROM public.company_name_overrides o
 WHERE p.company_token LIKE '%~wd%'
   AND split_part(p.company_token,'~',1) = o.slug AND p.company <> o.display_name;
UPDATE public.job_board_closures c SET company = o.display_name
  FROM public.company_name_overrides o
 WHERE c.company_token LIKE '%~wd%'
   AND split_part(c.company_token,'~',1) = o.slug AND c.company <> o.display_name;
UPDATE public.job_board_company_snapshots s SET company = o.display_name
  FROM public.company_name_overrides o
 WHERE s.company_token LIKE '%~wd%'
   AND split_part(s.company_token,'~',1) = o.slug AND s.company <> o.display_name;

DROP FUNCTION IF EXISTS public.get_actively_hiring_companies(int);
CREATE FUNCTION public.get_actively_hiring_companies(p_limit int DEFAULT 20)
RETURNS TABLE (company text, company_token text, closed_90d bigint, open_roles bigint, tracking_days int)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH span AS (
    SELECT LEAST(GREATEST(EXTRACT(DAY FROM now() - min(closed_at))::int, 1), 30) AS days
    FROM public.job_board_closures
  ),
  fills AS (
    SELECT c.company_token, max(c.company) AS company,
           count(*) FILTER (
             WHERE NOT c.superseded
               AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'
           ) AS filled,
           count(*) FILTER (WHERE c.superseded) AS churn
    FROM public.job_board_closures c
    WHERE c.closed_at > now() - interval '30 days'
      AND c.company <> ''
      AND c.company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
    GROUP BY c.company_token
    HAVING count(*) FILTER (
             WHERE NOT c.superseded
               AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'
           ) >= 3
       AND count(*) FILTER (WHERE c.superseded)
           <= count(*) FILTER (
                WHERE NOT c.superseded
                  AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'
              )
    ORDER BY 3 DESC
    LIMIT GREATEST(p_limit, 1) * 3
  )
  SELECT f.company, f.company_token, f.filled AS closed_90d, o.n AS open_roles,
         (SELECT days FROM span) AS tracking_days
  FROM fills f
  JOIN LATERAL (
    SELECT count(*) AS n FROM public.job_board_postings p WHERE p.company_token = f.company_token
  ) o ON true
  WHERE o.n > 0
  ORDER BY f.filled DESC, o.n DESC
  LIMIT GREATEST(p_limit, 1);
$$;
GRANT EXECUTE ON FUNCTION public.get_actively_hiring_companies(int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_entry_level_companies(p_limit int DEFAULT 25)
RETURNS TABLE (company text, company_token text, entry_roles int, open_roles int)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public SET statement_timeout = '20s' AS $$
  SELECT company, company_token,
    (count(*) FILTER (WHERE experience_band = 'entry'))::int AS entry_roles, count(*)::int AS open_roles
  FROM public.job_board_postings
  WHERE company <> ''
    AND company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
  GROUP BY company, company_token
  HAVING count(*) FILTER (WHERE experience_band = 'entry') >= 5
  ORDER BY 3 DESC LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;
GRANT EXECUTE ON FUNCTION public.get_entry_level_companies(int) TO anon, authenticated, service_role;

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
  banded AS (
    SELECT *, CASE
      WHEN employees IS NOT NULL AND employees >= 1000 THEN 'enterprise'
      WHEN employees IS NOT NULL AND employees >= 100 THEN 'mid'
      WHEN employees IS NOT NULL THEN 'small'
      WHEN effective >= 500 THEN 'enterprise'
      WHEN effective >= 50 THEN 'mid'
      ELSE 'small' END AS band
    FROM named
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
           sum(on_board)::int AS open_roles,
           round(100.0 * sum(remote_n) / GREATEST(sum(on_board), 1), 0) AS remote_pct,
           round(100.0 * sum(entry_n) / GREATEST(sum(on_board), 1), 0) AS entry_pct
    FROM banded GROUP BY band
  ),
  top AS (
    SELECT band, jsonb_agg(jsonb_build_object(
             'company', company, 'company_token', company_token,
             'on_board', on_board, 'company_total', company_total,
             'employees', employees, 'employee_basis', employee_basis, 'yc_batch', yc_batch)
             ORDER BY effective DESC) AS top
    FROM (
      SELECT *, row_number() OVER (PARTITION BY band ORDER BY effective DESC) AS rn
      FROM banded
    ) r WHERE rn <= 12
    GROUP BY band
  )
  SELECT jsonb_object_agg(a.band, jsonb_build_object(
           'companies', a.companies, 'open_roles', a.open_roles,
           'remote_pct', a.remote_pct, 'entry_pct', a.entry_pct,
           'median_usd_floor', s.median_usd_floor, 'usd_n', s.usd_n,
           'top', COALESCE(t.top, '[]'::jsonb)))
  FROM agg a
  LEFT JOIN sal s ON s.band = a.band
  LEFT JOIN top t ON t.band = a.band;
$$;
GRANT EXECUTE ON FUNCTION public.get_size_segments() TO anon, authenticated;

SELECT public.refresh_explore_cache();