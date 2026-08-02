-- Let the apply-agent cron arm itself, so no human ever handles the secret.
--
-- THE PROBLEM THIS ENDS. apply-agent is HTTP-gated on a shared secret held in
-- the edge function's MAINTENANCE_KEY env var. The hourly cron can only call it
-- if the SAME value also sits in the vault under 'apply_agent_maintenance_key'.
-- Nothing put it there, so — confirmed live on 2026-08-02 — the job has been
-- firing nothing since it was scheduled on 31 July. Exactly as designed, and
-- completely invisible.
--
-- Arming it by hand means a person copying a production credential out of one
-- dashboard and pasting it into a SQL editor. That is a step that gets skipped,
-- gets done wrong, or leaves the secret in a clipboard and a query history. It
-- is also the step that has now silently not happened for two days.
--
-- So: the database generates its own key and apply-agent verifies against it.
-- The secret is created here, read by the cron from the vault, and checked by
-- the function through agent_maintenance_key_matches below. It never appears in
-- a dashboard, a shell, a log or a person's clipboard.
--
-- THIS DOES NOT WEAKEN THE GATE. Before, you needed the Lovable env secret to
-- call apply-agent. Now you need that OR the vault value — and reading the vault
-- already requires service_role, which is full database access. Anyone who could
-- obtain the new key could already do strictly more than call this function.
-- The env var keeps working unchanged, so nothing that works today stops.

-- 1. THE KEY ITSELF. Generated only when absent, so re-running is safe and an
--    existing manually-set key is left exactly as it is.
--
--    Two UUIDs rather than gen_random_bytes(): pgcrypto may or may not be
--    installed, gen_random_uuid() is core since PG13, and 244 bits of v4
--    randomness across 64 hex characters is far past what this needs.
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

-- 2. THE CHECK. Returns a BOOLEAN, never the secret.
--
--    This is the whole reason apply-agent can be taught to accept the vault key
--    without anything being able to read it back out. A function that returned
--    the secret would be a credential-exfiltration primitive sitting in the
--    public schema; one that only answers "does this match" is not.
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
      AND length(coalesce(p_key, '')) >= 32   -- never let '' or a stub match
  );
$$;

-- REVOKE FIRST, ALWAYS. Postgres grants EXECUTE to PUBLIC by default, and that
-- default is exactly what put 107 definer functions in reach of anon on this
-- project once already. A GRANT does not restrict; only a REVOKE does.
REVOKE ALL ON FUNCTION public.agent_maintenance_key_matches(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_maintenance_key_matches(text) TO service_role;

COMMENT ON FUNCTION public.agent_maintenance_key_matches(text) IS
  'True when the argument equals the vault-held apply-agent maintenance key. Returns a boolean and never the secret, so it cannot be used to read the key out. service_role only; anon and authenticated are explicitly revoked.';

-- CONFIRM AFTERWARDS — anon must be refused, not answered:
--   curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/agent_maintenance_key_matches" \
--     -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--     -H 'Content-Type: application/json' -d '{"p_key":"guess"}'
--   expected: 401 {"code":"42501", ... "permission denied for function ..."}
--
-- And the cron should stamp within the hour:
--   curl -s -X POST .../functions/v1/job-board -d '{"action":"status"}' | jq .applyAgent
--   expected after the next :23 -> scheduleProven: true
