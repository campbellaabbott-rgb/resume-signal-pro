-- THE ERROR SPIKE CHECK RUNS ON A SCHEDULE AND MAILS ONLY A SPIKE (wave 2
-- email-ops, register L10-20).
--
-- check-error-spikes had no trigger anywhere: no cron job, no page, no script
-- called it, and the admin-key check meant a header-less cron could not have
-- either. Yet 20261004110000's notes say the browser's error rows "are mailed
-- to the owner by check-error-spikes". The register's two ways out were to
-- schedule it with a key and a cooldown, or to delete it; this file is the
-- first.
--
-- check-error-spikes .2026-10-08.1 answers the alerts cron key (x-alerts-cron,
-- the vault key 20261004110000 generated for check-alerts and checks with
-- alerts_cron_key_matches) and mails the owner only when a visitor's errors
-- spike past their own baseline, at most once in six hours. The job runs every
-- 15 minutes, the window detect_user_error_spikes reads, so no quarter hour
-- goes unread; it fires nothing where the vault holds no key.
--
-- APPLY ORDER: after check-error-spikes .2026-10-08.1 serves (the build before
-- it refuses the cron's header with a 401, and would mail on any error if it
-- did not). Safe to re-run: the job is unscheduled by name and scheduled again.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; check-error-spikes was not scheduled';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-error-spikes') THEN
    PERFORM cron.unschedule('check-error-spikes');
  END IF;
  PERFORM cron.schedule('check-error-spikes', '7-59/15 * * * *', $job$
    SELECT net.http_post(
      url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/check-error-spikes',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alerts-cron', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'alerts_cron_key' LIMIT 1)
      ),
      body := '{}'::jsonb
    )
    WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'alerts_cron_key');
  $job$);
END $$;

DO $$
DECLARE
  v_cmd text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  SELECT j.command INTO v_cmd FROM cron.job j WHERE j.jobname = 'check-error-spikes' AND j.schedule = '7-59/15 * * * *';
  IF v_cmd IS NULL THEN
    RAISE EXCEPTION 'self-check: the check-error-spikes cron job does not exist on its 15-minute schedule';
  END IF;
  IF position('x-alerts-cron' IN v_cmd) = 0 OR position('alerts_cron_key' IN v_cmd) = 0
     OR position('/functions/v1/check-error-spikes''' IN v_cmd) = 0 THEN
    RAISE EXCEPTION 'self-check: the check-error-spikes cron does not post to its function with the alerts cron key: %', v_cmd;
  END IF;
END $$;
