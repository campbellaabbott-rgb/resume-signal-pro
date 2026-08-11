CREATE OR REPLACE FUNCTION public.get_transparent_employers(p_limit int DEFAULT 12)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '4min'
AS $$
  WITH agg AS (
    SELECT company_token,
           max(company) AS company,
           count(*)::int AS total,
           count(*) FILTER (WHERE salary IS NOT NULL)::int AS pay_n
    FROM public.job_board_postings
    WHERE company <> ''
      AND company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
      AND missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
    GROUP BY company_token
    HAVING count(*) >= 20
       AND 100.0 * count(*) FILTER (WHERE salary IS NOT NULL) / count(*) >= 80
  ),
  top AS (
    SELECT * FROM agg
    ORDER BY pay_n DESC, total DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 50)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'company', t.company,
           'company_token', t.company_token,
           'open_roles', t.total,
           'pay_pct', round(100.0 * t.pay_n / GREATEST(t.total, 1), 0),
           'median_usd_floor', m.med)
         ORDER BY t.pay_n DESC, t.total DESC),
         '[]'::jsonb)
  FROM top t
  LEFT JOIN LATERAL (
    SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY p.salary_min_annual))::numeric, 0) AS med
    FROM public.job_board_postings p
    WHERE p.company_token = t.company_token
      AND p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
      AND p.salary_currency = 'USD'
      AND p.salary_min_annual > 0
  ) m ON true;
$$;

REVOKE ALL ON FUNCTION public.get_transparent_employers(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_transparent_employers(int) TO service_role;

COMMENT ON FUNCTION public.get_transparent_employers(int) IS
  'Employers stating pay on >=80% of at least 20 SERVED postings, ranked by the '
  'NUMBER of roles stating pay rather than by percentage. Cron-only, revoked from anon.';

NOTIFY pgrst, 'reload schema';