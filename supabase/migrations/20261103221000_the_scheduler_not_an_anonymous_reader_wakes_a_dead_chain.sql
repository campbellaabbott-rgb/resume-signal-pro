-- THE SCHEDULER, NOT AN ANONYMOUS READER, WAKES A DEAD CHAIN AND STORES THE
-- DATE COVERAGE (audit-rest S13-114).
--
-- job-board's status action answered anyone, uncounted, and on the way wrote
-- date_coverage_cache on every computed answer and could stamp and kick the
-- refresh chain. A fresh isolate has no memo, so any caller could drive writes
-- and about forty reads at will.
--
-- job-board .101 makes an anonymous status a counted reader that only reports.
-- The two jobs it did on the side moved to a new action, upkeep, which answers
-- only the scheduler's key or the service role. This file is the schedule.
--
-- WHY THIS CANNOT JUST BE DROPPED: the watchdog is really used. Its driver was
-- scan-heartbeat's status read every ten minutes with the publishable key, and
-- a cron kick landing inside the three-minute slice lock is skipped, so the
-- watchdog is what restarts a dead chain between the two refresh crons.
--
-- :x2 and :x7 sit between the refresh crons at :x4 and :x9, and job-board
-- decides each time whether anything needs doing. status.boardUpkeep says when
-- it last ran, and cron_disarmed_jobs sees this job if the vault key goes.
--
-- APPLY ORDER: any, and before job-board .101 leaves no gap. job-board .100
-- answers this job's call 400 and writes nothing, while its own status still
-- runs the watchdog; .101 without this file has no watchdog at all until it
-- arrives. Safe to re-run.
DO $$
DECLARE
  v_active boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; job-board-upkeep not scheduled';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = 'job-board-upkeep') THEN
    PERFORM cron.unschedule('job-board-upkeep');
  END IF;

  PERFORM cron.schedule('job-board-upkeep', '2-59/5 * * * *', $job$
    SELECT net.http_post(
      url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/job-board',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-email-cron', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_cron_key' LIMIT 1)
      ),
      body := '{"action":"upkeep"}'::jsonb
    )
    WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'email_cron_key');
  $job$);

  SELECT j.active INTO v_active FROM cron.job j WHERE j.jobname = 'job-board-upkeep';
  IF v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'S13-114: job-board-upkeep is not an active cron job after scheduling';
  END IF;
END $$;
