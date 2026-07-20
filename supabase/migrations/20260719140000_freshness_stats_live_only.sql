-- Honest freshness measurement. get_freshness_stats read the per-board
-- verification-stamp table directly — but the 48h ceiling sweep DELETES a
-- dead board's postings while leaving its stamp row behind, so orphaned
-- stamps for boards with zero live postings were dragging the published
-- P95/max (measured 2026-07-19: 128h "max" while only 7 boards with live
-- postings were even >24h stale out of ~28k). The stat should measure the
-- freshness of what's ACTUALLY on the board, so restrict to boards that
-- still have at least one posting. Return shape is unchanged — callers
-- (status endpoint, Ghost Job Index, heartbeat) keep working.
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

-- Keep the stamp table from accumulating orphans in the first place: nightly,
-- ten minutes after the 03:41 posting sweep, drop verification rows for boards
-- that no longer have any postings. Idempotent scheduling guard, same pattern
-- as the sweep itself.
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
