-- A SHARE LINK READS AN ANALYSIS, AND ONLY ITS BUYER DELETES IT (S13-079).
--
-- delete_analysis_by_share_id(text) (20251217024638) deleted the
-- resume_analyses row behind any well-formed share id. The share id is also
-- the read capability: it is the link the buyer forwards, the one the
-- analysis mail carried, and the one get_analysis_by_share_id answers. So
-- anyone holding a forwarded link could POST this RPC with the publishable
-- key and permanently delete the buyer's $5 analysis.
--
-- NOW the one argument carries the share id AND the purchase it was made for,
-- '<share id>:<purchase reference>' (a Stripe Checkout session cs_live_ /
-- cs_test_, or a Pro grant pro_<uuid>). The row goes only when that purchase
-- was redeemed for that very analysis: purchased_content holds one row per
-- reference (stripe_session_id is UNIQUE), and analyze-resume writes
-- product_type 'full_analysis' with generated_content {"shareId": <share id>}
-- at the moment it redeems the purchase, for a Stripe sale and a Pro grant
-- alike. The success page knows the reference (the buyer's own tab, or the
-- link in the purchase mail); a forwarded share link does not carry it.
--   * a bare share id, or any value not of that shape, raises, as a
--     malformed id always did (an older page that still sends a bare share
--     id is told the delete failed, never that it worked);
--   * a well-formed pair whose purchase did not redeem that analysis
--     answers false and deletes nothing;
--   * the buyer's pair deletes the row and answers true, as before.
--
-- WHY ONE ARGUMENT AND NOT TWO. The census (20261004110000 and its re-issues)
-- and its allowlist name this function by its signature, (text), with the
-- success page as its caller; a second argument is a new signature, which the
-- census would have to re-issue in the same deploy. The parameter keeps its
-- name because CREATE OR REPLACE cannot rename one. Grants are restated by
-- exact signature, unchanged: anon and authenticated execute it.
--
-- Analyses delivered before 2026-10-01 have no redemption row naming their
-- share id (the $5 analysis could not be delivered before then), so none of
-- them can be deleted from the page; they expire at 90 days as before.

CREATE OR REPLACE FUNCTION public.delete_analysis_by_share_id(p_share_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_share   text;
  v_session text;
BEGIN
  IF p_share_id IS NULL
     OR p_share_id !~ '^([a-f0-9]{24}|[a-f0-9]{32}):(cs_(live|test)_[A-Za-z0-9]{10,200}|pro_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' THEN
    RAISE EXCEPTION 'Invalid share_id format: want <share id>:<purchase reference>';
  END IF;
  v_share   := split_part(p_share_id, ':', 1);
  v_session := substr(p_share_id, length(v_share) + 2);

  IF NOT EXISTS (
    SELECT 1
      FROM public.purchased_content pc
     WHERE pc.stripe_session_id = v_session
       AND pc.product_type = 'full_analysis'
       AND pc.generated_content ->> 'shareId' = v_share
  ) THEN
    RETURN false;
  END IF;

  DELETE FROM public.resume_analyses WHERE share_id = v_share;
  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_analysis_by_share_id(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_analysis_by_share_id(text) TO anon, authenticated, service_role;

-- ── self-verify: the behaviour, on probe rows that are rolled back ──────────
DO $check$
DECLARE
  v_fail     text;
  v_ok       boolean;
  v_n        integer;
  v_sentinel constant text := 'delete_analysis_by_share_id probe: rolled back';
  v_share    constant text := 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  v_other    constant text := '0f9e8d7c6b5a49382716f5e4d3c2b1a0';
  v_buyer    constant text := 'cs_test_selfcheck20261103130000buyer';
  v_grant    constant text := 'pro_00000000-0000-4000-8000-000000000103';
BEGIN
  IF NOT has_function_privilege('anon', 'public.delete_analysis_by_share_id(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.delete_analysis_by_share_id(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the success page lost delete_analysis_by_share_id; it calls it with the publishable key';
  END IF;
  IF pg_get_functiondef('public.delete_analysis_by_share_id(text)'::regprocedure) !~ 'purchased_content' THEN
    RAISE EXCEPTION 'delete_analysis_by_share_id does not ask for the purchase that redeemed the analysis';
  END IF;

  BEGIN
    INSERT INTO public.resume_analyses (analysis_result, share_id) VALUES ('{"probe": true}'::jsonb, v_share), ('{"probe": true}'::jsonb, v_other);
    INSERT INTO public.purchased_content (stripe_session_id, customer_email, product_type, product_name, generated_content)
    VALUES (v_buyer, 'selfcheck@example.invalid', 'full_analysis', 'Full Resume Analysis', jsonb_build_object('shareId', v_share)),
           (v_grant, 'selfcheck@example.invalid', 'full_analysis', 'Full Resume Analysis', jsonb_build_object('shareId', v_other));

    -- A forwarded link: the share id alone.
    BEGIN
      PERFORM public.delete_analysis_by_share_id(v_share);
      v_fail := coalesce(v_fail || '; ', '') || 'a bare share id was accepted';
    EXCEPTION WHEN raise_exception THEN
      NULL;
    END;
    -- Another purchase's reference beside this share id.
    v_ok := public.delete_analysis_by_share_id(v_share || ':' || v_grant);
    IF v_ok IS DISTINCT FROM false THEN
      v_fail := coalesce(v_fail || '; ', '') || 'another purchase''s reference deleted the analysis';
    END IF;
    SELECT count(*) INTO v_n FROM public.resume_analyses WHERE share_id IN (v_share, v_other);
    IF v_n <> 2 THEN
      v_fail := coalesce(v_fail || '; ', '') || 'a refused call deleted a row';
    END IF;
    -- The buyer's own pair, then a Pro grant's.
    v_ok := public.delete_analysis_by_share_id(v_share || ':' || v_buyer);
    IF v_ok IS DISTINCT FROM true OR EXISTS (SELECT 1 FROM public.resume_analyses WHERE share_id = v_share) THEN
      v_fail := coalesce(v_fail || '; ', '') || 'the buyer''s share id and purchase did not delete the analysis';
    END IF;
    v_ok := public.delete_analysis_by_share_id(v_other || ':' || v_grant);
    IF v_ok IS DISTINCT FROM true OR EXISTS (SELECT 1 FROM public.resume_analyses WHERE share_id = v_other) THEN
      v_fail := coalesce(v_fail || '; ', '') || 'a Pro grant''s share id and reference did not delete its analysis';
    END IF;

    RAISE EXCEPTION USING MESSAGE = v_sentinel;
  EXCEPTION WHEN others THEN
    IF SQLERRM <> v_sentinel THEN
      v_fail := coalesce(v_fail || '; ', '') || 'the probe could not run: ' || SQLERRM;
    END IF;
  END;
  IF v_fail IS NOT NULL THEN
    RAISE EXCEPTION 'delete_analysis_by_share_id does not behave as this file intends: %', v_fail;
  END IF;
  RAISE NOTICE 'self-verify 20261103130000: a share id alone deletes nothing; the purchase that redeemed the analysis deletes it';
END
$check$;
