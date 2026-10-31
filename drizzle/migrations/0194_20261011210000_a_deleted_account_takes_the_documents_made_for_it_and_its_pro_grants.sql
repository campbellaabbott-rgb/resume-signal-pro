-- A DELETED ACCOUNT TAKES THE DOCUMENTS MADE FOR IT AND ITS PRO GRANTS
-- (wave 4 round 2 review, security lens; owner decision D9, plan CP-048).
--
-- WHAT WAS WRONG. Account deletion said only payment records are kept, and
-- the delete card and delete-account's answer said so, but
-- account_erase_personal_data (20261011170000) left two kinds of personal
-- data behind:
--   - purchased_content: the documents made from the person's résumé for a
--     purchase (letters, packages, reports), keyed by customer_email and kept
--     365 days. It has no user_id and no foreign key, so nothing cascades;
--   - pro_grants: each grant keeps the address, the résumé session and the
--     job it was minted for.
--
-- WHAT THIS CHANGES. account_erase_personal_data (same signature, still
-- service_role only, still one transaction) also deletes:
--   - purchased_content for every session checkout_buyers binds to the
--     account, and for every Pro grant the account minted (their copy is
--     stored as 'pro_' followed by the grant id);
--   - with a proven address (an address alone is not proof while sign-ups are
--     auto-confirmed), purchased_content whose customer_email is that address;
--   - pro_grants the account minted, and with a proven address those minted
--     for it.
-- Payment records stay: product_deliveries, used_stripe_sessions and
-- checkout_buyers (whose user_id the auth delete sets to NULL) are untouched.
-- Each table is touched only when it exists, so the function runs on a
-- database that lacks one.
--
-- Depends on: 20261011170000 (the function it replaces), purchased_content,
-- pro_grants (user_id from 20261008130000), checkout_buyers (20261011150000).
-- Safe to re-run. Verify: src/test/w4b-fix-a-deleted-account-takes-its-documents.test.ts
-- runs this file twice in pglite from Supabase's default grants; the DO block
-- below checks the catalogue and exercises the deletes inside a rolled-back
-- block.

