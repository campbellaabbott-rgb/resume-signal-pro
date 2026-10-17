-- A MAILBOX IS PROVEN BY THE CODE IT RECEIVED, AND AN OLDER PASSWORD DOES NOT
-- SURVIVE IT (R1 sign-in server, 2026-10-14; plan items CP-006, CP-047, owner
-- decision D15).
--
-- WHAT WAS WRONG. Sign-ups are confirmed automatically, so anybody can register
-- someone else's address with a password. When the real owner later signs in
-- with an emailed code or with Google, they land in that account and the
-- stranger's password still works. And nothing recorded that an account had
-- ever proven its mailbox, so no purchase keyed by an address could be joined
-- to an account safely.
--
-- WHAT THIS ADDS, all service_role only (auth-signed-in, through
-- supabase/functions/_shared/mailbox-guard.ts, is the only writer):
--   - account_mailbox_proofs: one row per (account, address) the account has
--     proven by a fresh code, link or provider sign-in. Contract 1 of the R1
--     plan; _shared/mailbox-proof.ts hasMailboxProof reads it.
--   - account_password_clears: one row per session whose sign-in cleared a
--     password set before the proof, so a session clears at most once and a
--     password the person sets afterwards is never cleared by a later call.
--   - auth_changed_since(user, ts): whether the auth log shows the account
--     changed (an address or a password) at or after ts.
--   - auth_sign_in_addresses(user, at): the addresses the auth log names for
--     this account's sign-ins within a minute of `at` (empty when the log is
--     not written to Postgres, which the guard reads as "cannot vouch").
--   - auth_user_has_password(user): whether the account has a password.
--
-- THE AUTH LOG'S ACTION NAMES are pinned against supabase/auth v2.197.0 (the
-- version /auth/v1/health answered on 2026-10-12), file
-- internal/models/audit_log_entry.go and its callers in internal/api:
--   change:  user_modified (self-service update incl. an address change
--            request, the address-change confirmation, and an admin edit,
--            whose target is traits.user_id), user_updated_password.
--            v2.197.0 has no separate action for an address change.
--   sign-in: login, user_signedup, identity_linked, invite_accepted; each
--            carries the account's address at that moment in actor_username.
-- auth.audit_log_entries.payload is json, read here with ->> only.
--
-- Depends on: auth.users, auth.audit_log_entries (GoTrue's own tables).
-- Safe to re-run. Verify: src/test/r1-server-migration.test.ts runs this file
-- in pglite from Supabase's default grants; the DO block below checks the
-- live catalogue and exercises each function; scripts/verify-deploy.d/
-- 96-r1-signin-server.sh probes the grants read-only.

CREATE TABLE IF NOT EXISTS public.account_mailbox_proofs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email)),
  method text NOT NULL CHECK (method IN ('otp', 'magiclink', 'recovery', 'oauth', 'email_confirm')),
  amr_at timestamptz NOT NULL,
  password_cleared boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, email)
);

ALTER TABLE public.account_mailbox_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_mailbox_proofs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.account_mailbox_proofs TO service_role;

COMMENT ON TABLE public.account_mailbox_proofs IS
  'One row per (account, address) the account proved by a fresh emailed code, link or provider sign-in '
  '(auth-signed-in, _shared/mailbox-guard.ts). Read by _shared/mailbox-proof.ts hasMailboxProof. '
  'service_role only. 20261014110000.';

