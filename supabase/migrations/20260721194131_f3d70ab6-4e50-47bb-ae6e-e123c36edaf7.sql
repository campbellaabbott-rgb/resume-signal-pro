-- Explore: company-scale segments (Enterprise / Mid-market / Startups & small
-- teams). HONESTY BASIS: we hold no headcount data (no legitimate first-party
-- source exists), so segmentation is by HIRING FOOTPRINT — open roles on the
-- company's own board — and every blurb states that definition. Windowed
-- Workday boards are banded by GREATEST(stored, feed_total) so a giant whose
-- fetch is capped at ~500 (Caterpillar: 503 stored / 949 advertised) still
-- lands in Enterprise, and the UI renders their counts as floors ("503+").
-- Bands (previewed live: 182 / 1,895 / 16,028 companies): 500+, 50-499, 3-49.
-- Salary medians are USD-stated-only (currency-correct rule, never mixed).

CREATE OR REPLACE FUNCTION public.get_size_segments()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '25s'
AS $$
  WITH co AS (
    SELECT p.company_token,
           max(p.company) AS company,
           count(*)::int AS open_roles,
           count(*) FILTER (WHERE p.remote)::int AS remote_n,
           count(*) FILTER (WHERE p.experience_band = 'entry')::int AS entry_n,
           v.feed_total,
           GREATEST(count(*)::int, COALESCE(v.feed_total, 0)) AS effective
    FROM public.job_board_postings p
    LEFT JOIN public.job_board_verifications v ON v.company_token = p.company_token
    WHERE p.company <> ''
    GROUP BY p.company_token, v.feed_total
    HAVING count(*) >= 3
  ),
  banded AS (
    SELECT *, CASE WHEN effective >= 500 THEN 'enterprise'
                   WHEN effective >= 50 THEN 'mid'
                   ELSE 'small' END AS band
    FROM co
  ),
  sal AS (
    SELECT b.band,
           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY p.salary_min_annual))::numeric, 0) AS median_usd_floor,
           count(*)::int AS usd_n
    FROM public.job_board_postings p
    JOIN banded b ON b.company_token = p.company_token
    WHERE p.salary_currency = 'USD' AND p.salary_min_annual IS NOT NULL AND p.salary_min_annual > 0
    GROUP BY b.band
  ),
  agg AS (
    SELECT band,
           count(*)::int AS companies,
           sum(open_roles)::int AS open_roles,
           round(100.0 * sum(remote_n) / GREATEST(sum(open_roles), 1), 0) AS remote_pct,
           round(100.0 * sum(entry_n) / GREATEST(sum(open_roles), 1), 0) AS entry_pct
    FROM banded GROUP BY band
  ),
  top AS (
    SELECT band, jsonb_agg(jsonb_build_object(
             'company', company, 'company_token', company_token,
             'open_roles', open_roles, 'feed_total', feed_total)
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

-- Cache builder gains 'segments'; all existing collections unchanged.
CREATE OR REPLACE FUNCTION public.refresh_explore_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE payload jsonb;
BEGIN
  payload := jsonb_build_object(
    'trending', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_trending_companies(12) x),
    'newest',   (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_newest_companies(12) x),
    'entry',    (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_entry_level_companies(12) x),
    'hiring',   (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_actively_hiring_companies(12) x),
    'reposters',(SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_repost_churn_companies(12) x),
    'salary',   (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_salary_benchmarks() x),
    'segments', (SELECT coalesce(public.get_size_segments(), '{}'::jsonb)),
    'computed_at', now()
  );
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('explore_cache', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

DO $$
BEGIN
  SET LOCAL statement_timeout = '55s';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;