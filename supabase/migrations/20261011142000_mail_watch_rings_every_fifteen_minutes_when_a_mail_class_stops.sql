-- MAIL-WATCH RINGS EVERY FIFTEEN MINUTES WHEN A MAIL CLASS STOPS.
--
-- WHAT WAS WRONG (critical-path plan 2026-10-12, CP-013, CP-052). Nothing
-- alarmed when mail stopped leaving: the heartbeat's mail check was
-- report-only, bounces and complaints were never read, a delivered order whose
-- mail never left read as delivered, and a cron whose function answered 500
-- on every run kept every light green. The new function mail-watch checks
-- those (its header lists the rules) and mails the owner; this schedules it.
--
-- THE CALL. Every 15 minutes, a POST to mail-watch carrying x-email-cron, the
-- vault's email_cron_key (20261004100000; mail-watch accepts it through
-- email_cron_key_matches, the check the batch mailers use), and, when the
-- vault holds it, the service-role bearer process-email-queue's drain uses
-- (email_queue_service_role_key, outside migrations), so the platform's JWT
-- check passes too. No secret is written into the job: both are read from the
-- vault at run time. With no email_cron_key in the vault the job posts
-- nothing (the WHERE below).
--
-- Re-running replaces the job by name. On a database without pg_cron (the
-- test databases) nothing is scheduled and the self-check says so.

SET LOCAL statement_timeout = '2min';

DO $schedule$
DECLARE
  v_cmd text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'mail-watch: pg_cron is not installed here; nothing scheduled';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mail-watch') THEN
    PERFORM cron.unschedule('mail-watch');
  END IF;
  v_cmd := $cmd$
SELECT net.http_post(
  url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/mail-watch',
  headers := jsonb_strip_nulls(jsonb_build_object(
    'Content-Type', 'application/json',
    'x-email-cron', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'email_cron_key' LIMIT 1),
    'Authorization', (SELECT 'Bearer ' || s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'email_queue_service_role_key' LIMIT 1)
  )),
  body := '{"source":"cron"}'::jsonb,
  timeout_milliseconds := 60000
)
WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name = 'email_cron_key');
$cmd$;
  PERFORM cron.schedule('mail-watch', '*/15 * * * *', v_cmd);
  RAISE NOTICE 'mail-watch: scheduled every 15 minutes';
END
$schedule$;

-- Self-verifying: where pg_cron exists, exactly one active mail-watch job,
-- posting to the function with the cron key read from the vault and no key or
-- token written into its command.
DO $verify$
DECLARE
  v_n integer;
  v_cmd text;
  v_active boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'self-verify 20261011142000: no pg_cron here; nothing to check';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'mail-watch';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'mail-watch self-check: expected one mail-watch job, found %', v_n;
  END IF;
  SELECT j.command, j.active INTO v_cmd, v_active FROM cron.job j WHERE j.jobname = 'mail-watch';
  IF NOT v_active THEN
    RAISE EXCEPTION 'mail-watch self-check: the job is inactive';
  END IF;
  IF position('/functions/v1/mail-watch' in v_cmd) = 0 OR position('x-email-cron' in v_cmd) = 0
     OR position('vault.decrypted_secrets' in v_cmd) = 0 THEN
    RAISE EXCEPTION 'mail-watch self-check: the job does not post to mail-watch with the vault''s cron key';
  END IF;
  IF v_cmd ~ 'eyJ[A-Za-z0-9_-]{10,}' OR v_cmd ~ 'sk_(live|test)_' OR v_cmd ~ 're_[A-Za-z0-9]{16,}' THEN
    RAISE EXCEPTION 'mail-watch self-check: a key or token is written into the job';
  END IF;
  RAISE NOTICE 'self-verify 20261011142000: mail-watch posts every 15 minutes with the vault''s cron key';
END
$verify$;
