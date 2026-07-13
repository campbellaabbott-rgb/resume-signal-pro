-- Schedule the weekly saved-search digest.
--
-- The send-search-digest edge function and its opt-in UI (SavedSearchesCard)
-- both shipped, but nothing ever triggered the function — so every user who
-- toggled "email me new matches" received exactly nothing. This wires it to a
-- daily cron. The function self-throttles to at most one send per search every
-- 6 days (MIN_DAYS_BETWEEN_SENDS), so "daily" means each user gets a weekly-ish
-- digest and a skipped day simply catches up on the next run.
--
-- Mirrors the job-board-refresh cron exactly: idempotent, a no-op where pg_cron
-- is absent, and offset from the other jobs so they never stampede. No auth
-- header needed — send-search-digest is verify_jwt=false (see config.toml), and
-- {action:send} is opt-in-only and self-throttled, so a stray trigger can't spam.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-search-digest') THEN
    PERFORM cron.schedule(
      'send-search-digest',
      '23 14 * * *',
      $job$
      SELECT net.http_post(
        url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/send-search-digest',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{"action":"send"}'::jsonb
      );
      $job$
    );
  END IF;
END $$;
