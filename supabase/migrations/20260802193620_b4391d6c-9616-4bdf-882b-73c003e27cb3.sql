-- Let the apply-agent cron arm itself, so no human ever handles the secret.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'apply_agent_maintenance_key') THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'apply_agent_maintenance_key'
    );
    RAISE NOTICE 'generated apply_agent_maintenance_key — the hourly cron is now armed';
  ELSE
    RAISE NOTICE 'apply_agent_maintenance_key already present — left untouched';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.agent_maintenance_key_matches(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'apply_agent_maintenance_key'
      AND decrypted_secret = p_key
      AND length(coalesce(p_key, '')) >= 32
  );
$$;

REVOKE ALL ON FUNCTION public.agent_maintenance_key_matches(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_maintenance_key_matches(text) TO service_role;

COMMENT ON FUNCTION public.agent_maintenance_key_matches(text) IS
  'True when the argument equals the vault-held apply-agent maintenance key. Returns a boolean and never the secret, so it cannot be used to read the key out. service_role only; anon and authenticated are explicitly revoked.';