SET LOCAL statement_timeout = '2min';

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
  v_documents integer := 0;
  v_grants integer := 0;
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

  -- The documents made for the account's purchases, before the grants they
  -- are found through.
  IF to_regclass('public.purchased_content') IS NOT NULL AND to_regclass('public.checkout_buyers') IS NOT NULL
     AND to_regclass('public.pro_grants') IS NOT NULL THEN
    DELETE FROM public.purchased_content c
     WHERE c.stripe_session_id IN (SELECT b.stripe_session_id FROM public.checkout_buyers b WHERE b.user_id = p_user_id)
        OR c.stripe_session_id IN (SELECT 'pro_' || g.id::text FROM public.pro_grants g
                                    WHERE g.user_id = p_user_id
                                       OR (v_by_address AND lower(btrim(coalesce(g.email, ''))) = v_email))
        OR (v_by_address AND lower(btrim(coalesce(c.customer_email, ''))) = v_email);
    GET DIAGNOSTICS v_documents = ROW_COUNT;
  END IF;

  IF to_regclass('public.pro_grants') IS NOT NULL THEN
    DELETE FROM public.pro_grants g
     WHERE g.user_id = p_user_id
        OR (v_by_address AND lower(btrim(coalesce(g.email, ''))) = v_email);
    GET DIAGNOSTICS v_grants = ROW_COUNT;
  END IF;

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
    'documents_deleted', v_documents,
    'pro_grants_deleted', v_grants,
    'do_not_mail_added', v_suppressed > 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.account_erase_personal_data(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_erase_personal_data(uuid, text, boolean) TO service_role;

COMMENT ON FUNCTION public.account_erase_personal_data(uuid, text, boolean) IS
  'delete-account only, before the auth user goes (S12-153, CP-048, D9): revokes the account''s API and connector keys '
  'and blanks their owner_email; deletes the documents made for the account''s bound purchases and Pro grants, and the '
  'grants; with p_email_proven, also the address''s documents, grants, keys, key requests, market-pulse row, lead rows '
  'and unsubscribe token, and adds a do-not-mail entry so queued mail is dropped. Payment records are untouched. '
  'service_role only. 20261011170000, 20261011210000.';

-- Self-verifying: still a definer with a fixed search_path, closed to the
-- client roles and open to service_role; and on the live tables it deletes a
-- bound document and a minted grant, keeps the payment record and another
-- account's document, and touches the address's document only with a proof.
-- The probe runs inside a block that always rolls back.
DO $$
DECLARE
  f text := 'public.account_erase_personal_data(uuid,text,boolean)';
  v_cfg text[];
  v_def boolean;
  v_probe uuid := '00000000-0000-4000-8000-00000000e2b5';
  v_grant uuid;
  v_out jsonb;
  v_src text;
BEGIN
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

  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = f::regprocedure;
  IF position('public.purchased_content' in v_src) = 0 OR position('public.pro_grants' in v_src) = 0 THEN
    RAISE EXCEPTION '% does not erase the documents and the grants', f;
  END IF;

  IF to_regclass('public.purchased_content') IS NULL OR to_regclass('public.pro_grants') IS NULL
     OR to_regclass('public.checkout_buyers') IS NULL THEN
    RAISE NOTICE 'account_erase_personal_data: a table it erases is absent; the probe is skipped';
    RETURN;
  END IF;

  BEGIN
    -- A binding (checkout_buyers.user_id references auth.users) is exercised
    -- by the pglite test; here the account is named through its grant.
    BEGIN
      INSERT INTO public.pro_grants (email, user_id, product_id, product_type, product_name)
      VALUES ('erase-doc-probe@example.invalid', v_probe, 'fullAnalysis', 'full_analysis', 'probe')
      RETURNING id INTO v_grant;
      INSERT INTO public.purchased_content (stripe_session_id, customer_email, product_type, product_name)
      VALUES ('pro_' || v_grant::text, 'erase-doc-probe@example.invalid', 'full_analysis', 'probe'),
             ('cs_test_selfcheck_erase_by_address', 'Erase-Doc-Probe@example.invalid', 'full_analysis', 'probe'),
             ('cs_test_selfcheck_erase_other', 'someone-else-probe@example.invalid', 'full_analysis', 'probe');
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'account_erase_personal_data: the probe rows could not be written (%); the behaviour probe is skipped', SQLERRM;
      RETURN;
    END;
    v_out := public.account_erase_personal_data(v_probe, 'erase-doc-probe@example.invalid', false);
    IF EXISTS (SELECT 1 FROM public.pro_grants WHERE id = v_grant) THEN
      RAISE EXCEPTION 'the account''s Pro grant was kept';
    END IF;
    IF EXISTS (SELECT 1 FROM public.purchased_content WHERE stripe_session_id = 'pro_' || v_grant::text) THEN
      RAISE EXCEPTION 'the document made for the account''s grant was kept';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.purchased_content WHERE stripe_session_id = 'cs_test_selfcheck_erase_by_address') THEN
      RAISE EXCEPTION 'an address''s document went without a proof';
    END IF;
    v_out := public.account_erase_personal_data(v_probe, 'erase-doc-probe@example.invalid', true);
    IF EXISTS (SELECT 1 FROM public.purchased_content WHERE stripe_session_id = 'cs_test_selfcheck_erase_by_address') THEN
      RAISE EXCEPTION 'a proven address kept its document';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.purchased_content WHERE stripe_session_id = 'cs_test_selfcheck_erase_other') THEN
      RAISE EXCEPTION 'another address''s document was deleted';
    END IF;
    RAISE EXCEPTION 'erase-docs-selfcheck-rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'erase-docs-selfcheck-rollback' THEN RAISE; END IF;
  END;
END $$;