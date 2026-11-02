-- A CONNECTOR TOKEN IS NOT A WEBSITE SESSION (S9-001, 2026-11-03).
--
-- WHAT WAS WRONG. Once the owner enables Supabase's OAuth server (plan D8,
-- D12), a person who approves the consent page in Claude or ChatGPT gets an
-- access token whose only differences from a website session are a client_id
-- claim and the audience 20260917130000 binds to the MCP server. Its role
-- stayed 'authenticated', so PostgREST, Storage and Realtime would have run it
-- as the person: their agent mandate (resume text, phone), their saved
-- resume in the 'resumes' bucket, every row any signed-in policy lets them
-- reach, and every function PUBLIC may execute, with auth.uid() set to them.
-- And the hook failed open: any error inside it returned the event as
-- received, so a connector token could come out a plain website session.
--
-- NOW, for an event whose claims carry a non-empty client_id:
--   - the audience is the MCP server's URL, as before;
--   - the role is mcp_client, a NOLOGIN role that holds no grant and that the
--     API's login role (authenticator) is NOT a member of. PostgREST, Storage
--     and Realtime switch to the token's role before anything runs, so every
--     database request carrying such a token is refused at that switch: no
--     table, no view, no function, whatever PUBLIC may hold;
--   - a client_id that is not a JSON string, or any failure while the claims
--     are rebound, refuses the token (the hook's error answer) instead of
--     returning the event untouched.
-- The MCP server (agent-mcp) never uses the person's token against the
-- database: it checks issuer, audience, client_id, subject and expiry, asks
-- the auth server (or the key set) for the signature, and reads with the
-- service role, so it still knows who the person is. The site's own
-- functions refuse a token carrying client_id or any role but
-- 'authenticated' before they ask the auth server (_shared/website-session.ts,
-- _shared/checkout-buyer.ts and the S9-001 edits of fix/audit-rest-abuse).
--
-- UNCHANGED for every other sign-in: an event with no client_id (or an empty
-- one) is returned as received, and any failure on that path returns the
-- event as received, so nothing here can take out website sign-in.
--
-- This migration does NOT enable the hook (a dashboard toggle: Authentication
-- > Hooks > Custom Access Token), and the OAuth server is off: discovery
-- answered 404 feature_disabled on 2026-10-31. The owner enables the hook
-- BEFORE the OAuth server. 20261103161000 adds the second layer for a token
-- minted while the hook is off.
--
-- Executable only by the auth server's role, revoked from PUBLIC, anon and
-- authenticated by name. The MCP server's URL below is one of three spellings
-- (this file, agent-mcp/oauth.ts, src/lib/mcp-test.ts), pinned equal by
-- src/test/the-server-names-itself-once-in-three-runtimes.test.ts, which reads
-- the newest migration that defines the hook.
--
-- Safe to re-run: CREATE OR REPLACE, a role created only when missing,
-- explicit REVOKE and GRANT, and a self-check that only reads.

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
  BEGIN
    IF jsonb_typeof(event->'claims'->'client_id') <> 'string' THEN
      RAISE EXCEPTION 'client_id is not a string';
    END IF;
    v_claims := jsonb_set(
      event->'claims',
      '{aud}',
      to_jsonb('https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/agent-mcp'::text),
      true
    );
    v_claims := jsonb_set(v_claims, '{role}', to_jsonb('mcp_client'::text), true);
    RETURN jsonb_set(event, '{claims}', v_claims, true);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'A token for a connected app could not be bound to the app''s server.'
    ));
  END;
EXCEPTION WHEN OTHERS THEN
  RETURN event;
END;
$$;

REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
  'Access-token hook: a token minted for an OAuth client (claims.client_id) gets the MCP server as its audience and role mcp_client, which the API cannot switch to; any failure on that path refuses the token. Every other sign-in is returned as received. 20261103160000.';

-- The role a connector token names. It can never log in, holds nothing, and
-- the API's login role is not a member, so a request carrying it is refused
-- at the role switch. The self-check below fails the migration if any of
-- that stops being true.
DO $$
BEGIN
  IF to_regrole('mcp_client') IS NULL THEN
    CREATE ROLE mcp_client NOLOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF to_regrole('authenticator') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_auth_members m
                  WHERE m.roleid = to_regrole('mcp_client') AND m.member = to_regrole('authenticator')) THEN
    EXECUTE 'REVOKE mcp_client FROM authenticator';
  END IF;
END $$;

