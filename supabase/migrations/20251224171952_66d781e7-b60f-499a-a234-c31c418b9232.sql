-- Create optimized single-call function for A/B event tracking
-- Combines rate limiting, deduplication, and insertion in one atomic operation
CREATE OR REPLACE FUNCTION public.track_ab_event_optimized(
  p_test_name TEXT,
  p_variant TEXT,
  p_event_type TEXT,
  p_visitor_id UUID,
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
  v_is_rate_limited BOOLEAN := false;
  v_is_duplicate BOOLEAN := false;
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
    v_is_rate_limited := true;
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
  
  IF EXISTS (
    SELECT 1 FROM ab_test_events
    WHERE test_name = p_test_name
      AND visitor_id = p_visitor_id
      AND event_type = p_event_type
      AND created_at >= v_dedup_threshold
    LIMIT 1
  ) THEN
    v_is_duplicate := true;
    RETURN jsonb_build_object('success', true, 'status', 'duplicate');
  END IF;
  
  -- Step 3: Insert the event
  INSERT INTO ab_test_events (test_name, variant, event_type, visitor_id, metadata)
  VALUES (p_test_name, p_variant, p_event_type, p_visitor_id, p_metadata);
  
  RETURN jsonb_build_object('success', true, 'status', 'recorded');
END;
$$;

-- Add index to speed up deduplication lookups
CREATE INDEX IF NOT EXISTS idx_ab_test_events_dedup 
ON ab_test_events (test_name, visitor_id, event_type, created_at DESC);

-- Add index for rate limit lookups
CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup
ON rate_limits (function_name, ip_address);