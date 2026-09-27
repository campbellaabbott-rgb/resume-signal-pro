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