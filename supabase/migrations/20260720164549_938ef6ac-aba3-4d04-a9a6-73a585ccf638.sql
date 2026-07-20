CREATE OR REPLACE FUNCTION public.get_freshness_stats()
RETURNS TABLE (boards integer, p50_min numeric, p95_min numeric, max_min numeric)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  SELECT
    count(*)::int AS boards,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY age_min))::numeric, 1) AS p50_min,
    round((percentile_cont(0.95) WITHIN GROUP (ORDER BY age_min))::numeric, 1) AS p95_min,
    round((max(age_min))::numeric, 1) AS max_min
  FROM (
    SELECT EXTRACT(EPOCH FROM (now() - v.verified_at)) / 60.0 AS age_min
    FROM public.job_board_verifications v
    WHERE EXISTS (
      SELECT 1 FROM public.job_board_postings p
      WHERE p.company_token = v.company_token
    )
  ) live;
$$;
GRANT EXECUTE ON FUNCTION public.get_freshness_stats() TO anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-board-verif-orphan-cleanup') THEN
    PERFORM cron.schedule(
      'job-board-verif-orphan-cleanup',
      '51 3 * * *',
      $job$
      DELETE FROM public.job_board_verifications v
      WHERE NOT EXISTS (
        SELECT 1 FROM public.job_board_postings p WHERE p.company_token = v.company_token
      );
      $job$
    );
  END IF;
END $$;