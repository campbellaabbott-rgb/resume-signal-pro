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
    ORDER BY (100.0 * pay_n / GREATEST(total, 1)) DESC, total DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 50)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'company', t.company,
           'company_token', t.company_token,
           'open_roles', t.total,
           'pay_pct', round(100.0 * t.pay_n / GREATEST(t.total, 1), 0),
           'median_usd_floor', m.med)
         ORDER BY (100.0 * t.pay_n / GREATEST(t.total, 1)) DESC, t.total DESC),
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
  'Employers stating pay on >=80% of at least 20 SERVED postings (missing_since '
  'IS NULL and effective_posted within 30 days). Returns scalar jsonb — call it '
  'as a scalar, never in FROM, which yields [{"x":[...]}] instead. Cron-only: '
  'refresh_explore_cache is the sole caller; revoked from anon because it held a '
  'worker for 26s per Explore page view until 20260810180000.';

CREATE OR REPLACE FUNCTION public.refresh_explore_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
SET statement_timeout = '10min'
AS $$
DECLARE
  payload jsonb;
  transparent jsonb := '[]'::jsonb;
  transparent_status text := 'ok';
BEGIN
  BEGIN
    transparent := COALESCE(public.get_transparent_employers(12), '[]'::jsonb);
    IF jsonb_typeof(transparent) <> 'array' THEN
      transparent_status := 'failed: expected array, got ' || jsonb_typeof(transparent);
      transparent := '[]'::jsonb;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    transparent := '[]'::jsonb;
    transparent_status := 'failed: ' || left(SQLERRM, 120);
    RAISE WARNING 'explore cache: transparent employers unavailable (%)', SQLERRM;
  END;
  payload := jsonb_build_object(
    'trending', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_trending_companies(12) x),
    'newest',   (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_newest_companies(12) x),
    'entry',    (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_entry_level_companies(12) x),
    'hiring',   (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_actively_hiring_companies(12) x),
    'reposters',(SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_repost_churn_companies(12) x),
    'salary',   (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_salary_benchmarks() x),
    'segments', (SELECT coalesce(public.get_size_segments(), '{}'::jsonb)),
    'transparent', transparent,
    'transparent_status', transparent_status,
    'computed_at', now()
  );
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('explore_cache', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_size_segments()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
SET statement_timeout = '30s'
AS $$
  WITH co AS (
    SELECT p.company_token,
           max(p.company) AS company,
           count(*)::int AS on_board,
           count(*) FILTER (WHERE p.work_mode = 'remote')::int AS remote_n,
           count(*) FILTER (WHERE p.work_mode IS NOT NULL)::int AS disclosed_n,
           count(*) FILTER (WHERE p.experience_band = 'entry')::int AS entry_n,
           COALESCE(v.feed_total, 0) AS feed_total
    FROM public.job_board_postings p
    LEFT JOIN public.job_board_verifications v ON v.company_token = p.company_token
    WHERE p.company <> ''
      AND p.company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
      AND p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
    GROUP BY p.company_token, v.feed_total
    HAVING count(*) >= 3
  ),
  named AS (
    SELECT company,
           (array_agg(company_token ORDER BY on_board DESC))[1] AS company_token,
           sum(on_board)::int AS on_board,
           max(on_board)::int AS lead_on_board,
           sum(remote_n)::int AS remote_n,
           sum(disclosed_n)::int AS disclosed_n,
           sum(entry_n)::int AS entry_n,
           NULLIF(sum(feed_total), 0)::int AS company_total,
           sum(on_board)::int AS effective
    FROM co GROUP BY company
  ),
  banded AS (
    SELECT *, CASE
      WHEN effective >= 1000 THEN 'mega'
      WHEN effective >= 200  THEN 'large'
      WHEN effective >= 50   THEN 'mid'
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
      AND p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
    GROUP BY b.band
  ),
  agg AS (
    SELECT band,
           count(*)::int AS companies,
           sum(on_board)::int AS open_roles,
           sum(disclosed_n)::int AS disclosed_n,
           CASE WHEN sum(disclosed_n) > 0
                THEN round(100.0 * sum(remote_n) / sum(disclosed_n), 0) END AS remote_pct,
           CASE WHEN sum(on_board) > 0
                THEN round(100.0 * sum(disclosed_n) / sum(on_board), 0) END AS disclosed_pct,
           round(100.0 * sum(entry_n) / GREATEST(sum(on_board), 1), 0) AS entry_pct
    FROM banded GROUP BY band
  ),
  top AS (
    SELECT band, jsonb_agg(jsonb_build_object(
             'company', company, 'company_token', company_token,
             'on_board', lead_on_board, 'company_total', company_total)
             ORDER BY effective DESC) AS top
    FROM (
      SELECT *, row_number() OVER (PARTITION BY band ORDER BY effective DESC) AS rn
      FROM banded
    ) r WHERE rn <= 12
    GROUP BY band
  )
  SELECT jsonb_object_agg(a.band, jsonb_build_object(
           'companies', a.companies, 'open_roles', a.open_roles,
           'remote_pct', a.remote_pct, 'disclosed_pct', a.disclosed_pct,
           'disclosed_n', a.disclosed_n, 'entry_pct', a.entry_pct,
           'median_usd_floor', s.median_usd_floor, 'usd_n', s.usd_n,
           'top', COALESCE(t.top, '[]'::jsonb)))
  FROM agg a
  LEFT JOIN sal s ON s.band = a.band
  LEFT JOIN top t ON t.band = a.band;
$$;

CREATE OR REPLACE FUNCTION public.get_actively_hiring_companies(p_limit int DEFAULT 20)
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
    SELECT count(*) AS n FROM public.job_board_postings p
    WHERE p.company_token = f.company_token
      AND p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
  ) o ON true
  WHERE o.n > 0
  ORDER BY f.filled DESC, o.n DESC
  LIMIT GREATEST(p_limit, 1);
