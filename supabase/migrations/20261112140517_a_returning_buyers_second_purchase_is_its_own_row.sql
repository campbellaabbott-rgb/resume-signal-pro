-- A RETURNING BUYER'S SECOND PURCHASE IS ITS OWN ROW, AND A PURCHASE THE
-- PAYMENT SIDE NEVER SAW CAN BE TOLD APART (S14X-153, S14X-154).
--
-- WHAT WAS WRONG (M-S14-128). The analytics writer refuses an event it has
-- already seen inside a window, and for every conversion that window was
-- ninety days on (test, variant, visitor, type). A purchase is a conversion.
-- So a buyer who came back and paid again within ninety days was answered
-- "duplicate" for the second purchase, in the funnel's purchase_completed
-- stage, in product_conversion and in every A/B test the buyer was in: the
-- owner's funnel counted one sale where the payment side took two. The
-- client already sends the Stripe Checkout session with every purchase
-- (stripeSessionId on the funnel stage, sessionId on the product and A/B
-- conversions), and one session is one purchase.
--
-- And the sign-in funnel is sent as conversions (auth_funnel), so a person
-- who signed in on Monday and again on Wednesday was one sign-in for ninety
-- days.
--
-- WHAT THE WRITER DOES NOW. One statement block changes.
--   - A conversion that names a Stripe Checkout session (cs_test_ or cs_live_)
--     is a repeat only of a row of the same test, variant and type for the
--     SAME session, at any age, whoever sent it. A second session is a second
--     row; the same session sent again (a reload of the success page, the
--     same purchase opened in another browser) stays one row. The session is
--     read from stripeSessionId, else from sessionId, except in the
--     conversion funnel, whose sessionId is the funnel's own tab id.
--   - A conversion without a Stripe session keeps today's key and window.
--   - auth_funnel's window is a day, like a view's. The browser's own repeat
--     window (twelve hours, src/lib/track-transport.ts) stays under the
--     writer's shortest, which a guard reads from this definition.
--   - The rate counter, the window expression, the view window, the columns
--     inserted, the three answers, the parameters, SECURITY DEFINER and the
--     pinned search_path are unchanged. The first duplicate check keeps its
--     exact predicate, so the guard that holds the event's whole identity in
--     it still reads the same conjuncts.
--
-- WHAT IS NEW (M-S14-129). ab_purchase_known(session) says whether a Stripe
-- Checkout session is one this site minted (checkout_starts, written by every
-- checkout function before the browser gets the url) or redeemed
-- (used_stripe_sessions). The track-ab-event function asks it before it
-- records a purchase conversion, so a purchase typed by hand into the public
-- endpoint is answered "unverified" and stored nowhere. It answers a yes or a
-- no and nothing else, and only the service role may call it.
--
-- COST. The session check runs only for a conversion that names a session,
-- which is a purchase; it narrows by the (test_name, variant) index and reads
-- the few conversion rows there. No index is created or dropped.
--
-- GRANTS. Both functions are closed to PUBLIC, anon and authenticated by name
-- and open to service_role. A replaced body keeps its ACL, so for the writer
-- this restates what the 2026-07-30 lockdown already holds.
--
-- Apply BEFORE the track-ab-event deploy that asks ab_purchase_known. The
-- function fails open when the helper is missing, so the other order is safe
-- for data; the purchase check simply starts when both are live.
--
-- Safe to re-run: two CREATE OR REPLACE, restated grants, and a self-check
-- whose probe writes are rolled back.

