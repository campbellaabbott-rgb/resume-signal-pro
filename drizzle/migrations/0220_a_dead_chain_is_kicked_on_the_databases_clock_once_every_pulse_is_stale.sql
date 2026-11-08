-- lovable-cron-fallback-reviewed: every-minute dead-chain watchdog required by audit-rest S13-114; the WHERE clause makes it a no-op while the chain is alive, and sub-minute timing cannot be derived or event-driven since the failure it catches is silence itself.
-- A DEAD CHAIN IS KICKED ON THE DATABASE'S OWN CLOCK ONCE EVERY PULSE IS STALE
-- (audit-rest S13-114, the scheduled half, without the scheduler's key).
DO $$
DECLARE
  v_when constant text := $when$
      EXISTS (
        SELECT 1 FROM public.job_board_meta a
         WHERE a.k IN ('refresh_progress', 'slice_trace', 'slice_stats'))
  AND NOT EXISTS (
        SELECT 1 FROM public.job_board_meta m
         WHERE m.k IN ('refresh_progress', 'slice_trace', 'slice_stats')
           AND m.updated_at >= now() - interval '3 minutes'
               - interval '1 millisecond' * 2 * coalesce((
                   SELECT CASE WHEN jsonb_typeof(s.v -> 'coldEmaMs') = 'number'
                               THEN greatest((s.v ->> 'coldEmaMs')::float8, 0) END
                     FROM public.job_board_meta s WHERE s.k = 'slice_stats'), 0))
  AND NOT EXISTS (
        SELECT 1 FROM public.job_board_meta p
         WHERE p.k = 'ingest_paused' AND p.v -> 'paused' = 'true'::jsonb)$when$;
  v_due boolean;
  v_active boolean;
  v_schedule text;
  v_command text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; job-board-dead-chain-kick not scheduled';
    RETURN;
  END IF;

  -- The condition, run once as the job will run it.
  IF to_regclass('public.job_board_meta') IS NOT NULL THEN
    EXECUTE 'SELECT ' || v_when INTO v_due;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = 'job-board-dead-chain-kick') THEN
    PERFORM cron.unschedule('job-board-dead-chain-kick');
  END IF;

  PERFORM cron.schedule('job-board-dead-chain-kick', '* * * * *', $job$
    SELECT net.http_post(
      url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/job-board',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{"action":"refresh"}'::jsonb
    )
    WHERE$job$ || v_when || ';');

  SELECT j.active, j.schedule, j.command INTO v_active, v_schedule, v_command FROM cron.job j WHERE j.jobname = 'job-board-dead-chain-kick';
  IF v_active IS NOT TRUE OR v_schedule IS DISTINCT FROM '* * * * *' THEN
    RAISE EXCEPTION 'S13-114: job-board-dead-chain-kick is not an active cron job every minute after scheduling';
  END IF;

  -- The command as stored, planned and not run.
  IF to_regclass('public.job_board_meta') IS NOT NULL THEN
    EXECUTE 'EXPLAIN ' || v_command;
  END IF;
  RAISE NOTICE 'job-board-dead-chain-kick runs every minute; it would post now: %', coalesce(v_due::text, 'unknown (no job_board_meta here)');
END $$;