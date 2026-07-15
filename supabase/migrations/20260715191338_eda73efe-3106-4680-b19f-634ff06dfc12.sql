-- 20260715140000_hiring_health_superseded
DROP FUNCTION IF EXISTS public.get_company_hiring_health(text[]);
CREATE FUNCTION public.get_company_hiring_health(p_tokens text[])
RETURNS TABLE (company_token text, open_roles integer, closed_90d integer, superseded_90d integer, median_days_open numeric, median_days_to_close numeric, tracking_days integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH toks AS (SELECT DISTINCT unnest(p_tokens) AS t),
  live AS (
    SELECT company_token, count(*)::int AS open_roles,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY GREATEST(EXTRACT(EPOCH FROM (now() - first_seen)) / 86400.0, 0))::numeric AS median_days_open
    FROM public.job_board_postings WHERE company_token = ANY (p_tokens) GROUP BY company_token
  ),
  closed AS (
    SELECT company_token,
           count(*) FILTER (WHERE closed_at > now() - interval '90 days' AND NOT superseded)::int AS closed_90d,
           count(*) FILTER (WHERE closed_at > now() - interval '90 days' AND superseded)::int AS superseded_90d,
           (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (closed_at - COALESCE(posted_at, first_seen))) / 86400.0)
             FILTER (WHERE closed_at > now() - interval '90 days' AND NOT superseded AND COALESCE(posted_at, first_seen) IS NOT NULL AND closed_at >= COALESCE(posted_at, first_seen)))::numeric AS median_days_to_close,
           EXTRACT(DAY FROM (now() - min(closed_at)))::int AS tracking_days
    FROM public.job_board_closures WHERE company_token = ANY (p_tokens) GROUP BY company_token
  )
  SELECT toks.t AS company_token, COALESCE(live.open_roles, 0) AS open_roles, COALESCE(closed.closed_90d, 0) AS closed_90d, COALESCE(closed.superseded_90d, 0) AS superseded_90d,
         round(live.median_days_open, 1) AS median_days_open, round(closed.median_days_to_close, 1) AS median_days_to_close, COALESCE(closed.tracking_days, 0) AS tracking_days
  FROM toks LEFT JOIN live ON live.company_token = toks.t LEFT JOIN closed ON closed.company_token = toks.t;
$$;
GRANT EXECUTE ON FUNCTION public.get_company_hiring_health(text[]) TO anon, authenticated;

