-- RESUME-MATCH'S HOURLY ALLOWANCE COUNTS EVERY CALL AT ONCE (phase 0).
--
-- resume-match's only per-hour limits (30 matches an hour per network, 150
-- widening follow-ups, and a follow-up token's one use) ran on
-- check_rate_limit, which reads the count without a row lock and then writes
-- it, and on a new or expired window writes request_count = 1 for every
-- caller. A parallel burst from one network all passed: the cap limited how
-- fast calls arrived, not how many ran.
--
-- resume_match_rate_take counts and answers in ONE statement: an INSERT ...
-- ON CONFLICT DO UPDATE that adds one (or starts the window again when it has
-- expired) and RETURNS the count after the write, so concurrent callers queue
-- on the row and each sees its own number. A call over the cap is still
-- counted. Same table (rate_limits), same bounds as check_rate_limit, and its
-- 1,440-minute sweep still clears these rows.
--
-- SECURITY INVOKER: only the service role (resume-match) calls it, and the
-- service role writes rate_limits directly. Revoked from PUBLIC, anon and
-- authenticated by name; the DO block raises if a client role can execute it,
-- and proves the count: two allowed, the third refused, then cleans up.
--
-- Depends on rate_limits (20251216002238). Safe to run twice.

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'resume_match_rate_take' LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
  END LOOP;
END $$;

CREATE FUNCTION public.resume_match_rate_take(p_bucket text, p_function text, p_max integer, p_window_minutes integer DEFAULT 60)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_max IS NULL OR p_max < 1 OR p_max > 1000 THEN
    RAISE EXCEPTION 'resume_match_rate_take: p_max must be 1 to 1000';
  END IF;
  IF p_window_minutes IS NULL OR p_window_minutes < 1 OR p_window_minutes > 1440 THEN
    RAISE EXCEPTION 'resume_match_rate_take: p_window_minutes must be 1 to 1440';
  END IF;
  IF p_bucket IS NULL OR length(p_bucket) > 45 THEN
    RAISE EXCEPTION 'resume_match_rate_take: invalid bucket';
  END IF;
  IF p_function IS NULL OR length(p_function) > 100 THEN
    RAISE EXCEPTION 'resume_match_rate_take: invalid function name';
  END IF;
  INSERT INTO public.rate_limits AS r (ip_address, function_name, request_count, window_start)
  VALUES (p_bucket, p_function, 1, now())
  ON CONFLICT (ip_address, function_name) DO UPDATE SET
    request_count = CASE WHEN r.window_start < now() - make_interval(mins => p_window_minutes) THEN 1 ELSE r.request_count + 1 END,
    window_start = CASE WHEN r.window_start < now() - make_interval(mins => p_window_minutes) THEN now() ELSE r.window_start END
  RETURNING r.request_count INTO v_count;
  RETURN v_count <= p_max;
END;
$$;

REVOKE ALL ON FUNCTION public.resume_match_rate_take(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resume_match_rate_take(text, text, integer, integer) TO service_role;

DO $$
DECLARE
  v_n integer;
  v_a boolean;
  v_b boolean;
  v_c boolean;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'resume_match_rate_take';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'resume_match_rate_take has % signatures; a named-argument call would be ambiguous', v_n;
  END IF;
  IF has_function_privilege('anon', 'public.resume_match_rate_take(text, text, integer, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.resume_match_rate_take(text, text, integer, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'resume_match_rate_take is executable by a client role';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.resume_match_rate_take(text, text, integer, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'resume_match_rate_take is not executable by service_role, which resume-match calls as';
  END IF;
  v_a := public.resume_match_rate_take('zq-selfcheck', 'resume-match-selfcheck', 2, 60);
  v_b := public.resume_match_rate_take('zq-selfcheck', 'resume-match-selfcheck', 2, 60);
  v_c := public.resume_match_rate_take('zq-selfcheck', 'resume-match-selfcheck', 2, 60);
  DELETE FROM public.rate_limits WHERE ip_address = 'zq-selfcheck' AND function_name = 'resume-match-selfcheck';
  IF NOT (v_a AND v_b AND NOT v_c) THEN
    RAISE EXCEPTION 'resume_match_rate_take answered %, %, % for three calls under a cap of 2 (want allowed, allowed, refused)', v_a, v_b, v_c;
  END IF;
END $$;
