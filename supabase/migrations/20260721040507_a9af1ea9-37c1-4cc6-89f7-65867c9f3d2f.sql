-- One-time purge of the Lever sandbox tenants everywhere
DELETE FROM public.job_board_postings  WHERE company_token IN ('levertest','leverdemo','leverdemo-8');
DELETE FROM public.job_board_closures  WHERE company_token IN ('levertest','leverdemo','leverdemo-8');
DELETE FROM public.job_board_company_snapshots WHERE company_token IN ('levertest','leverdemo','leverdemo-8');

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
    SELECT c.company_token, max(c.company) AS company, count(*) AS filled
    FROM public.job_board_closures c
    WHERE c.closed_at > now() - interval '30 days'
      AND NOT c.superseded
      AND c.company <> ''
      AND c.company_token NOT IN ('levertest','leverdemo','leverdemo-8')
      AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'
    GROUP BY c.company_token
    HAVING count(*) >= 3
    ORDER BY count(*) DESC
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

CREATE OR REPLACE FUNCTION public.get_newest_companies(p_limit int DEFAULT 12)
RETURNS TABLE (company text, company_token text, open_roles bigint, first_added timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH bounds AS (
    SELECT min(snapshot_date) AS first_day, max(snapshot_date) AS last_day
    FROM public.job_board_company_snapshots
  ),
  appearances AS (
    SELECT company_token, min(snapshot_date) AS appeared
    FROM public.job_board_company_snapshots
    GROUP BY company_token
  )
  SELECT s.company, s.company_token, s.open_roles::bigint, a.appeared::timestamptz AS first_added
  FROM appearances a
  JOIN public.job_board_company_snapshots s
    ON s.company_token = a.company_token
   AND s.snapshot_date = (SELECT last_day FROM bounds)
  WHERE a.appeared > (SELECT first_day FROM bounds)
    AND a.appeared >= (SELECT last_day FROM bounds) - 14
    AND s.open_roles >= 3
  ORDER BY a.appeared DESC, s.open_roles DESC
  LIMIT GREATEST(p_limit, 1);
$$;
GRANT EXECUTE ON FUNCTION public.get_newest_companies(int) TO anon, authenticated;

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
    'salary',   (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_salary_benchmarks() x),
    'computed_at', now()
  );
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('explore_cache', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

DO $$
BEGIN
  SET LOCAL statement_timeout = '40s';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;