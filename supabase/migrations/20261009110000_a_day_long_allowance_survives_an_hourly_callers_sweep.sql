-- A DAY-LONG ALLOWANCE SURVIVES AN HOURLY CALLER'S SWEEP (sweep S8-011).
--
-- check_rate_limit (20251219200654, the live definition until this file)
-- swept, on one call in a hundred, every rate_limits row older than the
-- CALLING function's window, whoever wrote it. Every caller passes 60 minutes
-- or more, and track-ab-event calls it on every analytics event, so a
-- 1,440-minute row was deleted about an hour after it started and its count
-- began again. Every "per day" allowance on this limiter was really hourly:
-- the free scan's 7 a day, a purchase's 10 generator calls a day
-- (purchaseSpendGate: premium package and its stream, keyword fix, snapshot,
-- game plan, cover-letter stream, freelance boost), and the 1,440-minute
-- per-address caps of parse-resume-structured and import-freelance-profile.
-- In pglite with the dice loaded, 10 calls were allowed, the 11th refused,
-- and after one 60-minute caller's sweep 10 more were allowed.
--
-- The sweep now deletes only rows no caller can still be counting: older than
-- 1,440 minutes, the longest window the function accepts. Everything else is
-- the 20251219200654 body unchanged. Grants re-stated as the definer lockdown
-- (20260730070000) left them: the service role only.
--
-- Depends on: rate_limits (20251216002238). Safe to re-run.
-- Verify: src/test/a-day-allowance-the-limiter-sweeps-is-an-hour.test.ts runs
-- this definition in pglite; the DO block below checks the live catalogue.

CREATE OR REPLACE FUNCTION public.check_rate_limit(p_ip text, p_function text, p_max_requests integer, p_window_minutes integer DEFAULT 60)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count INT;
  v_window_start TIMESTAMPTZ;
  v_window_cutoff TIMESTAMPTZ;
BEGIN
  -- Validate input bounds (defense-in-depth)
  IF p_max_requests < 1 OR p_max_requests > 1000 THEN
    RAISE EXCEPTION 'Invalid rate limit value';
  END IF;
  IF p_window_minutes < 1 OR p_window_minutes > 1440 THEN
    RAISE EXCEPTION 'Invalid time window value';
  END IF;
  IF p_ip IS NULL OR length(p_ip) > 45 THEN
    RAISE EXCEPTION 'Invalid IP address';
  END IF;
  IF p_function IS NULL OR length(p_function) > 100 THEN
    RAISE EXCEPTION 'Invalid function name';
  END IF;

  v_window_cutoff := NOW() - (p_window_minutes || ' minutes')::INTERVAL;

  -- Clean up periodically (1% chance per call), only rows older than the
  -- longest window any caller may pass, so no allowance is cut short.
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits WHERE window_start < NOW() - INTERVAL '1440 minutes';
  END IF;

  -- Try to get existing record
  SELECT request_count, window_start INTO v_count, v_window_start
  FROM public.rate_limits
  WHERE ip_address = p_ip AND function_name = p_function;

  -- No record found or window expired - create/reset
  IF NOT FOUND OR v_window_start < v_window_cutoff THEN
    INSERT INTO public.rate_limits (ip_address, function_name, request_count, window_start)
    VALUES (p_ip, p_function, 1, NOW())
    ON CONFLICT (ip_address, function_name)
    DO UPDATE SET request_count = 1, window_start = NOW();
    RETURN TRUE;
  END IF;

  -- Check if limit exceeded
  IF v_count >= p_max_requests THEN
    RETURN FALSE;
  END IF;

  -- Increment counter
  UPDATE public.rate_limits
  SET request_count = request_count + 1
  WHERE ip_address = p_ip AND function_name = p_function;

  RETURN TRUE;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_rate_limit(text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_rate_limit(text, text, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.check_rate_limit(text, text, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer) TO service_role;

DO $verify$
DECLARE
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src
  FROM pg_proc p
  WHERE p.oid = 'public.check_rate_limit(text, text, integer, integer)'::regprocedure;
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'check_rate_limit(text, text, integer, integer) is missing';
  END IF;
  IF position('INTERVAL ''1440 minutes''' IN v_src) = 0 THEN
    RAISE EXCEPTION 'check_rate_limit does not sweep by the longest window';
  END IF;
  IF v_src ~ 'window_start\s*<\s*v_window_cutoff\s*;' THEN
    RAISE EXCEPTION 'check_rate_limit still sweeps by the calling function''s window';
  END IF;
  IF has_function_privilege('anon', 'public.check_rate_limit(text, text, integer, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.check_rate_limit(text, text, integer, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'check_rate_limit is callable by a client role';
  END IF;
END
$verify$;
