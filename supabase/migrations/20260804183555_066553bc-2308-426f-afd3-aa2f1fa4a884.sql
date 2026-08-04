CREATE OR REPLACE FUNCTION public.agent_prepare_now()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_key boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'apply_agent_maintenance_key'
  ) INTO v_has_key;

  IF NOT v_has_key THEN
    RETURN false;
  END IF;

  PERFORM net.http_post(
    url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/apply-agent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-maintenance-key',
        (SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'apply_agent_maintenance_key' LIMIT 1)
    ),
    body := jsonb_build_object('source', 'purchase')
  );
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.agent_prepare_now() IS
  'Kick apply-agent immediately instead of waiting for the :23 cron. Called by stripe-webhook when an agent subscription activates. Returns false (not an error) when the vault key is absent, so the hourly cron remains the floor. The maintenance key never leaves the database.';

REVOKE ALL ON FUNCTION public.agent_prepare_now() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_prepare_now() TO service_role;