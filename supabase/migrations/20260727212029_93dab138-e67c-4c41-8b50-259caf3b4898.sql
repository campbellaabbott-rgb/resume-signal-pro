-- Read-only accessor for the daily audit, mirroring get_stats_cache().
CREATE OR REPLACE FUNCTION public.get_audit_result()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT v FROM public.job_board_meta WHERE k = 'audit'; $$;

GRANT EXECUTE ON FUNCTION public.get_audit_result() TO anon, authenticated;

DROP FUNCTION IF EXISTS public.get_ghost_job_index_stats();

CREATE FUNCTION public.get_ghost_job_index_stats()
RETURNS TABLE (
  total_open bigint,
  total_companies bigint,
  total_company_names bigint,
  closed_90d bigint,
  observed_days integer,
  median_days_open numeric,
  median_days_to_close numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT
    (SELECT count(*) FROM public.job_board_postings),
    (SELECT count(DISTINCT company_token) FROM public.job_board_postings),
    (SELECT count(DISTINCT lower(btrim(company)))
       FROM public.job_board_postings WHERE company <> ''),
    (SELECT count(*) FROM public.job_board_closures WHERE closed_at > now() - interval '90 days'),
    (SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (now() - MIN(closed_at))) / 86400.0))::integer
       FROM public.job_board_closures),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (
       ORDER BY GREATEST(EXTRACT(EPOCH FROM (now() - first_seen)) / 86400.0, 0)))::numeric, 1)
     FROM public.job_board_postings),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (
       ORDER BY EXTRACT(EPOCH FROM (closed_at - COALESCE(posted_at, first_seen))) / 86400.0))::numeric, 1)
     FROM public.job_board_closures
     WHERE closed_at > now() - interval '90 days'
       AND COALESCE(posted_at, first_seen) IS NOT NULL
       AND closed_at >= COALESCE(posted_at, first_seen));
$$;

GRANT EXECUTE ON FUNCTION public.get_ghost_job_index_stats() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_size_segments()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
SET statement_timeout = '30s'
AS $$
  WITH co AS (
    SELECT p.company_token,
           max(p.company) AS company,
           count(*)::int AS on_board,
           count(*) FILTER (WHERE p.remote)::int AS remote_n,
           count(*) FILTER (WHERE p.work_mode IS NOT NULL)::int AS disclosed_n,
           count(*) FILTER (WHERE p.experience_band = 'entry')::int AS entry_n,
           COALESCE(v.feed_total, 0) AS feed_total
    FROM public.job_board_postings p
    LEFT JOIN public.job_board_verifications v ON v.company_token = p.company_token
    WHERE p.company <> ''
      AND p.company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
    GROUP BY p.company_token, v.feed_total
    HAVING count(*) >= 3
  ),
  named AS (
    SELECT company,
           (array_agg(company_token ORDER BY GREATEST(on_board, feed_total) DESC))[1] AS company_token,
           sum(on_board)::int AS on_board,
           sum(remote_n)::int AS remote_n,
           sum(disclosed_n)::int AS disclosed_n,
           sum(entry_n)::int AS entry_n,
           NULLIF(sum(feed_total), 0)::int AS company_total,
           GREATEST(sum(on_board), sum(feed_total))::int AS effective
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
             'on_board', on_board, 'company_total', company_total)
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

GRANT EXECUTE ON FUNCTION public.get_size_segments() TO anon, authenticated, service_role;