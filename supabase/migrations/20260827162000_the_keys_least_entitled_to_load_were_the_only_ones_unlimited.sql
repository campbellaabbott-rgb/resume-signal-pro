-- A revoked or exhausted key was the only kind not rate limited.
--
-- api_key_check incremented the MINUTE bucket last — after the revoked check and
-- after the daily quota check had each already returned. So the two kinds of key
-- least entitled to load were completely exempt from the rate limiter: either
-- could hammer the endpoint as fast as it liked, unmetered, against a
-- service-role connection.
--
-- And every refusal they received reported `rate_used = 0`. The 429 told the
-- client it had its full per-minute budget remaining — which is precisely the
-- number a well-behaved client's retry logic reads before deciding how hard to
-- come back. The headers were not merely missing; they were wrong in the
-- direction that causes more load.
--
-- The order is now: count the minute -> refuse if over the minute -> refuse if
-- revoked -> count the day -> refuse if over the day. A revoked key is counted
-- (so it can be limited) but does not consume a daily quota it no longer has,
-- and every refusal carries the real v_rate.
--
-- CREATE OR REPLACE: the signature and the RETURNS TABLE type are both
-- unchanged, so no overload can be created here. Body carried forward from
-- 20260826214700 and patched programmatically rather than retyped — this is the
-- function whose OUT parameters, named after real columns, 42702'd every
-- authenticated call once already.

CREATE OR REPLACE FUNCTION public.api_key_check(
  p_key_hash text,
  p_endpoint text
)
RETURNS TABLE (
  is_allowed boolean,
  deny_reason text,
  api_key_id uuid,
  key_tier text,
  rate_limit integer,
  rate_used integer,
  quota_limit integer,
  quota_used integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  k RECORD;
  v_minute timestamptz := date_trunc('minute', now());
  v_day date := (now() AT TIME ZONE 'utc')::date;
  v_rate integer;
  v_day_used integer;
BEGIN
  SELECT ak.id, ak.tier, ak.rate_per_min, ak.daily_quota, ak.revoked_at
    INTO k
  FROM public.api_keys ak
  WHERE ak.key_hash = p_key_hash;

  IF k.id IS NULL THEN
    RETURN QUERY SELECT false, 'unknown_key', NULL::uuid, NULL::text, 0, 0, 0, 0; RETURN;
  END IF;
  -- THE MINUTE BUCKET IS COUNTED FIRST, BEFORE ANY REFUSAL CAN RETURN.
  --
  -- It used to be incremented last, after the revoked check and after the daily
  -- quota check had both already returned — so a revoked key and an exhausted
  -- key were COMPLETELY EXEMPT from the rate limiter. Either could hammer the
  -- endpoint as fast as it liked, unmetered, against a service-role connection,
  -- and every refusal it received reported `rate_used = 0`: a 429 telling the
  -- client it had its full budget left, which is the one number retry logic
  -- reads. The keys least entitled to load were the only ones not limited.
  --
  -- Counted and then refused, which is the stance the day bucket already took:
  -- hammering past a limit must not buy a cheaper minute.
  INSERT INTO public.api_rate AS r (key_id, minute, calls) VALUES (k.id, v_minute, 1)
  ON CONFLICT (key_id, minute) DO UPDATE SET calls = r.calls + 1
  RETURNING r.calls INTO v_rate;

  IF v_rate > k.rate_per_min THEN
    RETURN QUERY SELECT false, 'rate_limited', k.id, k.tier, k.rate_per_min, v_rate, k.daily_quota, 0; RETURN;
  END IF;

  -- Revoked AFTER the minute bucket so the refusal is counted, but BEFORE the
  -- day bucket: a revoked key must not consume a quota it no longer has. Its
  -- headers now carry the real v_rate instead of a fabricated zero.
  IF k.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'revoked', k.id, k.tier, k.rate_per_min, v_rate, k.daily_quota, 0; RETURN;
  END IF;

  -- The increment IS the read, for the day exactly as for the minute.
  INSERT INTO public.api_quota AS q (key_id, day, calls) VALUES (k.id, v_day, 1)
  ON CONFLICT (key_id, day) DO UPDATE SET calls = q.calls + 1
  RETURNING q.calls INTO v_day_used;

  IF v_day_used > k.daily_quota THEN
    RETURN QUERY SELECT false, 'quota_exceeded', k.id, k.tier, k.rate_per_min, v_rate, k.daily_quota, v_day_used; RETURN;
  END IF;

  -- Per-endpoint metering, unchanged. This is what an invoice is built from; it
  -- is no longer what the limit is enforced with.
  INSERT INTO public.api_usage AS u (key_id, day, endpoint, calls) VALUES (k.id, v_day, p_endpoint, 1)
  ON CONFLICT (key_id, day, endpoint) DO UPDATE SET calls = u.calls + 1;

  UPDATE public.api_keys ak SET last_used_at = now() WHERE ak.id = k.id;
  DELETE FROM public.api_rate r WHERE r.minute < now() - interval '10 minutes';

  RETURN QUERY SELECT true, 'ok', k.id, k.tier, k.rate_per_min, v_rate, k.daily_quota, v_day_used;
END;
$$;
-- SERVICE ROLE ONLY, restated. CREATE OR REPLACE preserves grants, but this
-- function decides whether a caller is allowed and spends their quota — leaving
-- its access rules implicit in a previous migration is how a definer function
-- ends up anon-callable. 107 of 121 were, once.
REVOKE ALL ON FUNCTION public.api_key_check(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_check(text, text) TO service_role;
