-- Freshness robustness: the board's freshness is maintained by the refresh cron
-- firing. A SINGLE cron job is a single point of failure — if it's paused,
-- deleted, or a fire is dropped, the cold tail stops being re-verified until a
-- board read triggers the stale-while-revalidate fallback. Add a SECOND, offset
-- trigger so the pipeline keeps moving even if one cron misses a beat.
--
-- Stampede-safe by construction: runRefresh takes a slice lock in job_board_meta
-- (refresh_progress + SLICE_LOCK_MS), and only force=true bypasses it — which this
-- does NOT use. A redundant kick therefore no-ops whenever a slice or chain is
-- already running; it only "fills in" when the pipeline is genuinely idle. The
-- two crons (minutes 4,14,… and 9,19,…) give ~5-minute redundant coverage.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-board-refresh-backup') THEN
    PERFORM cron.schedule(
      'job-board-refresh-backup',
      '9-59/10 * * * *',
      $job$
      SELECT net.http_post(
        url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/job-board',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{"action":"refresh"}'::jsonb
      );
      $job$
    );
  END IF;
END $$;
