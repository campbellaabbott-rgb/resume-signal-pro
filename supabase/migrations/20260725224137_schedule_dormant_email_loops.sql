-- Wire the four built-but-never-scheduled loops (2026-07-25 parked-work
-- audit). Every one of these functions shipped complete — with throttles,
-- opt-outs, and entitlement checks — and then nothing ever triggered it:
--
--   send-agent-digest    agent-runner fills agent_queue nightly (06:10 UTC)
--                        and the morning email never went out. Self-throttled
--                        to one send per ~20h per user, opt-in
--                        (email_opt_in), entitlement re-checked at send,
--                        never emails an empty shortlist. 06:40, right after
--                        the runner.
--   send-market-pulse    subscribers accumulated since 2026-07-02; the pulse
--                        never sent once. Per-subscriber 28-day throttle,
--                        HMAC unsubscribe, 200/batch. Daily trigger = the
--                        batch drains and each subscriber still hears from us
--                        at most monthly.
--   retry-failed-deliveries  paid-product delivery recovery. RPC-fed
--                        (get_failed_deliveries_for_retry caps retries),
--                        5 per run. Every 4 hours: a dropped delivery is a
--                        paying customer waiting. Complements the daily
--                        reconcile-stripe alert (which detects; this heals).
--   check-alerts         owner-only funnel alerts (delivery/AI/email/webhook/
--                        parse rates) to ADMIN_EMAIL. Every 6 hours.
--
-- House pattern (mirrors schedule_search_digest): idempotent, a no-op where
-- pg_cron is absent, minute offsets that collide with none of the existing
-- jobs. No auth headers — all four functions are verify_jwt=false and their
-- send paths are opt-in + self-throttled, so a stray trigger cannot spam.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-agent-digest') THEN
      PERFORM cron.schedule(
        'send-agent-digest',
        '40 6 * * *',
        $job$
        SELECT net.http_post(
          url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/send-agent-digest',
          headers := '{"Content-Type": "application/json"}'::jsonb,
          body := '{"action":"send"}'::jsonb
        );
        $job$
      );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-market-pulse') THEN
      PERFORM cron.schedule(
        'send-market-pulse',
        '47 15 * * *',
        $job$
        SELECT net.http_post(
          url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/send-market-pulse',
          headers := '{"Content-Type": "application/json"}'::jsonb,
          body := '{"action":"send"}'::jsonb
        );
        $job$
      );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retry-failed-deliveries') THEN
      PERFORM cron.schedule(
        'retry-failed-deliveries',
        '33 */4 * * *',
        $job$
        SELECT net.http_post(
          url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/retry-failed-deliveries',
          headers := '{"Content-Type": "application/json"}'::jsonb,
          body := '{}'::jsonb
        );
        $job$
      );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-alerts') THEN
      PERFORM cron.schedule(
        'check-alerts',
        '18 */6 * * *',
        $job$
        SELECT net.http_post(
          url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/check-alerts',
          headers := '{"Content-Type": "application/json"}'::jsonb,
          body := '{}'::jsonb
        );
        $job$
      );
    END IF;
  END IF;
END $$;
