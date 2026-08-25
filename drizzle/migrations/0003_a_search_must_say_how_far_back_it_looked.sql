CREATE OR REPLACE FUNCTION public.board_recency_ladder(
  p_step       integer DEFAULT 5000,
  p_fresh_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH win AS (
    SELECT p.effective_posted AS ep,
           row_number() OVER (ORDER BY p.effective_posted DESC, p.id ASC) AS rn
    FROM public.job_board_postings p
    WHERE p.effective_posted >= now() - make_interval(days => GREATEST(p_fresh_days, 1))
  ),
  pts AS (
    SELECT rn, ep FROM win WHERE rn % GREATEST(p_step, 500) = 0
  )
  SELECT jsonb_build_object(
    'at',        now(),
    'freshDays', GREATEST(p_fresh_days, 1),
    'step',      GREATEST(p_step, 500),
    'depth',     COALESCE((SELECT max(rn) FROM pts), 0),
    'points',    COALESCE((SELECT jsonb_agg(jsonb_build_array(rn, ep) ORDER BY rn) FROM pts), '[]'::jsonb)
  );
$fn$;

REVOKE ALL ON FUNCTION public.board_recency_ladder(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.board_recency_ladder(integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.board_recency_ladder(integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_recency_ladder()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v jsonb;
BEGIN
  PERFORM set_config('statement_timeout', '30000', true);
  v := public.board_recency_ladder(5000, 30);
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('recency_ladder', v, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
  RETURN v;
END;
$fn$;

REVOKE ALL ON FUNCTION public.refresh_recency_ladder() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_recency_ladder() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_recency_ladder() TO service_role;

SELECT public.refresh_recency_ladder();

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'board-recency-ladder') THEN
    PERFORM cron.schedule(
      'board-recency-ladder',
      '2-59/5 * * * *',
      $job$ SELECT public.refresh_recency_ladder(); $job$
    );
  END IF;
END $do$;

ALTER FUNCTION public.count_jobs_capped(
  timestamptz, text, text, boolean, text, text, text[], numeric,
  text[], timestamptz, integer, text, integer, text[]
) SET statement_timeout = '1400ms';