-- 20260715150000_salary_floor
ALTER TABLE public.job_board_postings ADD COLUMN IF NOT EXISTS salary_min_annual numeric;
CREATE INDEX IF NOT EXISTS job_board_postings_salary_floor_idx ON public.job_board_postings (salary_min_annual) WHERE salary_min_annual IS NOT NULL;
CREATE OR REPLACE FUNCTION public.get_salary_benchmarks()
RETURNS TABLE (category text, n integer, median_annual_min numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT category, count(*)::int AS n, round((percentile_cont(0.5) WITHIN GROUP (ORDER BY salary_min_annual))::numeric, 0) AS median_annual_min
  FROM public.job_board_postings WHERE salary_min_annual IS NOT NULL GROUP BY category HAVING count(*) >= 30 ORDER BY n DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_salary_benchmarks() TO anon, authenticated;

-- 20260715160000_entry_level_trends
CREATE OR REPLACE FUNCTION public.get_entry_level_stats()
RETURNS TABLE (total_entry bigint, total_open bigint, companies_with_entry bigint, remote_entry bigint, by_category jsonb)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public SET statement_timeout = '20s' AS $$
  SELECT count(*) FILTER (WHERE experience_band = 'entry'), count(*),
    count(DISTINCT company_token) FILTER (WHERE experience_band = 'entry'),
    count(*) FILTER (WHERE experience_band = 'entry' AND remote),
    (SELECT jsonb_object_agg(t.category, t.n) FROM (SELECT category, count(*)::int AS n FROM public.job_board_postings WHERE experience_band = 'entry' GROUP BY category ORDER BY n DESC LIMIT 12) t)
  FROM public.job_board_postings;
$$;
GRANT EXECUTE ON FUNCTION public.get_entry_level_stats() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_entry_level_companies(p_limit int DEFAULT 25)
RETURNS TABLE (company text, company_token text, entry_roles int, open_roles int)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public SET statement_timeout = '20s' AS $$
  SELECT company, company_token,
    (count(*) FILTER (WHERE experience_band = 'entry'))::int AS entry_roles, count(*)::int AS open_roles
  FROM public.job_board_postings WHERE company <> '' GROUP BY company, company_token
  HAVING count(*) FILTER (WHERE experience_band = 'entry') >= 5
  ORDER BY 3 DESC LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;
GRANT EXECUTE ON FUNCTION public.get_entry_level_companies(int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_hiring_trends()
RETURNS TABLE (week_start date, new_postings int, entry_new int, remote_new int, closed int)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public SET statement_timeout = '20s' AS $$
  WITH weeks AS (SELECT date_trunc('week', d)::date AS week_start FROM generate_series(date_trunc('week', now() - interval '28 days'), now(), interval '1 week') d),
  posted AS (
    SELECT date_trunc('week', posted_at)::date AS w, count(*)::int AS new_postings,
      (count(*) FILTER (WHERE experience_band = 'entry'))::int AS entry_new,
      (count(*) FILTER (WHERE remote))::int AS remote_new
    FROM public.job_board_postings WHERE posted_at IS NOT NULL AND posted_at > now() - interval '35 days' AND first_seen - posted_at < interval '3 days' GROUP BY 1
  ),
  closes AS (SELECT date_trunc('week', closed_at)::date AS w, count(*)::int AS closed FROM public.job_board_closures WHERE closed_at > now() - interval '35 days' AND NOT superseded GROUP BY 1)
  SELECT weeks.week_start, COALESCE(posted.new_postings, 0), COALESCE(posted.entry_new, 0), COALESCE(posted.remote_new, 0), COALESCE(closes.closed, 0)
  FROM weeks LEFT JOIN posted ON posted.w = weeks.week_start LEFT JOIN closes ON closes.w = weeks.week_start ORDER BY weeks.week_start;
$$;
GRANT EXECUTE ON FUNCTION public.get_hiring_trends() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_trending_categories()
RETURNS TABLE (category text, last7 int, prior7 int)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public SET statement_timeout = '20s' AS $$
  SELECT category,
    (count(*) FILTER (WHERE posted_at > now() - interval '7 days'))::int AS last7,
    (count(*) FILTER (WHERE posted_at <= now() - interval '7 days'))::int AS prior7
  FROM public.job_board_postings WHERE posted_at IS NOT NULL AND posted_at > now() - interval '14 days' AND first_seen - posted_at < interval '3 days'
  GROUP BY category HAVING count(*) FILTER (WHERE posted_at > now() - interval '7 days') >= 20 ORDER BY 2 DESC LIMIT 15;
$$;
GRANT EXECUTE ON FUNCTION public.get_trending_categories() TO anon, authenticated;

-- 20260715170000_feedback_loops
CREATE TABLE IF NOT EXISTS public.job_board_search_misses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  q text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  src text NOT NULL DEFAULT 'list',
  at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.job_board_search_misses TO service_role;
ALTER TABLE public.job_board_search_misses ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.job_board_posting_reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  posting_id text NOT NULL,
  company_token text NOT NULL DEFAULT '',
  reason text NOT NULL CHECK (reason IN ('gone', 'misleading', 'other')),
  note text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_board_posting_reports_posting_idx ON public.job_board_posting_reports (posting_id, at DESC);
GRANT ALL ON public.job_board_posting_reports TO service_role;
ALTER TABLE public.job_board_posting_reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-board-feedback-retention') THEN
    PERFORM cron.schedule('job-board-feedback-retention', '41 3 * * *',
      $job$ DELETE FROM public.job_board_search_misses WHERE at < now() - interval '30 days'; DELETE FROM public.job_board_posting_reports WHERE at < now() - interval '180 days'; $job$);
  END IF;
END $$;