CREATE TABLE IF NOT EXISTS public.account_password_clears (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cleared_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_password_clears ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_password_clears FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.account_password_clears TO service_role;

COMMENT ON TABLE public.account_password_clears IS
  'One row per auth session whose fresh sign-in cleared a password set before the address was proven: '
  'the claim that makes auth-signed-in clear at most once per session. service_role only. 20261014110000.';

-- The identity column's sequence carries Supabase's default grants too.
DO $$
DECLARE
  v_seq text := pg_get_serial_sequence('public.account_mailbox_proofs', 'id');
BEGIN
  IF v_seq IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', v_seq);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', v_seq);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.auth_changed_since(p_user_id uuid, p_since timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_user_id IS NULL
      OR p_since IS NULL
      OR EXISTS (
        SELECT 1
          FROM auth.audit_log_entries e
         WHERE e.created_at >= p_since
           AND (e.payload ->> 'action') IN ('user_modified', 'user_updated_password')
           AND ((e.payload ->> 'actor_id') = p_user_id::text
                OR (e.payload -> 'traits' ->> 'user_id') = p_user_id::text)
      );
$$;

REVOKE ALL ON FUNCTION public.auth_changed_since(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_changed_since(uuid, timestamptz) TO service_role;

COMMENT ON FUNCTION public.auth_changed_since(uuid, timestamptz) IS
  'True when auth.audit_log_entries shows the account changed (user_modified, user_updated_password; '
  'by the account or by an admin naming it in traits.user_id) at or after p_since, or when either argument '
  'is NULL. Action names pinned against supabase/auth v2.197.0. service_role only. 20261014110000.';

CREATE OR REPLACE FUNCTION public.auth_sign_in_addresses(p_user_id uuid, p_at timestamptz)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(array_agg(DISTINCT lower(btrim(coalesce(e.payload ->> 'actor_username', '')))), '{}'::text[])
    FROM auth.audit_log_entries e
   WHERE p_user_id IS NOT NULL
     AND p_at IS NOT NULL
     AND e.created_at BETWEEN p_at - interval '60 seconds' AND p_at + interval '60 seconds'
     AND (e.payload ->> 'action') IN ('login', 'user_signedup', 'identity_linked', 'invite_accepted')
     AND (e.payload ->> 'actor_id') = p_user_id::text;
$$;

REVOKE ALL ON FUNCTION public.auth_sign_in_addresses(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_sign_in_addresses(uuid, timestamptz) TO service_role;

COMMENT ON FUNCTION public.auth_sign_in_addresses(uuid, timestamptz) IS
  'The lower-cased addresses auth.audit_log_entries names (actor_username) for the account''s sign-in entries '
  '(login, user_signedup, identity_linked, invite_accepted) within 60 seconds of p_at; empty when there are none. '
  'service_role only. 20261014110000.';

CREATE OR REPLACE FUNCTION public.auth_user_has_password(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT coalesce(u.encrypted_password, '') <> '' FROM auth.users u WHERE u.id = p_user_id),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.auth_user_has_password(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_has_password(uuid) TO service_role;

COMMENT ON FUNCTION public.auth_user_has_password(uuid) IS
  'Whether auth.users holds a non-empty encrypted_password for the account. service_role only. 20261014110000.';

-- Self-verifying: both tables exist with row level security on and nothing for
-- the client roles; each function is a definer with an empty search_path that
-- only service_role may execute, and each one runs (so the definer can read
-- GoTrue's tables here); the proof table refuses a second row for the same
-- address and an address that is not lower case. Probe rows are rolled back.
DO $$
DECLARE
  v_fn text;
  v_user uuid;
BEGIN
  IF to_regclass('public.account_mailbox_proofs') IS NULL OR to_regclass('public.account_password_clears') IS NULL THEN
    RAISE EXCEPTION 'account_mailbox_proofs or account_password_clears was not created';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.account_mailbox_proofs'::regclass)
     OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.account_password_clears'::regclass) THEN
    RAISE EXCEPTION 'row level security is off on account_mailbox_proofs or account_password_clears';
  END IF;
  IF has_table_privilege('anon', 'public.account_mailbox_proofs', 'SELECT')
     OR has_table_privilege('anon', 'public.account_mailbox_proofs', 'INSERT')
     OR has_table_privilege('anon', 'public.account_mailbox_proofs', 'UPDATE')
     OR has_table_privilege('anon', 'public.account_mailbox_proofs', 'DELETE')
     OR has_table_privilege('authenticated', 'public.account_mailbox_proofs', 'SELECT')
     OR has_table_privilege('authenticated', 'public.account_mailbox_proofs', 'INSERT')
     OR has_table_privilege('authenticated', 'public.account_mailbox_proofs', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.account_mailbox_proofs', 'DELETE') THEN
    RAISE EXCEPTION 'account_mailbox_proofs is readable or writable by a client role';
  END IF;
  IF has_table_privilege('anon', 'public.account_password_clears', 'SELECT')
     OR has_table_privilege('anon', 'public.account_password_clears', 'INSERT')
     OR has_table_privilege('anon', 'public.account_password_clears', 'UPDATE')
     OR has_table_privilege('anon', 'public.account_password_clears', 'DELETE')
     OR has_table_privilege('authenticated', 'public.account_password_clears', 'SELECT')
     OR has_table_privilege('authenticated', 'public.account_password_clears', 'INSERT')
     OR has_table_privilege('authenticated', 'public.account_password_clears', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.account_password_clears', 'DELETE') THEN
    RAISE EXCEPTION 'account_password_clears is readable or writable by a client role';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.account_mailbox_proofs', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.account_password_clears', 'INSERT') THEN
    RAISE EXCEPTION 'service_role cannot write account_mailbox_proofs or account_password_clears';
  END IF;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.auth_changed_since(uuid, timestamptz)',
    'public.auth_sign_in_addresses(uuid, timestamptz)',
    'public.auth_user_has_password(uuid)'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
       WHERE p.oid = v_fn::regprocedure
         AND p.prosecdef
         AND p.proconfig IS NOT NULL
         AND EXISTS (SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg IN ('search_path=', 'search_path=""'))
    ) THEN
      RAISE EXCEPTION '% is not a SECURITY DEFINER function with an empty search_path', v_fn;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% is executable by a client role', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% is not executable by service_role', v_fn;
    END IF;
  END LOOP;

  -- Each function runs: an unknown account changed nothing, signed in nowhere
  -- and has no password; a NULL time is read as changed (fail closed).
  IF public.auth_changed_since(gen_random_uuid(), now()) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'auth_changed_since does not answer false for an unknown account';
  END IF;
  IF public.auth_changed_since(gen_random_uuid(), NULL) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'auth_changed_since does not fail closed on a NULL time';
  END IF;
  IF cardinality(public.auth_sign_in_addresses(gen_random_uuid(), now())) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'auth_sign_in_addresses names a sign-in for an unknown account';
  END IF;
  IF public.auth_user_has_password(gen_random_uuid()) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'auth_user_has_password does not answer false for an unknown account';
  END IF;

  -- The table's own rules, on an existing account when there is one; rolled back.
  SELECT u.id INTO v_user FROM auth.users u LIMIT 1;
  IF v_user IS NOT NULL THEN
    BEGIN
      INSERT INTO public.account_mailbox_proofs (user_id, email, method, amr_at)
      VALUES (v_user, 'selfcheck@example.invalid', 'otp', now());
      BEGIN
        INSERT INTO public.account_mailbox_proofs (user_id, email, method, amr_at)
        VALUES (v_user, 'selfcheck@example.invalid', 'oauth', now());
        RAISE EXCEPTION 'account_mailbox_proofs accepted a second row for the same account and address';
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;
      BEGIN
        INSERT INTO public.account_mailbox_proofs (user_id, email, method, amr_at)
        VALUES (v_user, 'SelfCheck@Example.invalid', 'otp', now());
        RAISE EXCEPTION 'account_mailbox_proofs accepted an address that is not lower case';
      EXCEPTION WHEN check_violation THEN
        NULL;
      END;
      RAISE EXCEPTION USING ERRCODE = 'RB000', MESSAGE = 'self-check passed; its rows are rolled back';
    EXCEPTION WHEN SQLSTATE 'RB000' THEN
      NULL;
    END;
  END IF;
END $$;