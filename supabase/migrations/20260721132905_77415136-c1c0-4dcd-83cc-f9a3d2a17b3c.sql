CREATE OR REPLACE FUNCTION public.get_repost_churn_companies(p_limit int DEFAULT 12)
RETURNS TABLE (
  company text, company_token text,
  repost_events bigint, reposted_roles bigint,
  worst_title text, worst_count bigint,
  tracking_days int
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH sup AS (
    SELECT company_token, max(company) AS company, title,
           count(*) AS n, min(closed_at) AS first_ev
    FROM public.job_board_closures
    WHERE superseded
    GROUP BY company_token, title
  ),
  agg AS (
    SELECT company_token, max(company) AS company,
           sum(n)::bigint AS repost_events,
           count(*)::bigint AS reposted_roles,
           GREATEST(EXTRACT(DAY FROM now() - min(first_ev))::int, 1) AS tracking_days
    FROM sup
    GROUP BY company_token
    HAVING sum(n) >= 20
  ),
  worst AS (
    SELECT DISTINCT ON (company_token) company_token, title, n
    FROM sup ORDER BY company_token, n DESC
  )
  SELECT a.company, a.company_token, a.repost_events, a.reposted_roles,
         w.title AS worst_title, w.n::bigint AS worst_count, a.tracking_days
  FROM agg a
  JOIN worst w USING (company_token)
  ORDER BY a.repost_events DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.get_repost_churn_companies(int) TO anon, authenticated;

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