-- Self-verifying, read-only: the hook is one definer with its own
-- search_path, executable by the auth server's role and by no client role;
-- a website event comes back exactly as it went in; a connector event comes
-- back with the MCP server as its audience, role mcp_client and every other
-- claim untouched; a client_id that is not a string is refused with the
-- hook's error answer; mcp_client cannot log in, bypasses nothing, holds no
-- table privilege, and the API's login role cannot switch to it.
DO $$
DECLARE
  v_oid oid := to_regprocedure('public.custom_access_token_hook(jsonb)')::oid;
  v_role oid := to_regrole('mcp_client');
  v_site jsonb := jsonb_build_object(
    'user_id', '11111111-1111-4111-8111-111111111111',
    'authentication_method', 'password',
    'claims', jsonb_build_object(
      'iss', 'https://example.invalid/auth/v1', 'aud', 'authenticated',
      'sub', '11111111-1111-4111-8111-111111111111', 'exp', 1900000000,
      'role', 'authenticated', 'email', 'self-check@example.invalid',
      'aal', 'aal1', 'session_id', 'self-check', 'is_anonymous', false));
  v_app jsonb;
  v_out jsonb;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'self-check: custom_access_token_hook(jsonb) is missing';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'custom_access_token_hook') <> 1 THEN
    RAISE EXCEPTION 'self-check: custom_access_token_hook has more than one signature';
  END IF;
  IF NOT coalesce((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_oid), false)
     OR NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) c(setting)
                     WHERE p.oid = v_oid AND c.setting LIKE 'search_path=%') THEN
    RAISE EXCEPTION 'self-check: custom_access_token_hook is not a definer with its own search_path';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: custom_access_token_hook is executable by a client role';
  END IF;
  IF to_regrole('supabase_auth_admin') IS NOT NULL AND NOT has_function_privilege('supabase_auth_admin', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: the auth server cannot execute custom_access_token_hook';
  END IF;

  v_out := public.custom_access_token_hook(v_site);
  IF v_out IS DISTINCT FROM v_site THEN
    RAISE EXCEPTION 'self-check: a website sign-in came back changed: %', v_out;
  END IF;
  v_out := public.custom_access_token_hook(jsonb_set(v_site, '{claims,client_id}', '""'::jsonb));
  IF v_out IS DISTINCT FROM jsonb_set(v_site, '{claims,client_id}', '""'::jsonb) THEN
    RAISE EXCEPTION 'self-check: an empty client_id was not treated as absent';
  END IF;

  v_app := jsonb_set(v_site, '{claims,client_id}', '"9a8b7c6d-5e4f-4a2b-8c0d-9e8f7a6b5c4d"'::jsonb);
  v_out := public.custom_access_token_hook(v_app);
  IF v_out->'claims'->>'role' IS DISTINCT FROM 'mcp_client' THEN
    RAISE EXCEPTION 'self-check: a connector token kept role %', v_out->'claims'->>'role';
  END IF;
  IF v_out->'claims'->>'aud' NOT LIKE 'https://%/functions/v1/agent-mcp' THEN
    RAISE EXCEPTION 'self-check: a connector token was given audience %', v_out->'claims'->>'aud';
  END IF;
  IF (v_out->'claims') - 'aud' - 'role' IS DISTINCT FROM (v_app->'claims') - 'aud' - 'role'
     OR v_out - 'claims' IS DISTINCT FROM v_app - 'claims' THEN
    RAISE EXCEPTION 'self-check: the hook changed a claim other than aud and role: %', v_out;
  END IF;
  v_out := public.custom_access_token_hook(jsonb_set(v_site, '{claims,client_id}', '42'::jsonb));
  IF v_out ? 'claims' OR (v_out->'error'->>'http_code') IS DISTINCT FROM '403' THEN
    RAISE EXCEPTION 'self-check: a connector token with a malformed client_id was not refused: %', v_out;
  END IF;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'self-check: role mcp_client is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid = v_role
              AND (r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication)) THEN
    RAISE EXCEPTION 'self-check: mcp_client can log in or holds an attribute it must not';
  END IF;
  IF to_regrole('authenticator') IS NOT NULL AND pg_has_role('authenticator', 'mcp_client', 'MEMBER') THEN
    RAISE EXCEPTION 'self-check: the API''s login role can switch to mcp_client';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE a.grantee = v_role) THEN
    RAISE EXCEPTION 'self-check: mcp_client holds a privilege on a table, view or sequence';
  END IF;
END $$;
