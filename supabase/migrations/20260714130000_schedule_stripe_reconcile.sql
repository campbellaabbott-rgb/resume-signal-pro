-- Schedule the daily Stripe reconciliation sweep (robustness #5).
--
-- A dropped webhook leaves a customer who PAID with no delivery, invisibly. The
-- reconcile-stripe function lists recent PAID Stripe sessions and flags any with
-- no used_stripe_sessions marker (the fulfilment idempotency key the webhook and
-- the success-page path both write), emailing the owner to recover them.
--
-- Mirrors the send-search-digest / job-board-refresh crons: idempotent, a no-op
-- where pg_cron is absent, offset from the other jobs so they never stampede. No
-- auth header needed — reconcile-stripe is verify_jwt=false (see config.toml),
-- returns counts only (no PII), and emails only the fixed owner address, so a
-- stray trigger on a healthy system does nothing observable.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-stripe') THEN
    PERFORM cron.schedule(
      'reconcile-stripe',
      '17 15 * * *',
      $job$
      SELECT net.http_post(
        url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/reconcile-stripe',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{"lookbackHours": 48}'::jsonb
      );
      $job$
    );
  END IF;
END $$;
