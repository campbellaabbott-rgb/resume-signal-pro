-- A DELETED ACCOUNT TAKES ITS KEYS AND ITS MAILING-LIST ENTRIES, AND A PROVEN
-- MAILBOX COUNTS WHERE PLANS ARE READ (wave 4 round 2, account-compliance;
-- S12-153, plan CP-048 and CP-047, owner decision D9).
--
-- WHAT WAS WRONG.
--   S12-153  delete-account removed the auth user and nothing else it did not
--            reach through a foreign key: an API or connector key kept working
--            for the deleted account (api_keys has no foreign key to
--            auth.users) and kept the address in owner_email for good; the
--            market pulse kept mailing; the lead row, the key requests and the
--            unsubscribe token kept the address.
--   CP-047   R1 records a proven mailbox in account_mailbox_proofs
--            (20261014110000), and the site's reader (_shared/account-proof.ts)
--            now counts it, but the SQL reader every plan gate calls
--            (account_mailbox_proven, 20261005130000) did not: an unbound plan
--            on an address the account had proven by code still answered
--            "not yours".
--
-- WHAT THIS ADDS.
--   1. api_keys.owner_email may be NULL: an erased key keeps its row (usage
--      and billing history point at it) but no address.
--   2. account_erase_personal_data(user, email, email_proven), a definer for
--      delete-account only (service_role): in one transaction it revokes every
--      key the account minted and blanks its address; and, only when the
--      caller proved the address is the account's (D9: an address alone is not
--      proof while sign-ups are auto-confirmed), it also revokes keys issued to
--      that address, deletes its key requests, its market-pulse row, its lead
--      rows and its unsubscribe token, and records a do-not-mail entry so a
--      mail already queued for it is dropped. Payment records are not touched.
--   3. account_mailbox_proven(user) also answers true when
--      account_mailbox_proofs holds a row for the account's current address.
--      The table is read only when it exists, so this file is safe before R1's.
--
-- Depends on: api_keys, api_key_requests, market_pulse_subscribers,
-- free_scan_leads, email_unsubscribe_tokens, suppressed_emails,
-- mailbox_proof_settings (all earlier); account_mailbox_proofs (20261014110000)
-- when present. Apply BEFORE delete-account 2026-10-14.25, which calls (2).
-- Safe to re-run. Verify: src/test/w4b-a-deleted-account-takes-its-keys-and-lists.test.ts
-- runs this file twice in pglite from Supabase's default grants; the DO block
-- below checks the catalogue and exercises (2) inside a rolled-back block.

SET LOCAL statement_timeout = '2min';

