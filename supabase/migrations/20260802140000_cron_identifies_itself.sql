-- Make the hourly apply-agent cron say that it is the cron.
--
-- Reschedules 'apply-agent-hourly' with body {"source":"cron"} instead of {}.
-- Everything else — the schedule, the vault gate, the header — is unchanged.
--
-- WHY. apply-agent now stamps every run into job_board_meta, and job-board's
-- anon-readable `status` action reports it. That makes "has the apply agent
-- ever run?" answerable without a service key or a dashboard. But the useful
-- question is narrower: has the SCHEDULE ever run it? A hand invocation proves
-- the function works and proves nothing at all about the cron, and until now
-- the two were indistinguishable in the record.
--
-- They have to be distinguishable because the cron is gated on a vault secret:
--
--   WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets
--                  WHERE name = 'apply_agent_maintenance_key')
--
-- With no key that fires NOTHING. That was the right call — a cron collecting a
-- 403 twenty-four times a day looks fine until somebody reads the logs — but it
-- means a missing key and a working key produce identical evidence from
-- outside: no packets, no errors, no trace. `status.applyAgent.lastCronAt` is
-- the difference, and it can only ever be written by this job.
--
-- SAFE: changes what the job POSTS, not whether it may. All three release gates
-- (entitlement, sender liveness, auto mode) are untouched.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE WARNING 'pg_cron not installed — apply-agent was NOT rescheduled';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apply-agent-hourly') THEN
    PERFORM cron.unschedule('apply-agent-hourly');
  END IF;

  PERFORM cron.schedule(
    'apply-agent-hourly',
    '23 * * * *',
    $job$
    SELECT net.http_post(
      url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/apply-agent',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-maintenance-key',
          (SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'apply_agent_maintenance_key' LIMIT 1)
      ),
      -- The only change. This is what lets status.applyAgent.lastCronAt exist.
      body := '{"source":"cron"}'::jsonb
    )
    WHERE EXISTS (
      SELECT 1 FROM vault.decrypted_secrets WHERE name = 'apply_agent_maintenance_key'
    );
    $job$
  );

  RAISE NOTICE 'apply-agent-hourly rescheduled with source=cron';
END $$;

-- AFTER THIS DEPLOYS, the check needs no database access at all:
--
--   curl -s -X POST https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/job-board \
--     -H 'Content-Type: application/json' -d '{"action":"status"}' | jq .applyAgent
--
--   null                        -> the stamping build has not shipped yet
--   lastCronAt null, an hour on -> NO VAULT KEY. The job fires nothing.
--   scheduleProven: true        -> key present, schedule firing, agent running
--
-- To arm it (run once, same value as the apply-agent function's MAINTENANCE_KEY):
--   SELECT vault.create_secret('<the-maintenance-key>', 'apply_agent_maintenance_key');