CREATE OR REPLACE FUNCTION public.track_ab_event_optimized(
  p_test_name TEXT,
  p_variant TEXT,
  p_event_type TEXT,
  p_visitor_id TEXT,
  p_metadata JSONB DEFAULT '{}',
  p_client_ip TEXT DEFAULT 'unknown',
  p_max_requests INT DEFAULT 50,
  p_window_minutes INT DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_current_count INT;
  v_dedup_threshold TIMESTAMPTZ;
  v_purchase TEXT;
BEGIN
  -- Step 1: Rate limit check (inline, not separate call)
  v_window_start := to_timestamp(floor(EXTRACT(EPOCH FROM NOW()) / (p_window_minutes * 60)) * (p_window_minutes * 60));

  SELECT request_count INTO v_current_count
  FROM rate_limits
  WHERE function_name = 'track-ab-event'
    AND ip_address = p_client_ip
    AND window_start = v_window_start;

  IF v_current_count IS NOT NULL AND v_current_count >= p_max_requests THEN
    RETURN jsonb_build_object('success', true, 'status', 'rate_limited');
  END IF;

  -- Update/insert rate limit counter
  INSERT INTO rate_limits (function_name, ip_address, window_start, request_count)
  VALUES ('track-ab-event', p_client_ip, v_window_start, 1)
  ON CONFLICT (function_name, ip_address)
  DO UPDATE SET
    request_count = CASE
      WHEN rate_limits.window_start = v_window_start
      THEN rate_limits.request_count + 1
      ELSE 1
    END,
    window_start = v_window_start;

  -- Step 2: Deduplication check (inline, not separate call)
  v_dedup_threshold := CASE
    WHEN p_event_type = 'view' THEN NOW() - INTERVAL '24 hours'
    WHEN p_test_name = 'auth_funnel' THEN NOW() - INTERVAL '24 hours'
    ELSE NOW() - INTERVAL '90 days'
  END;

  -- A purchase is named by its Stripe Checkout session: one session, one row.
  v_purchase := CASE
    WHEN p_event_type <> 'conversion' THEN NULL
    WHEN (p_metadata->>'stripeSessionId') ~ '^cs_(test|live)_' THEN p_metadata->>'stripeSessionId'
    WHEN p_test_name <> 'conversion_funnel' AND (p_metadata->>'sessionId') ~ '^cs_(test|live)_' THEN p_metadata->>'sessionId'
    ELSE NULL
  END;

  -- The key is the whole identity of an event: the test, the stage it names,
  -- the visitor and the type. A key that leaves the stage out collapses a
  -- visitor's funnel into its first step.
  IF v_purchase IS NULL AND EXISTS (
    SELECT 1 FROM ab_test_events
    WHERE test_name = p_test_name
      AND variant = p_variant
      AND visitor_id = p_visitor_id
      AND event_type = p_event_type
      AND created_at >= v_dedup_threshold
    LIMIT 1
  ) THEN
    RETURN jsonb_build_object('success', true, 'status', 'duplicate');
  END IF;

  -- A purchase is a repeat only of the same purchase, at any age.
  IF v_purchase IS NOT NULL AND EXISTS (
    SELECT 1 FROM ab_test_events
    WHERE test_name = p_test_name
      AND variant = p_variant
      AND event_type = p_event_type
      AND (metadata->>'stripeSessionId' = v_purchase OR metadata->>'sessionId' = v_purchase)
    LIMIT 1
  ) THEN
    RETURN jsonb_build_object('success', true, 'status', 'duplicate');
  END IF;

  -- Step 3: Insert the event
  INSERT INTO ab_test_events (test_name, variant, event_type, visitor_id, metadata)
  VALUES (p_test_name, p_variant, p_event_type, p_visitor_id, p_metadata);

  RETURN jsonb_build_object('success', true, 'status', 'recorded');
END;
$$;

REVOKE ALL ON FUNCTION public.track_ab_event_optimized(text, text, text, text, jsonb, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_ab_event_optimized(text, text, text, text, jsonb, text, integer, integer) TO service_role;

-- Is this a Stripe Checkout session the site minted or redeemed? A yes or a
-- no; nothing about the session is returned.
CREATE OR REPLACE FUNCTION public.ab_purchase_known(p_session_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_session_id IS NULL OR p_session_id !~ '^cs_(test|live)_' OR char_length(p_session_id) > 255 THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM checkout_starts WHERE stripe_session_id = p_session_id)
      OR EXISTS (SELECT 1 FROM used_stripe_sessions WHERE session_id = p_session_id);
END;
$$;

REVOKE ALL ON FUNCTION public.ab_purchase_known(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ab_purchase_known(text) TO service_role;

-- SELF-CHECK. Raises, and so undoes this file, unless both functions are
-- what this file says. The writer's behaviour is probed inside a block whose
-- writes are always rolled back: a purchase planted forty days ago does not
-- hold a second purchase, and the second purchase sent again is a repeat.
DO $check$
DECLARE
  v_writer regprocedure := to_regprocedure('public.track_ab_event_optimized(text, text, text, text, jsonb, text, integer, integer)');
  v_known regprocedure := to_regprocedure('public.ab_purchase_known(text)');
  v_first TEXT;
  v_again TEXT;
  v_role TEXT;
BEGIN
  IF v_writer IS NULL THEN RAISE EXCEPTION 'self-check: the analytics writer is missing'; END IF;
  IF v_known IS NULL THEN RAISE EXCEPTION 'self-check: ab_purchase_known is missing'; END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'track_ab_event_optimized') <> 1 THEN
    RAISE EXCEPTION 'self-check: the analytics writer has more than one overload';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_writer) OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_known) THEN
    RAISE EXCEPTION 'self-check: a function is not SECURITY DEFINER';
  END IF;
  IF NOT coalesce((SELECT 'search_path=public' = ANY (proconfig) FROM pg_proc WHERE oid = v_known), false) THEN
    RAISE EXCEPTION 'self-check: ab_purchase_known has no pinned search_path';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(v_role, v_writer, 'EXECUTE') OR has_function_privilege(v_role, v_known, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: % may execute a service-only function', v_role;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', v_known, 'EXECUTE') OR NOT has_function_privilege('service_role', v_writer, 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: service_role may not execute a function it calls';
  END IF;
  IF public.ab_purchase_known('not_a_session') OR public.ab_purchase_known(NULL) THEN
    RAISE EXCEPTION 'self-check: ab_purchase_known said yes to something that is not a session';
  END IF;
  IF to_regclass('public.checkout_starts') IS NOT NULL AND to_regclass('public.used_stripe_sessions') IS NOT NULL
     AND public.ab_purchase_known('cs_test_rb_self_check_never_minted') THEN
    RAISE EXCEPTION 'self-check: ab_purchase_known said yes to a session nobody minted';
  END IF;

  BEGIN
    INSERT INTO ab_test_events (test_name, variant, event_type, visitor_id, metadata, created_at)
    VALUES ('rb_self_check', 'purchase_completed', 'conversion', 'rb-self-check-visitor',
            '{"stripeSessionId": "cs_test_rb_self_check_a"}'::jsonb, now() - INTERVAL '40 days');
    v_first := public.track_ab_event_optimized('rb_self_check', 'purchase_completed', 'conversion', 'rb-self-check-visitor',
      '{"stripeSessionId": "cs_test_rb_self_check_b"}'::jsonb, 'rb-self-check', 1000, 60)->>'status';
    v_again := public.track_ab_event_optimized('rb_self_check', 'purchase_completed', 'conversion', 'rb-self-check-other',
      '{"stripeSessionId": "cs_test_rb_self_check_b"}'::jsonb, 'rb-self-check', 1000, 60)->>'status';
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rb-self-check-rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'rb-self-check-rollback' THEN RAISE; END IF;
  END;
  IF v_first IS DISTINCT FROM 'recorded' THEN
    RAISE EXCEPTION 'self-check: a second purchase was answered % instead of recorded', v_first;
  END IF;
  IF v_again IS DISTINCT FROM 'duplicate' THEN
    RAISE EXCEPTION 'self-check: the same purchase sent again was answered % instead of duplicate', v_again;
  END IF;
  IF EXISTS (SELECT 1 FROM ab_test_events WHERE test_name = 'rb_self_check')
     OR EXISTS (SELECT 1 FROM rate_limits WHERE function_name = 'track-ab-event' AND ip_address = 'rb-self-check') THEN
    RAISE EXCEPTION 'self-check: the probe left a row behind';
  END IF;
END
$check$;
