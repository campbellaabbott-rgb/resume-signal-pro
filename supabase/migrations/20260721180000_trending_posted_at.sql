-- Data-accuracy bug: "Hiring fastest this week — companies that added the
-- most new roles in the last 7 days" counted effective_posted, which is
-- coalesce(posted_at, first_seen). For undated postings that falls back to
-- first_seen = OUR ingestion time, so a board we just census-ingested showed
-- ALL its postings as "new this week." Proven live: Trilongroup showed
-- "+1000 new this week" while 0 of its 1000 postings were company-dated in
-- the last 7 days and all 1000 had first_seen in the last 7 days — a pure
-- ingestion artifact, not hiring velocity (hence the unbelievable ~500
-- cluster). Fix: count posted_at (the COMPANY's stated date) only. Measured:
-- 157,465 postings are genuinely posted_at-dated within 7 days across 400+
-- companies with real names and believable single/double-digit weekly counts.
-- Companies on undated feeds simply don't rank here — honest, not inflated.

CREATE OR REPLACE FUNCTION public.get_trending_companies(p_limit int DEFAULT 12)
RETURNS TABLE (company text, company_token text, recent bigint, open_roles bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  SELECT max(company) AS company,
         company_token,
         count(*) FILTER (WHERE posted_at >= now() - interval '7 days') AS recent,
         count(*) AS open_roles
  FROM public.job_board_postings
  GROUP BY company_token
  HAVING count(*) FILTER (WHERE posted_at >= now() - interval '7 days') >= 3
  ORDER BY recent DESC, open_roles DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.get_trending_companies(int) TO anon, authenticated;

-- Same correction inside the Explore cache builder (the trending sub-query).
CREATE OR REPLACE FUNCTION public.refresh_explore_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE payload jsonb;
BEGIN
  payload := jsonb_build_object(
    'trending', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM (
        SELECT max(company) AS company, company_token,
               count(*) FILTER (WHERE posted_at >= now() - interval '7 days') AS recent,
               count(*) AS open_roles
        FROM public.job_board_postings
        GROUP BY company_token
        HAVING count(*) FILTER (WHERE posted_at >= now() - interval '7 days') >= 3
        ORDER BY recent DESC, open_roles DESC
        LIMIT 12) x),
    'newest', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM (
        SELECT max(company) AS company, company_token, count(*) AS open_roles, min(first_seen) AS first_added
        FROM public.job_board_postings
        GROUP BY company_token
        HAVING min(first_seen) >= now() - interval '14 days' AND count(*) >= 3
        ORDER BY min(first_seen) DESC, count(*) DESC
        LIMIT 12) x),
    'entry',  (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_entry_level_companies(12) x),
    'hiring', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_actively_hiring_companies(12) x),
    'salary', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_salary_benchmarks() x),
    'computed_at', now()
  );
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('explore_cache', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

-- Repopulate immediately so the corrected trending shows without waiting for
-- the hourly cron. Bounded + guarded so it can never fail the migration.
DO $$
BEGIN
  SET LOCAL statement_timeout = '40s';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