$$;

CREATE OR REPLACE FUNCTION public.get_entry_level_companies(p_limit int DEFAULT 25)
RETURNS TABLE (company text, company_token text, entry_roles int, open_roles int)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public SET statement_timeout = '20s' AS $$
  SELECT company, company_token,
    (count(*) FILTER (WHERE experience_band = 'entry'))::int AS entry_roles, count(*)::int AS open_roles
  FROM public.job_board_postings
  WHERE company <> ''
    AND company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
    AND missing_since IS NULL
    AND effective_posted >= now() - interval '30 days'
  GROUP BY company, company_token
  HAVING count(*) FILTER (WHERE experience_band = 'entry') >= 5
  ORDER BY 3 DESC LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

CREATE OR REPLACE FUNCTION public.get_salary_benchmarks()
RETURNS TABLE (category text, currency text, n integer, median_annual_min numeric)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  WITH per AS (
    SELECT category,
           salary_currency AS currency,
           count(*)::int AS n,
           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY salary_min_annual))::numeric, 0) AS median_annual_min
    FROM public.job_board_postings
    WHERE salary_min_annual IS NOT NULL AND salary_currency IS NOT NULL
      AND missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
    GROUP BY category, salary_currency
    HAVING count(*) >= 30
  )
  SELECT DISTINCT ON (category) category, currency, n, median_annual_min
  FROM per
  ORDER BY category, n DESC;
$$;

COMMENT ON FUNCTION public.get_size_segments() IS
  'Explore size bands. Counts ONLY served postings (missing_since IS NULL and '
  'effective_posted within 30 days) and bands on sum(on_board), so the heading '
  '"1,000+ open roles" describes the same quantity the stat line under it '
  'renders. Banding on GREATEST(on_board, feed_total) put 597-role-average '
  'companies under a 1,000+ heading.';

NOTIFY pgrst, 'reload schema';