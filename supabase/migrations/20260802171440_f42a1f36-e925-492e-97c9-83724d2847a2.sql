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
      body := '{"source":"cron"}'::jsonb
    )
    WHERE EXISTS (
      SELECT 1 FROM vault.decrypted_secrets WHERE name = 'apply_agent_maintenance_key'
    );
    $job$
  );

  RAISE NOTICE 'apply-agent-hourly rescheduled with source=cron';
END $$;