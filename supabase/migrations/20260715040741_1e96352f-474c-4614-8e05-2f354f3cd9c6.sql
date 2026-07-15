-- === 20260715100000_closure_accuracy.sql ===
ALTER TABLE public.job_board_closures
  ADD COLUMN IF NOT EXISTS superseded boolean NOT NULL DEFAULT false;

DELETE FROM public.job_board_closures
  WHERE closed_at - COALESCE(posted_at, first_seen) >= interval '29 days';
DELETE FROM public.job_board_closures c
  WHERE c.source = 'smartrecruiters'
    AND (SELECT count(*) FROM public.job_board_postings p
         WHERE p.company_token = c.company_token) >= 800;

CREATE OR REPLACE FUNCTION public.get_company_hiring_health(p_tokens text[])
RETURNS TABLE (
  company_token text,
  open_roles integer,
  closed_90d integer,
  median_days_open numeric,
  median_days_to_close numeric,
  tracking_days integer
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH toks AS (
    SELECT DISTINCT unnest(p_tokens) AS t
  ),
  live AS (
    SELECT company_token,
           count(*)::int AS open_roles,
           percentile_cont(0.5) WITHIN GROUP (
             ORDER BY GREATEST(EXTRACT(EPOCH FROM (now() - first_seen)) / 86400.0, 0)
           )::numeric AS median_days_open
    FROM public.job_board_postings
    WHERE company_token = ANY (p_tokens)
    GROUP BY company_token
  ),
  closed AS (
    SELECT company_token,
           count(*) FILTER (WHERE closed_at > now() - interval '90 days' AND NOT superseded)::int AS closed_90d,
           (percentile_cont(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (closed_at - COALESCE(posted_at, first_seen))) / 86400.0
           ) FILTER (
             WHERE closed_at > now() - interval '90 days'
               AND NOT superseded
               AND COALESCE(posted_at, first_seen) IS NOT NULL
               AND closed_at >= COALESCE(posted_at, first_seen)
           ))::numeric AS median_days_to_close,
           EXTRACT(DAY FROM (now() - min(closed_at)))::int AS tracking_days
    FROM public.job_board_closures
    WHERE company_token = ANY (p_tokens)
    GROUP BY company_token
  )
  SELECT
    toks.t AS company_token,
    COALESCE(live.open_roles, 0) AS open_roles,
    COALESCE(closed.closed_90d, 0) AS closed_90d,
    round(live.median_days_open, 1) AS median_days_open,
    round(closed.median_days_to_close, 1) AS median_days_to_close,
    COALESCE(closed.tracking_days, 0) AS tracking_days
  FROM toks
  LEFT JOIN live ON live.company_token = toks.t
  LEFT JOIN closed ON closed.company_token = toks.t;
$$;
GRANT EXECUTE ON FUNCTION public.get_company_hiring_health(text[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_actively_hiring_companies(p_limit int DEFAULT 20)
RETURNS TABLE (company text, company_token text, closed_90d bigint, open_roles bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT
    c.company,
    c.company_token,
    count(*) AS closed_90d,
    COALESCE((SELECT count(*) FROM public.job_board_postings p WHERE p.company_token = c.company_token), 0) AS open_roles
  FROM public.job_board_closures c
  WHERE c.closed_at > now() - interval '90 days' AND NOT c.superseded AND c.company <> ''
  GROUP BY c.company, c.company_token
  ORDER BY count(*) DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;
GRANT EXECUTE ON FUNCTION public.get_actively_hiring_companies(int) TO anon, authenticated;

-- === 20260715110000_audit_and_verification_ceiling.sql ===
CREATE TABLE IF NOT EXISTS public.job_board_verifications (
  company_token text PRIMARY KEY,
  verified_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.job_board_verifications TO anon, authenticated;
GRANT ALL ON public.job_board_verifications TO service_role;
ALTER TABLE public.job_board_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "job_board_verifications_public_read" ON public.job_board_verifications;
CREATE POLICY "job_board_verifications_public_read"
  ON public.job_board_verifications FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.get_stale_board_count()
RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT count(*)::int FROM (
    SELECT DISTINCT p.company_token
    FROM public.job_board_postings p
    LEFT JOIN public.job_board_verifications v ON v.company_token = p.company_token
    WHERE v.verified_at IS NULL OR v.verified_at < now() - interval '24 hours'
  ) stale;
$$;
GRANT EXECUTE ON FUNCTION public.get_stale_board_count() TO anon, authenticated;

DO $mig$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-board-verification-sweep') THEN
    PERFORM cron.schedule(
      'job-board-verification-sweep',
      '41 3 * * *',
      $job$
      DELETE FROM public.job_board_postings p
      WHERE EXISTS (
        SELECT 1 FROM public.job_board_verifications v
        WHERE v.company_token = p.company_token
          AND v.verified_at < now() - interval '48 hours'
      );
      $job$
    );
  END IF;
END $mig$;

DO $mig$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-board-audit') THEN
    PERFORM cron.schedule(
      'job-board-audit',
      '23 4 * * *',
      $job$
      SELECT net.http_post(
        url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/job-board',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{"action":"audit"}'::jsonb
      );
      $job$
    );
  END IF;
END $mig$;

-- === 20260715120000_matching_resume.sql ===
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS matching_scan_id uuid,
  ADD COLUMN IF NOT EXISTS matching_resume_text text,
  ADD COLUMN IF NOT EXISTS matching_resume_updated_at timestamptz;

-- === 20260715130000_ghost_stats_perf.sql ===
CREATE OR REPLACE FUNCTION public.get_ghost_job_index_stats()
RETURNS TABLE (
  total_open bigint,
  total_companies bigint,
  closed_90d bigint,
  median_days_open numeric,
  median_days_to_close numeric
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  SELECT
    (SELECT count(*) FROM public.job_board_postings),
    (SELECT count(DISTINCT company_token) FROM public.job_board_postings),
    (SELECT count(*) FROM public.job_board_closures
      WHERE closed_at > now() - interval '90 days' AND NOT superseded),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (
       ORDER BY GREATEST(EXTRACT(EPOCH FROM (now() - first_seen)) / 86400.0, 0)))::numeric, 1)
     FROM public.job_board_postings TABLESAMPLE SYSTEM (5)),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (
       ORDER BY EXTRACT(EPOCH FROM (closed_at - COALESCE(posted_at, first_seen))) / 86400.0))::numeric, 1)
     FROM public.job_board_closures
     WHERE closed_at > now() - interval '90 days'
       AND NOT superseded
       AND COALESCE(posted_at, first_seen) IS NOT NULL
       AND closed_at >= COALESCE(posted_at, first_seen));
$$;
GRANT EXECUTE ON FUNCTION public.get_ghost_job_index_stats() TO anon, authenticated;