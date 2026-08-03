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