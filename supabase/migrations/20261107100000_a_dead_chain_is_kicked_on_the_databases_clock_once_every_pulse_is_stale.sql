-- A DEAD CHAIN IS KICKED ON THE DATABASE'S OWN CLOCK ONCE EVERY PULSE IS STALE
-- (audit-rest S13-114, the scheduled half, without the scheduler's key).
--
-- 20261103221000 was to call job-board's upkeep action at :x2 and :x7 with
-- the scheduler's key. Lovable's agent refused it on 2026-11-06 and it never
-- applies (docs/deploy-ledger.json neverApply). The upkeep watchdog's only act
-- is POST {"action":"refresh"} with no key: the body the job-board-refresh
-- (:x4) and job-board-refresh-backup (:x9) crons already send
-- (20260909219000). So this job sends that same body itself, decided here in
-- SQL: only when job-board's three pulse rows (refresh_progress, slice_trace,
-- slice_stats) are all older than the three-minute slice lock plus twice
-- slice_stats.coldEmaMs, which is the watchdog's own threshold
-- (chain-watchdog.ts decideRekick; each slice_stats write stamps updated_at
-- with its workAt or at), and ingest is not paused. Read every minute; while
-- any pulse is fresh it posts nothing, so a live chain gets no extra request.
-- It never reads chain_kick: a hop that dies after answering leaves that row
-- 'continued', which the watchdog reads as alive.
--
-- A kick it sends is admitted: a progress row older than three minutes is
-- exactly runRefresh's non-forced gate, and admitSlice's compare-and-set
-- settles a race with the two refresh crons. A live hop still writing its
-- per-board slice_trace is never kicked, where the two crons read
-- refresh_progress alone.
--
-- MEASURED 2026-11-07. The chain died between hops at 17:47:29.7Z; status
-- read the watchdog chain_alive at pulse ages 251-360 s against a 202 s
-- threshold; the :x4 cron restarted it at 17:54:05Z, 6.6 min dark. This job
-- would have posted at 17:51:00. Four deaths in 47 minutes that afternoon,
-- each dark 4.2-6.6 min.
--
-- THE CONDITION IS WRITTEN ONCE. The job's WHERE clause and the check below
-- are the same text, so the check runs exactly what the job will run, and a
-- typo stops the apply instead of failing every minute.
--
-- APPLY ORDER: any. Every job-board build answers {"action":"refresh"}.
-- Undo: SELECT cron.unschedule('job-board-dead-chain-kick'). Safe to re-run.
-- Self-verifying: the condition must evaluate, and the job must come up
-- active, every minute.
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
    WHERE$job$ || v_when || E';\n');

  SELECT j.active, j.schedule INTO v_active, v_schedule FROM cron.job j WHERE j.jobname = 'job-board-dead-chain-kick';
  IF v_active IS NOT TRUE OR v_schedule IS DISTINCT FROM '* * * * *' THEN
    RAISE EXCEPTION 'S13-114: job-board-dead-chain-kick is not an active cron job every minute after scheduling';
  END IF;
  RAISE NOTICE 'job-board-dead-chain-kick runs every minute; it would post now: %', coalesce(v_due::text, 'unknown (no job_board_meta here)');
END $$;
