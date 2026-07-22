-- Headcount integrity: fix the Santander-class errors and make the Explore
-- scale segments honest by construction.
--
-- What went wrong (live-audited 2026-07-22):
--   1. Wrong-entity Wikidata matches: Banco Santander seeded with 902
--      employees (real: ~194,000) — a mega-bank displayed as "mid-market".
--   2. The footprint fallback banded companies WITHOUT headcounts by their
--      board's posting count, which put Rockwell Automation, Thomson Reuters,
--      7-Eleven and Wegmans (25k-100k+ employees) in "mid-market" because
--      their boards list ~500 roles.
--   3. Stale YC self-reports: "Path - 12 employees" while posting 71 roles.
--
-- The fix, in the honest-brand direction: segments now show ONLY companies
-- with a sourced headcount that the board itself does not contradict
-- (open roles must not exceed 1.2x claimed employees). No fallback banding,
-- no guessed sizes. Companies without a credible count simply don't appear.

-- 1) Correct the wrong-entity match. Santander Group (Wikidata Q806215),
--    latest dated employee statement: 194,000 (2015-01-01).
UPDATE public.company_profiles
SET employee_count = 194000
WHERE company_token = 'santander~wd3~SantanderCareers';

-- 2) Remove seeds whose values are stale undated Wikidata copies contradicted
--    by well-documented reality (we show nothing rather than a guess):
--    Behaviour Interactive (seeded 200, real ~1,300),
--    Cohesity (seeded 250, real ~3,000).
DELETE FROM public.company_profiles
WHERE company_token IN ('bhvr', 'cohesity~wd5~cohesity_careers');

-- 3) Add verified headcounts for major boards that had none — each value is
--    Wikidata P1128 with a dated statement, cross-checked for plausibility:
--    PwC Q488048 295,371 (2021) · Bank of America Q487907 213,000 (2023) ·
--    RTX Q89368734 182,000 (2022) · HPE Q19923099 60,000 (2018) ·
--    Nuffield Health Q7068711 19,361 (2024) · Thomson Reuters Q1141267 24,000 (2020).
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

-- 4) get_size_segments v4: headcount-only banding with a board-consistency
--    gate. Every displayed company has a sourced count; every band aggregate
--    describes exactly the companies listed.
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
  -- The honesty gate: a sourced headcount the board itself doesn't contradict.
  -- More open roles than 1.2x claimed employees means the count is stale or
  -- mismatched (e.g. a 12-person YC snapshot posting 71 roles) — drop it.
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

-- Rebuild the cached Explore payload so the fix is visible immediately.
DO $$
BEGIN
  SET LOCAL statement_timeout = '55s';
  PERFORM public.refresh_explore_cache();
END $$;

NOTIFY pgrst, 'reload schema';
