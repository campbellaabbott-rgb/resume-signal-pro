-- A WINDOW OF SIXTY MINUTES IS NOT SIXTY WINDOWS OF ONE.
--
-- WHAT WAS WRONG. The rate-limit step of this writer keys its counter on a
-- window start it derives from the clock, and the derivation subtracted the
-- current minute-of-hour modulo the window length from the top of the hour.
-- With the sixty-minute window every caller passes, that value moves every
-- wall-clock minute (19:23 gives 18:37, 19:24 gives 18:36), and the counter's
-- upsert resets the count to one whenever the stored window start differs
-- from the one just derived. So the counter never saw a second minute: a
-- cap of fifty an hour was fifty a MINUTE, and the two-tier budget shipped
-- on 2026-09-27 wrote an address ceiling of twelve hundred an hour that the
-- database enforced as twelve hundred a minute. Evaluated in a real Postgres
-- at four fixed instants inside one hour, the old derivation gave four
-- different keys. Reviewed and upheld by three independent readers of the
-- build before this file was written.
--
-- WHAT THIS FILE CHANGES. One statement in the body: the window start is now
-- the instant the current window began, found by flooring the clock to a
-- multiple of the window length counted from the Unix epoch. For a
-- sixty-minute window that is the top of the current hour, whatever the
-- session time zone; for a fifteen-minute window it is the quarter-hour. Two
-- calls a minute apart inside one window now increment the same counter, and
-- a call in the next window resets it, which is what the parameters have
-- always claimed.
--
-- A side effect that also goes away: check_rate_limit, which the visitor tier
-- of the same budget calls first, sweeps rate_limits rows whose window start
-- is older than sixty minutes on one call in a hundred. Under the old
-- derivation this writer's rows were stamped up to fifty-nine minutes into
-- the past the moment they were written, so in the second half of every hour
-- the visitor tier's sweep could remove the address counter mid-minute. A
-- row stamped at the window's true start is never older than the window.
--
-- WHAT THIS FILE DOES NOT CHANGE, so the guard that compares this definition
-- with the one before it finds exactly one statement moved: the eight
-- parameters and their defaults, the rate-limit lookup and its upsert, the
-- duplicate check and its two windows (twenty-four hours for a view, ninety
-- days otherwise) with the variant conjunct that 20260927192417 added, the
-- columns inserted, the three answers, SECURITY DEFINER and the pinned
-- search_path.
--
-- GRANTS. Restated, as the definition before this one restates them: closed
-- to PUBLIC, anon and authenticated by name, open to service_role, which is
-- the role the calling edge function builds its client with. Replacing a
-- function's body keeps its ACL, so on a database that ran the 2026-07-30
-- lockdown these two statements change nothing.

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
