-- Run the apply agent hourly.
--
-- SAFE TO SCHEDULE RIGHT NOW, and it is worth being explicit about why, because
-- "schedule the thing that sends job applications on people's behalf" deserves
-- more than a shrug. Three independent gates stand between this cron firing and
-- anything reaching an employer:
--
--   1. ENTITLEMENT. apply-agent looks up agent_subscribers per mandate and skips
--      the mandate outright when there is no row. Nobody has purchased, so every
--      mandate is skipped today.
--   2. SENDER LIVENESS. decideRelease refuses with `sender-offline` unless a
--      worker has checked in within 15 minutes. No worker is hosted yet, so
--      nothing would be released even for a paying subscriber.
--   3. MODE. Only mandates explicitly set to auto are worked unattended; review
--      mode prepares and waits for the person.
--
-- So this schedules the plumbing while the taps are still closed, which is the
-- right order — the alternative is discovering the cron does not work on the day
-- someone first pays for it.
--
-- CADENCE: hourly at :23. Not on the hour, to stay clear of the other jobs, and
-- hourly rather than every few minutes because the queue it drains is built
-- overnight and applications are not urgent to the minute. A person applying at
-- 3pm rather than 2:07pm loses nothing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE WARNING 'pg_cron not installed — apply-agent was NOT scheduled';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apply-agent-hourly') THEN
    PERFORM cron.unschedule('apply-agent-hourly');
  END IF;

  PERFORM cron.schedule(
    'apply-agent-hourly',
    '23 * * * *',
    $job$
    -- The WHERE clause is the point: with no key in the vault this fires
    -- NOTHING, rather than posting hourly and collecting a 403 every time.
    -- A cron job that fails 24 times a day is indistinguishable from one that
    -- is working until someone reads the logs, and nobody reads the logs of a
    -- job they believe is fine.
    SELECT net.http_post(
      url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/apply-agent',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-maintenance-key',
          (SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'apply_agent_maintenance_key' LIMIT 1)
      ),
      body := '{}'::jsonb
    )
    WHERE EXISTS (
      SELECT 1 FROM vault.decrypted_secrets WHERE name = 'apply_agent_maintenance_key'
    );
    $job$
  );

  RAISE NOTICE 'apply-agent scheduled hourly at :23';
END $$;

-- ---------------------------------------------------------------------------
-- TO ARM IT, run this once with the SAME value as the MAINTENANCE_KEY secret
-- set on the apply-agent edge function. They must match or the function
-- answers 403:
--
--   SELECT vault.create_secret('<the-maintenance-key>', 'apply_agent_maintenance_key');
--
-- To confirm the job exists and when it last ran:
--
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'apply-agent-hourly';
--   SELECT status, return_message, start_time FROM cron.job_run_details
--     WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'apply-agent-hourly')
--     ORDER BY start_time DESC LIMIT 5;
--
-- To stop it:
--
--   SELECT cron.unschedule('apply-agent-hourly');
-- ---------------------------------------------------------------------------
