-- A DELETED ACCOUNT TAKES ITS FULL ANALYSIS, NOT ONLY THE POINTER TO IT
-- (wave 4 round 2 recheck; owner decision D9, plan CP-048).
--
-- WHAT WAS WRONG. 20261011210000 made account deletion erase purchased_content
-- for the account's purchases and Pro inclusions, and the delete card says
-- "the documents we made for your purchases and Pro inclusions" are deleted.
-- But the one document still sold, the Full Analysis (and the Full Analysis
-- Pro includes), is not in purchased_content: analyze-resume stores it in
-- resume_analyses, where it quotes the résumé and anyone holding its share id
-- reads it for 90 days, and purchased_content holds only the pointer
-- {"shareId": ...}. Deleting the pointer kept the document and removed the
-- only record that led the person to it.
--
-- WHAT THIS CHANGES. account_erase_personal_data (same signature, still
-- service_role only, still one transaction) collects the purchased_content
-- rows it erases (the same three ways: sessions checkout_buyers binds to the
-- account, the account's Pro grants as 'pro_' followed by the grant id, and
-- with a proven address the address's), deletes the resume_analyses row each
-- one's shareId names, then the rows. It answers analyses_deleted beside
-- documents_deleted. resume_analyses is touched only when it exists.
-- Payment records stay: product_deliveries (whose metadata keeps the share id
-- of an analysis that is gone), used_stripe_sessions and checkout_buyers.
--
-- Depends on: 20261011210000 (the function it replaces), resume_analyses
-- (share_id), purchased_content, pro_grants, checkout_buyers.
-- Safe to re-run. Verify: src/test/w4b-fix2-a-deleted-account-takes-its-full-analysis.test.ts
-- runs the function's migrations in order in pglite from Supabase's default
-- grants, this one twice; the DO block below checks the catalogue and, on the
-- live tables, erases a probe account's analysis inside a rolled-back block.

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
  v_analyses integer := 0;
  v_doc_ids uuid[];
  v_shares text[];
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
  -- are found through. A Full Analysis is stored in resume_analyses (it
  -- quotes the résumé and its share link reads it for 90 days); its
  -- purchased_content row holds only the pointer {"shareId": ...}, so the
  -- analysis each pointer names goes first, then the pointers.
  IF to_regclass('public.purchased_content') IS NOT NULL AND to_regclass('public.checkout_buyers') IS NOT NULL
     AND to_regclass('public.pro_grants') IS NOT NULL THEN
    SELECT coalesce(array_agg(c.id), '{}'::uuid[]),
           coalesce(array_agg(c.generated_content ->> 'shareId') FILTER (WHERE nullif(btrim(c.generated_content ->> 'shareId'), '') IS NOT NULL), '{}'::text[])
      INTO v_doc_ids, v_shares
      FROM public.purchased_content c
     WHERE c.stripe_session_id IN (SELECT b.stripe_session_id FROM public.checkout_buyers b WHERE b.user_id = p_user_id)
        OR c.stripe_session_id IN (SELECT 'pro_' || g.id::text FROM public.pro_grants g
                                    WHERE g.user_id = p_user_id
                                       OR (v_by_address AND lower(btrim(coalesce(g.email, ''))) = v_email))
        OR (v_by_address AND lower(btrim(coalesce(c.customer_email, ''))) = v_email);

    IF to_regclass('public.resume_analyses') IS NOT NULL AND cardinality(v_shares) > 0 THEN
      DELETE FROM public.resume_analyses a WHERE a.share_id = ANY (v_shares);
      GET DIAGNOSTICS v_analyses = ROW_COUNT;
    END IF;

    DELETE FROM public.purchased_content c WHERE c.id = ANY (v_doc_ids);
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
    'analyses_deleted', v_analyses,
    'pro_grants_deleted', v_grants,
    'do_not_mail_added', v_suppressed > 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.account_erase_personal_data(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_erase_personal_data(uuid, text, boolean) TO service_role;

COMMENT ON FUNCTION public.account_erase_personal_data(uuid, text, boolean) IS
  'delete-account only, before the auth user goes (S12-153, CP-048, D9): revokes the account''s API and connector keys '
  'and blanks their owner_email; deletes the documents made for the account''s bound purchases and Pro grants (a Full '
  'Analysis in resume_analyses through its purchased_content pointer, then the pointer), and the grants; with '
  'p_email_proven, also the address''s documents, analyses, grants, keys, key requests, market-pulse row, lead rows and '
  'unsubscribe token, and adds a do-not-mail entry so queued mail is dropped. Payment records are untouched. '
  'service_role only. 20261011170000, 20261011210000, 20261011212000.';

-- Self-verifying: still a definer with a fixed search_path, closed to the
-- client roles and open to service_role; it names resume_analyses; and on the
-- live tables it deletes the analysis a probe grant's pointer names, keeps
-- another person's analysis, and touches an address's analysis only with a
-- proof. The probe runs inside a block that always rolls back.
DO $$
DECLARE
  f text := 'public.account_erase_personal_data(uuid,text,boolean)';
  v_cfg text[];
  v_def boolean;
  v_probe uuid := '00000000-0000-4000-8000-00000000e2b6';
  v_grant uuid;
  v_mine text;
  v_by_address text;
  v_other text;
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
  IF position('public.resume_analyses' in v_src) = 0 OR position('public.purchased_content' in v_src) = 0
     OR position('public.pro_grants' in v_src) = 0 THEN
    RAISE EXCEPTION '% does not erase the analyses, the documents and the grants', f;
  END IF;

  IF to_regclass('public.resume_analyses') IS NULL OR to_regclass('public.purchased_content') IS NULL
     OR to_regclass('public.pro_grants') IS NULL OR to_regclass('public.checkout_buyers') IS NULL THEN
    RAISE NOTICE 'account_erase_personal_data: a table it erases is absent; the probe is skipped';
    RETURN;
  END IF;

  BEGIN
    BEGIN
      INSERT INTO public.pro_grants (email, user_id, product_id, product_type, product_name)
      VALUES ('erase-analysis-probe@example.invalid', v_probe, 'fullAnalysis', 'full_analysis', 'probe')
      RETURNING id INTO v_grant;
      INSERT INTO public.resume_analyses (resume_text, analysis_result) VALUES ('[probe]', '{"probe": true}'::jsonb) RETURNING share_id INTO v_mine;
      INSERT INTO public.resume_analyses (resume_text, analysis_result) VALUES ('[probe]', '{"probe": true}'::jsonb) RETURNING share_id INTO v_by_address;
      INSERT INTO public.resume_analyses (resume_text, analysis_result) VALUES ('[probe]', '{"probe": true}'::jsonb) RETURNING share_id INTO v_other;
      INSERT INTO public.purchased_content (stripe_session_id, customer_email, product_type, product_name, generated_content)
      VALUES ('pro_' || v_grant::text, 'erase-analysis-probe@example.invalid', 'full_analysis', 'probe', jsonb_build_object('shareId', v_mine)),
             ('cs_test_selfcheck_analysis_by_address', 'Erase-Analysis-Probe@example.invalid', 'full_analysis', 'probe', jsonb_build_object('shareId', v_by_address)),
             ('cs_test_selfcheck_analysis_other', 'someone-else-analysis-probe@example.invalid', 'full_analysis', 'probe', jsonb_build_object('shareId', v_other));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'account_erase_personal_data: the probe rows could not be written (%); the behaviour probe is skipped', SQLERRM;
      RETURN;
    END;
    v_out := public.account_erase_personal_data(v_probe, 'erase-analysis-probe@example.invalid', false);
    IF EXISTS (SELECT 1 FROM public.resume_analyses WHERE share_id = v_mine) THEN
      RAISE EXCEPTION 'the Full Analysis behind the account''s grant was kept';
    END IF;
    IF coalesce((v_out ->> 'analyses_deleted')::int, 0) <> 1 THEN
      RAISE EXCEPTION 'analyses_deleted is %, not 1', v_out ->> 'analyses_deleted';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.resume_analyses WHERE share_id = v_by_address) THEN
      RAISE EXCEPTION 'an address''s analysis went without a proof';
    END IF;
    v_out := public.account_erase_personal_data(v_probe, 'erase-analysis-probe@example.invalid', true);
    IF EXISTS (SELECT 1 FROM public.resume_analyses WHERE share_id = v_by_address) THEN
      RAISE EXCEPTION 'a proven address kept its analysis';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.resume_analyses WHERE share_id = v_other) THEN
      RAISE EXCEPTION 'another person''s analysis was deleted';
    END IF;
    RAISE EXCEPTION 'erase-analyses-selfcheck-rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'erase-analyses-selfcheck-rollback' THEN RAISE; END IF;
  END;
END $$;
