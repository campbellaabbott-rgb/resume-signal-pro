-- A DELETED ACCOUNT TAKES ITS "NOT SUBSCRIBED" ROWS (S14X-231).
--
-- WHAT WAS WRONG. check-subscription remembers "this signed-in visitor has no
-- plan" for five minutes by inserting a pro_subscribers row {email,
-- stripe_customer_id NULL, status 'inactive'}, for every signed-in visitor
-- with no row and no Stripe customer. Nothing removed it: deleting the account
-- left the address in pro_subscribers for good. account_erase_personal_data
-- (20261011212000) never touched pro_subscribers or agent_subscribers, and
-- pro_subscribers.user_id has no foreign key, so removing the auth user left
-- the row too.
--
-- WHAT THIS CHANGES. account_erase_personal_data (same signature, still
-- service_role only, still one transaction, every earlier step unchanged)
-- also deletes, from pro_subscribers and agent_subscribers, rows with no
-- Stripe customer that are bound to the account by user_id, rows of the
-- account's address that are not live (status not active, trialing or
-- past_due: only ever that cache), and with a proven mailbox every
-- no-customer row of the address. It answers pro_cache_rows_deleted. Rows
-- that carry a Stripe customer are payment records and stay. Each table is
-- touched only when it exists. The nightly privacy job (20261112100000)
-- deletes the same cache rows a day after they were written for visitors
-- who never delete their account, so check-subscription needs no change.
--
-- In its own file because every pglite test of the eraser applies each
-- migration that defines it, in order, onto stand-in schemas with no cron and
-- no log tables. Depends on: 20261011212000 (the body it carries forward),
-- pro_subscribers (user_id from 20261008130000), agent_subscribers (user_id
-- from 20261005130000). Safe to re-run. Verify:
-- src/test/a-deleted-account-leaves-no-subscription-cache-row.test.ts, and the
-- rolled-back probe at the end of this file.

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
  v_cache integer := 0;
  v_n integer := 0;
  v_valid boolean;
  v_doc_ids uuid[];
  v_shares text[];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'account_erase_personal_data: no account named';
  END IF;
  v_valid := v_email ~ '^[^@[:space:]]+@[^@[:space:]]+$';
  v_by_address := coalesce(p_email_proven, false) AND v_valid;

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

  -- Plan rows with no Stripe customer: check-subscription's five-minute
  -- "not subscribed" answer (status 'inactive', written for every signed-in
  -- visitor) and plans granted by hand. The account's own rows go; an
  -- address's row goes when it is not live, which is only ever that cache, or
  -- with a proven mailbox whatever its status. A row that carries a Stripe
  -- customer is a payment record and stays.
  IF to_regclass('public.pro_subscribers') IS NOT NULL THEN
    DELETE FROM public.pro_subscribers s
     WHERE s.stripe_customer_id IS NULL
       AND (s.user_id = p_user_id
            OR (v_valid AND lower(btrim(coalesce(s.email, ''))) = v_email
                AND (v_by_address OR s.status NOT IN ('active', 'trialing', 'past_due'))));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_cache := v_cache + v_n;
  END IF;
  IF to_regclass('public.agent_subscribers') IS NOT NULL THEN
    DELETE FROM public.agent_subscribers s
     WHERE s.stripe_customer_id IS NULL
       AND (s.user_id = p_user_id
            OR (v_valid AND lower(btrim(coalesce(s.email, ''))) = v_email
                AND (v_by_address OR s.status NOT IN ('active', 'trialing', 'past_due'))));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_cache := v_cache + v_n;
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
    'pro_cache_rows_deleted', v_cache,
    'do_not_mail_added', v_suppressed > 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.account_erase_personal_data(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_erase_personal_data(uuid, text, boolean) TO service_role;

COMMENT ON FUNCTION public.account_erase_personal_data(uuid, text, boolean) IS
  'delete-account only, before the auth user goes (S12-153, CP-048, D9, S14X-231): revokes the account''s API and connector keys '
  'and blanks their owner_email; deletes the documents made for the account''s bound purchases and Pro grants (a Full '
  'Analysis in resume_analyses through its purchased_content pointer, then the pointer), and the grants; deletes the '
  'account''s pro_subscribers and agent_subscribers rows with no Stripe customer and its address''s not-live ones (the '
  'check-subscription cache); with p_email_proven, also the address''s documents, analyses, grants, keys, key requests, '
  'market-pulse row, lead rows, unsubscribe token and every no-customer plan row, and adds a do-not-mail entry so queued '
  'mail is dropped. Payment records are untouched. service_role only. 20261011170000, 20261011210000, 20261011212000, '
  '20261112101000.';

-- Self-verifying: still a definer with a fixed search_path, closed to the
-- client roles and open to service_role; it still names every table the
-- earlier bodies erased, and now the two plan tables; and on the live tables
-- it deletes a probe account's cache row while keeping a row that carries a
-- Stripe customer and another address's cache row. The probe runs inside a
-- block that always rolls back.
DO $$
DECLARE
  f text := 'public.account_erase_personal_data(uuid,text,boolean)';
  v_cfg text[];
  v_def boolean;
  v_src text;
  v_probe uuid := '00000000-0000-4000-8000-00000000e2c7';
  v_out jsonb;
BEGIN
  SELECT p.prosecdef, p.proconfig, p.prosrc INTO v_def, v_cfg, v_src FROM pg_proc p WHERE p.oid = f::regprocedure;
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
  IF position('public.resume_analyses' in v_src) = 0 OR position('public.purchased_content' in v_src) = 0
     OR position('public.pro_grants' in v_src) = 0 OR position('public.api_keys' in v_src) = 0
     OR position('public.suppressed_emails' in v_src) = 0 OR position('public.pro_subscribers' in v_src) = 0
     OR position('public.agent_subscribers' in v_src) = 0 THEN
    RAISE EXCEPTION '% lost a table it erases', f;
  END IF;

  IF to_regclass('public.pro_subscribers') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.pro_subscribers') AND attname = 'user_id' AND NOT attisdropped
  ) THEN
    RAISE NOTICE 'account_erase_personal_data: pro_subscribers (with user_id) is absent; the cache probe is skipped';
    RETURN;
  END IF;

  BEGIN
    BEGIN
      INSERT INTO public.pro_subscribers (email, stripe_customer_id, status, updated_at)
      VALUES ('erase-cache-probe@example.invalid', NULL, 'inactive', now()),
             ('erase-cache-other@example.invalid', NULL, 'inactive', now());
      INSERT INTO public.pro_subscribers (email, stripe_customer_id, status, updated_at, user_id)
      VALUES ('erase-cache-payer@example.invalid', 'cus_erase_probe', 'canceled', now(), v_probe);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'account_erase_personal_data: the probe rows could not be written (%); the cache probe is skipped', SQLERRM;
      RETURN;
    END;
    v_out := public.account_erase_personal_data(v_probe, 'Erase-Cache-Probe@example.invalid', false);
    IF EXISTS (SELECT 1 FROM public.pro_subscribers WHERE email = 'erase-cache-probe@example.invalid') THEN
      RAISE EXCEPTION 'the account''s "not subscribed" row was kept';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.pro_subscribers WHERE email = 'erase-cache-payer@example.invalid') THEN
      RAISE EXCEPTION 'a row that carries a Stripe customer was deleted';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.pro_subscribers WHERE email = 'erase-cache-other@example.invalid') THEN
      RAISE EXCEPTION 'another address''s row was deleted';
    END IF;
    IF coalesce((v_out ->> 'pro_cache_rows_deleted')::int, -1) <> 1 THEN
      RAISE EXCEPTION 'pro_cache_rows_deleted is %, not 1', v_out ->> 'pro_cache_rows_deleted';
    END IF;
    RAISE EXCEPTION 'erase-cache-selfcheck-rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'erase-cache-selfcheck-rollback' THEN RAISE; END IF;
  END;
END $$;
