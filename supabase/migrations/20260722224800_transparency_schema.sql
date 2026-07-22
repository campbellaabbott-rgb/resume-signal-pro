-- Transparency program: definitive work-mode tags + full salary ranges.
--
-- work_mode is TRINARY-OR-NOTHING: 'remote' | 'hybrid' | 'onsite' when the
-- employer's own ATS field or explicit title/location text states it, NULL
-- when the posting doesn't say — and the UI shows nothing rather than a
-- guess. The old boolean `remote` stays (filters/stats) but now means
-- "definitively remote" only.
--
-- salary_max_annual + salary_period complete the stored range: the parser
-- already extracted min/max/period from employers' own stated pay text but
-- only the floor was stored. Values are annualized with the same honest
-- multipliers (hourly x2080, weekly x52, monthly x12); the original wording
-- stays in `salary` for display.

ALTER TABLE public.job_board_postings
  ADD COLUMN IF NOT EXISTS work_mode text
    CHECK (work_mode IN ('remote', 'hybrid', 'onsite')),
  ADD COLUMN IF NOT EXISTS salary_max_annual numeric,
  ADD COLUMN IF NOT EXISTS salary_period text
    CHECK (salary_period IN ('hour', 'week', 'month', 'year'));

-- Backfill, conservative tier only. The remote flag was set from vendor
-- fields and explicit text, so remote=true rows are definitively remote.
-- Hybrid/onsite backfill uses TITLE/LOCATION text only (the same precision
-- bar the ingest fallback uses; descriptions are never inferred from).
-- Everything else self-heals to vendor-structured values as boards rotate
-- through refresh.
UPDATE public.job_board_postings SET work_mode = 'hybrid'
 WHERE work_mode IS NULL
   AND (title ~* '\yhybrid\y' OR location ~* '\yhybrid\y');

UPDATE public.job_board_postings SET work_mode = 'remote'
 WHERE work_mode IS NULL AND remote IS TRUE;

UPDATE public.job_board_postings SET work_mode = 'onsite'
 WHERE work_mode IS NULL
   AND (title ~* '\yon-?site\y|\yin-?office\y' OR location ~* '\yon-?site\y|\yin-?office\y');

-- Keep the boolean coherent with the new semantics: hybrid is not remote.
UPDATE public.job_board_postings SET remote = false
 WHERE remote IS TRUE AND work_mode = 'hybrid';

-- 1) Per-vendor transparency coverage: how much of each hiring system's
--    corpus states pay and work mode. Published on the data pages — being
--    transparent about the limits of transparency.
CREATE OR REPLACE FUNCTION public.get_transparency_coverage()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '25s'
AS $$
  WITH by_source AS (
    SELECT source,
           count(*)::int AS total,
           count(*) FILTER (WHERE salary IS NOT NULL)::int AS pay_n,
           count(*) FILTER (WHERE work_mode IS NOT NULL)::int AS mode_n
    FROM public.job_board_postings
    GROUP BY source
  )
  SELECT jsonb_build_object(
    'by_source', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'source', source, 'total', total,
        'pay_n', pay_n, 'pay_pct', round(100.0 * pay_n / GREATEST(total, 1), 1),
        'mode_n', mode_n, 'mode_pct', round(100.0 * mode_n / GREATEST(total, 1), 1))
        ORDER BY total DESC)
      FROM by_source), '[]'::jsonb),
    'overall', (
      SELECT jsonb_build_object(
        'total', sum(total)::int,
        'pay_n', sum(pay_n)::int, 'pay_pct', round(100.0 * sum(pay_n) / GREATEST(sum(total), 1), 1),
        'mode_n', sum(mode_n)::int, 'mode_pct', round(100.0 * sum(mode_n) / GREATEST(sum(total), 1), 1))
      FROM by_source)
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_transparency_coverage() TO anon, authenticated;

-- 2) Pay Transparency Index: which fields and which large employers actually
--    state pay. Computed from postings' own text/fields — not purchasable.
CREATE OR REPLACE FUNCTION public.get_pay_transparency()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '25s'
AS $$
  WITH by_cat AS (
    SELECT category,
           count(*)::int AS total,
           count(*) FILTER (WHERE salary IS NOT NULL)::int AS pay_n
    FROM public.job_board_postings
    WHERE category IS NOT NULL AND category <> ''
    GROUP BY category
    HAVING count(*) >= 200
  ),
  by_co AS (
    SELECT max(company) AS company, company_token,
           count(*)::int AS total,
           count(*) FILTER (WHERE salary IS NOT NULL)::int AS pay_n
    FROM public.job_board_postings
    WHERE company <> ''
      AND company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
    GROUP BY company_token
    HAVING count(*) >= 50
  )
  SELECT jsonb_build_object(
    'categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'category', category, 'total', total,
        'pay_pct', round(100.0 * pay_n / GREATEST(total, 1), 1))
        ORDER BY (100.0 * pay_n / GREATEST(total, 1)) DESC)
      FROM by_cat), '[]'::jsonb),
    'top_companies', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'company', company, 'company_token', company_token,
        'total', total, 'pay_pct', pct))
      FROM (
        SELECT company, company_token, total,
               round(100.0 * pay_n / GREATEST(total, 1), 1) AS pct
        FROM by_co
        WHERE pay_n > 0
        ORDER BY (100.0 * pay_n / GREATEST(total, 1)) DESC, total DESC
        LIMIT 25
      ) t), '[]'::jsonb),
    'overall', (
      SELECT jsonb_build_object(
        'total', count(*)::int,
        'pay_pct', round(100.0 * count(*) FILTER (WHERE salary IS NOT NULL) / GREATEST(count(*), 1), 1))
      FROM public.job_board_postings)
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_pay_transparency() TO anon, authenticated;

-- 3) Transparent employers (Explore collection): companies that state pay on
--    at least 80% of a meaningful board (>=20 postings). A positive showcase
--    a company can only earn by actually stating pay — the fence-compatible
--    incentive.
CREATE OR REPLACE FUNCTION public.get_transparent_employers(p_limit int DEFAULT 12)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '25s'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'company', company, 'company_token', company_token,
    'open_roles', total, 'pay_pct', pct, 'median_usd_floor', med)), '[]'::jsonb)
  FROM (
    SELECT max(company) AS company, company_token,
           count(*)::int AS total,
           round(100.0 * count(*) FILTER (WHERE salary IS NOT NULL) / GREATEST(count(*), 1), 0) AS pct,
           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY salary_min_annual)
                  FILTER (WHERE salary_currency = 'USD' AND salary_min_annual > 0))::numeric, 0) AS med
    FROM public.job_board_postings
    WHERE company <> ''
      AND company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
    GROUP BY company_token
    HAVING count(*) >= 20
       AND 100.0 * count(*) FILTER (WHERE salary IS NOT NULL) / count(*) >= 80
    ORDER BY pct DESC, total DESC
    LIMIT GREATEST(p_limit, 1)
  ) t;
$$;
GRANT EXECUTE ON FUNCTION public.get_transparent_employers(int) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
