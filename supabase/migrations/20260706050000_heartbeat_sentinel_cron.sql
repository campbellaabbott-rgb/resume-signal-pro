-- Synthetic monitoring: schedule scan-heartbeat every 10 minutes.
--
-- scan-heartbeat is the single alerting sentinel: DB, AI gateway, cache,
-- metrics, and (new) an END-TO-END scan through the deployed
-- free-keyword-scan function — the check that turns "outage until someone
-- happens to scan" into "outage for at most ~10 minutes plus an email".
-- Failures email ADMIN_EMAIL via Resend, deduped to 2/hour globally.
-- scheduled-health-probe stays deployed as a manual diagnostic; scheduling
-- both would double the AI probe cost for no added coverage.
--
-- Guarded like the purge job: idempotent, no-ops where pg_cron is absent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scan-heartbeat-sentinel') THEN
    PERFORM cron.schedule(
      'scan-heartbeat-sentinel',
      '*/10 * * * *',
      $job$
      SELECT net.http_post(
        url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/scan-heartbeat',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{}'::jsonb
      );
      $job$
    );
  END IF;
END $$;
