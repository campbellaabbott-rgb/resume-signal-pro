-- A FUNNEL STAGE IS NOT A REPEAT OF THE LANDING.
--
-- WHAT WAS WRONG. Measured 2026-09-27T19:23Z, read-only, with the publishable
-- key: the cohort reader asked for the last 30 days answered 136,064 distinct
-- visitors at the landing stage (136,021 direct, 27 referral, 16 social) and
-- ZERO at every later stage -- upload started, upload completed, scan
-- started, scan completed, results viewed, product clicked, checkout started,
-- purchase completed. Control: 26 scans completed in the same window, so the
-- later stages happened and were not recorded.
--
-- WHY. This function is the only writer to ab_test_events. Its duplicate
-- check keyed on the test name, the visitor and the event type, and never on
-- the variant. The conversion funnel is ONE test name whose stages travel in
-- the variant column, and every stage but the purchase is an event of type
-- view. So once a visitor's landing had landed, every later stage that visitor
-- reached looked, to the check, like the same event again within its 24-hour
-- window: it was answered as a duplicate, never inserted, and the edge
-- function reports success either way, so no client could see it happen.
--
-- WHAT THIS FILE CHANGES. One conjunct is added to the duplicate check: the
-- stored variant must equal the variant being recorded. Two events that differ
-- only in variant are now two rows; the same event repeated within its window
-- is still one row.
--
-- WHAT THIS FILE DOES NOT CHANGE, deliberately, so that the before and after
-- figures compare like with like:
--   * the signature -- the same eight parameters, names, types and defaults --
--     so PostgREST resolves the edge function's named-argument call to this
--     definition and no second overload appears (the three migrations of
--     2025-12-24 are exactly that accident, and its clean-up);
--   * the rate-limit step, its window arithmetic and its answer;
--   * the dedup windows: 24 hours for an event of type view, 90 days for any
--     other event type;
--   * the columns inserted, and the three answers the function can return;
--   * SECURITY DEFINER and the pinned search_path.
--
-- GRANTS. The definition this replaces (20251224172817) carried no grant
-- statements of its own. The definer lockdown of 2026-07-30 then closed this
-- function to PUBLIC, anon and authenticated and opened it to service_role
-- only, which is the role the calling edge function builds its client with.
-- Replacing a function's body keeps the ACL it already has, so the two
-- statements at the end of this file change nothing on a database where the
-- lockdown ran; they are restated so this file says on its own who may call
-- what it defines, and so a database that never saw the lockdown ends up in
-- the same state.
--
-- INDEX. The dedup index over (test_name, visitor_id, event_type, created_at)
-- still serves the lookup; the added conjunct is evaluated on the rows it
-- returns. It is not widened here: one concern per file.

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
BEGIN
  -- Step 1: Rate limit check (inline, not separate call)
  v_window_start := date_trunc('hour', NOW()) - ((EXTRACT(MINUTE FROM NOW())::INT % p_window_minutes) * INTERVAL '1 minute');

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
    ELSE NOW() - INTERVAL '90 days'
  END;

  -- The key is the whole identity of an event: the test, the stage it names,
  -- the visitor and the type. A key that leaves the stage out collapses a
  -- visitor's funnel into its first step.
  IF EXISTS (
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

  -- Step 3: Insert the event
  INSERT INTO ab_test_events (test_name, variant, event_type, visitor_id, metadata)
  VALUES (p_test_name, p_variant, p_event_type, p_visitor_id, p_metadata);

  RETURN jsonb_build_object('success', true, 'status', 'recorded');
END;
$$;

REVOKE ALL ON FUNCTION public.track_ab_event_optimized(text, text, text, text, jsonb, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_ab_event_optimized(text, text, text, text, jsonb, text, integer, integer) TO service_role;
