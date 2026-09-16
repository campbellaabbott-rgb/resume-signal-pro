-- AN OAUTH TOKEN NAMES THE SERVER IT WAS MINTED FOR.
--
-- Supabase's authorization endpoint takes no resource parameter (clients
-- send one; it is ignored), so an access token minted for an OAuth client
-- would carry the same audience as every website session. The MCP server
-- refuses any token whose audience is not its own URL, which makes this hook
-- the ONLY place that binding can be made: for a token minted to an OAuth
-- client (the claims carry a client_id — a website session never does) the
-- audience becomes the server's URL; for every other sign-in the event is
-- returned untouched.
--
-- Nothing here can take out website sign-in: a session without a client_id
-- is returned as received, and any failure inside the body returns the
-- event as received. The hook reads no table.
--
-- This migration does NOT enable the hook. The owner flips
-- Authentication > Hooks > Custom Access Token to this function in the
-- dashboard, after the migration is probed, and verifies a website sign-in
-- immediately afterwards — the hook then runs on every sign-in.
--
-- Executable only by the auth server's role. Revoked from PUBLIC, anon and
-- authenticated BY NAME: revoking from PUBLIC alone leaves anon's own grant
-- in place in this database (see revoking-from-public-does-not-revoke-from-anon).
--
-- The server URL below is one of three spellings (this file, the server
-- module's constant, the page's env-built string), pinned equal by a guard.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims jsonb;
BEGIN
  IF coalesce(event->'claims'->>'client_id', '') = '' THEN
    RETURN event;
  END IF;
  v_claims := jsonb_set(
    coalesce(event->'claims', '{}'::jsonb),
    '{aud}',
    to_jsonb('https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/agent-mcp'::text),
    true
  );
  RETURN jsonb_set(event, '{claims}', v_claims, true);
EXCEPTION WHEN OTHERS THEN
  RETURN event;
END;
$$;

REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
