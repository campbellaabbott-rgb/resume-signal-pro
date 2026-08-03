-- agent-runner was callable by anyone, and its cron sent no credential.
--
-- A POST with an empty body scanned the board, ran the fit scorer over every
-- candidate posting for every subscriber, and wrote queue rows. Hundreds of
-- reads and a scoring pass per request, on demand, from anywhere, free. It
-- leaks nothing — the response is counts — so this is a cost and abuse hole
-- rather than a data one. That still means anyone could schedule an outage for
-- us at no cost to themselves.
--
-- The function now requires x-maintenance-key, the same gate apply-agent has
-- had since 20260731020000. This migration is the other half: without it the
-- nightly cron would post exactly as before, collect a 403, and the agent would
-- quietly stop producing morning queues. A gate deployed without its caller is
-- not a fix, it is an outage with good intentions.
--
-- BOTH HALVES MUST LAND TOGETHER. If the function deploys and this does not,
-- the 06:10 UTC run is refused until it does.
--
-- The WHERE EXISTS guard is copied from apply-agent's schedule, for its reason:
-- with no key in the vault this fires NOTHING, rather than posting nightly and
-- collecting a 403 every time. A cron job that fails every night is
-- indistinguishable from one that works, right up until somebody reads the logs
-- of a job they believe is fine. 20260802190000 self-arms that key, so the
-- normal state is that it exists.
--
-- body {"source":"cron"} matches what apply-agent sends, so a hand invocation
-- and a scheduled one stay distinguishable in the record.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agent-runner-nightly') THEN
      PERFORM cron.unschedule('agent-runner-nightly');
    END IF;

    PERFORM cron.schedule(
      'agent-runner-nightly',
      '10 6 * * *',
      $job$
      SELECT net.http_post(
        url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/agent-runner',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-maintenance-key',
            (SELECT decrypted_secret FROM vault.decrypted_secrets
              WHERE name = 'apply_agent_maintenance_key' LIMIT 1)
        ),
        body := '{"source":"cron"}'::jsonb
      )
      WHERE EXISTS (
        SELECT 1 FROM vault.decrypted_secrets
         WHERE name = 'apply_agent_maintenance_key'
      );
      $job$
    );

  END IF;
END $$;