ALTER TABLE public.api_keys ALTER COLUMN owner_email DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.account_erase_personal_data(p_user_id uuid, p_email text, p_email_proven boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_by_address boolean;
  v_keys integer := 0;
  v_requests integer := 0;
  v_pulse integer := 0;
  v_leads integer := 0;
  v_tokens integer := 0;
  v_suppressed integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'account_erase_personal_data: no account named';
  END IF;
  v_by_address := coalesce(p_email_proven, false) AND v_email ~ '^[^@[:space:]]+@[^@[:space:]]+$';

  UPDATE public.api_keys k
     SET revoked_at = coalesce(k.revoked_at, now()),
         owner_email = NULL
   WHERE k.user_id = p_user_id
      OR (v_by_address AND lower(btrim(coalesce(k.owner_email, ''))) = v_email);
  GET DIAGNOSTICS v_keys = ROW_COUNT;

  IF v_by_address THEN
    DELETE FROM public.api_key_requests r WHERE lower(btrim(r.email)) = v_email;
    GET DIAGNOSTICS v_requests = ROW_COUNT;
    DELETE FROM public.market_pulse_subscribers m WHERE lower(btrim(m.email)) = v_email;
    GET DIAGNOSTICS v_pulse = ROW_COUNT;
    DELETE FROM public.free_scan_leads l WHERE lower(btrim(l.email)) = v_email;
    GET DIAGNOSTICS v_leads = ROW_COUNT;
    DELETE FROM public.email_unsubscribe_tokens t WHERE lower(btrim(t.email)) = v_email;
    GET DIAGNOSTICS v_tokens = ROW_COUNT;
    INSERT INTO public.suppressed_emails (email, reason, metadata)
    VALUES (v_email, 'unsubscribe', jsonb_build_object('source', 'account_deleted', 'at', now()))
    ON CONFLICT (email) DO NOTHING;
    GET DIAGNOSTICS v_suppressed = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'keys_revoked', v_keys,
    'by_address', v_by_address,
    'key_requests_deleted', v_requests,
    'pulse_rows_deleted', v_pulse,
    'lead_rows_deleted', v_leads,
    'unsubscribe_tokens_deleted', v_tokens,
    'do_not_mail_added', v_suppressed > 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.account_erase_personal_data(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_erase_personal_data(uuid, text, boolean) TO service_role;

COMMENT ON FUNCTION public.account_erase_personal_data(uuid, text, boolean) IS
  'delete-account only, before the auth user goes (S12-153, CP-048, D9): revokes the account''s API and connector keys '
  'and blanks their owner_email; with p_email_proven, also the address''s keys, key requests, market-pulse row, lead rows '
  'and unsubscribe token, and adds a do-not-mail entry so queued mail is dropped. Payment records are untouched. '
  'service_role only. 20261011170000.';

CREATE OR REPLACE FUNCTION public.account_mailbox_proven(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_created timestamptz;
  v_confirmed timestamptz;
  v_proven boolean := false;
BEGIN
  SELECT lower(btrim(coalesce(u.email, ''))), u.created_at, u.email_confirmed_at
    INTO v_email, v_created, v_confirmed
    FROM auth.users u
   WHERE u.id = p_user_id;
  IF v_email IS NULL OR v_email = '' THEN
    RETURN false;
  END IF;

  -- A confirmation made while confirmation was required, and not in the
  -- instant the account was created (which is what an automatic confirmation
  -- looks like). Unchanged from 20261005130000.
  IF EXISTS (
    SELECT 1 FROM public.mailbox_proof_settings s
     WHERE s.id
       AND s.confirmation_required_since IS NOT NULL
       AND v_confirmed IS NOT NULL
       AND v_confirmed >= s.confirmation_required_since
       AND v_confirmed > coalesce(v_created, v_confirmed) + interval '5 seconds'
  ) THEN
    RETURN true;
  END IF;

  -- Or a sign-in provider that verified this very address. Unchanged.
  IF EXISTS (
    SELECT 1 FROM auth.identities i
     WHERE i.user_id = p_user_id
       AND i.provider IN ('google', 'apple')
       AND lower(btrim(coalesce(i.identity_data->>'email', ''))) = v_email
       AND lower(coalesce(i.identity_data->>'email_verified', '')) = 'true'
  ) THEN
    RETURN true;
  END IF;

  -- Or a proof row for the account's current address, written when a fresh
  -- emailed code, link or provider sign-in proved it (R1, 20261014110000).
  -- Read only once that table exists.
  IF to_regclass('public.account_mailbox_proofs') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.account_mailbox_proofs p WHERE p.user_id = $1 AND p.email = $2)'
      INTO v_proven USING p_user_id, v_email;
  END IF;
  RETURN coalesce(v_proven, false);
END;
$$;

REVOKE ALL ON FUNCTION public.account_mailbox_proven(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_mailbox_proven(uuid) TO service_role;

COMMENT ON FUNCTION public.account_mailbox_proven(uuid) IS
  'True when the account''s current address is proven: confirmed while confirmation was required, verified by Google or '
  'Apple, or recorded in account_mailbox_proofs by a fresh code, link or provider sign-in (20261014110000). The site''s '
  'reader (_shared/account-proof.ts) applies the same rule. service_role only. 20261005130000, 20261011170000.';

-- Self-verifying: both functions are definers with a fixed search_path,
-- closed to the client roles and open to service_role; owner_email may be
-- NULL; and the eraser revokes an account's key and blanks its address,
-- leaves another account's key alone, and touches no address row without a
-- proof. The probe runs inside a block that always rolls back.
DO $$
DECLARE
  f text;
  v_cfg text[];
  v_def boolean;
  v_probe uuid := '00000000-0000-4000-8000-00000000e2a5';
  v_other uuid := '00000000-0000-4000-8000-00000000e2a6';
  v_out jsonb;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.account_erase_personal_data(uuid,text,boolean)', 'public.account_mailbox_proven(uuid)'] LOOP
    SELECT p.prosecdef, p.proconfig INTO v_def, v_cfg FROM pg_proc p WHERE p.oid = f::regprocedure;
    IF NOT coalesce(v_def, false) THEN RAISE EXCEPTION '% is not a security definer', f; END IF;
    IF v_cfg IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(v_cfg) c WHERE c LIKE 'search_path=%') THEN
      RAISE EXCEPTION '% has no fixed search_path', f;
    END IF;
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '% is executable by a client role', f;
    END IF;
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION '% is not executable by service_role', f;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'owner_email' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'api_keys.owner_email is still NOT NULL';
  END IF;

  BEGIN
    INSERT INTO public.api_keys (key_hash, key_prefix, name, owner_email, tier, user_id)
    VALUES ('selfcheck-erase-1', 'rb_live_selfchk1', 'selfcheck', 'erase-probe@example.invalid', 'free', v_probe),
           ('selfcheck-erase-2', 'rb_live_selfchk2', 'selfcheck', 'other-probe@example.invalid', 'free', v_other);
    INSERT INTO public.market_pulse_subscribers (email) VALUES ('erase-probe@example.invalid');
    v_out := public.account_erase_personal_data(v_probe, 'Erase-Probe@example.invalid', false);
    IF (v_out->>'keys_revoked')::int <> 1 OR (v_out->>'by_address')::boolean THEN
      RAISE EXCEPTION 'the eraser answered % for one key and no proof', v_out;
    END IF;
    IF EXISTS (SELECT 1 FROM public.api_keys WHERE key_hash = 'selfcheck-erase-1' AND (revoked_at IS NULL OR owner_email IS NOT NULL)) THEN
      RAISE EXCEPTION 'the account''s key was not revoked and blanked';
    END IF;
    IF EXISTS (SELECT 1 FROM public.api_keys WHERE key_hash = 'selfcheck-erase-2' AND revoked_at IS NOT NULL) THEN
      RAISE EXCEPTION 'another account''s key was revoked';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.market_pulse_subscribers WHERE email = 'erase-probe@example.invalid') THEN
      RAISE EXCEPTION 'an address row went without a proof';
    END IF;
    v_out := public.account_erase_personal_data(v_probe, 'erase-probe@example.invalid', true);
    IF EXISTS (SELECT 1 FROM public.market_pulse_subscribers WHERE email = 'erase-probe@example.invalid') THEN
      RAISE EXCEPTION 'a proven address kept its market-pulse row';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.suppressed_emails WHERE email = 'erase-probe@example.invalid') THEN
      RAISE EXCEPTION 'a proven address got no do-not-mail entry';
    END IF;
    RAISE EXCEPTION 'erase-selfcheck-rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'erase-selfcheck-rollback' THEN RAISE; END IF;
  END;
END $$;
