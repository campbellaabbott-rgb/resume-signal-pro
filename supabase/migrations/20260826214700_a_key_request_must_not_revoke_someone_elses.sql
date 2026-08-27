-- Anyone could revoke anyone's API key by typing their email address.
--
-- api_key_issue REVOKED every active key for an address before minting a new
-- one, and api-key-request is unauthenticated by necessity — it is where a
-- developer with no account gets their first credential. Together that is an
-- unauthenticated denial of service against any customer whose address you can
-- guess: POST their email, their working key stops answering, and the
-- replacement is handed to YOU in the response.
--
-- Rotation was the right instinct for the wrong threat. It was written to answer
-- "I lost my key", and it does — but it made losing a key something a stranger
-- could do on your behalf.
--
-- TWO CHANGES, and the second is what actually closes it:
--
--  1. A request NEVER revokes. Keys accumulate to a small cap instead, so the
--     worst a stranger can do is consume some of an address's daily allowance —
--     annoying, and nothing like taking away a live credential. Deliberate
--     rotation stays available; it just is not a side effect of a form post.
--
--  2. `had_active` tells the caller whether this address already had a working
--     key. api-key-request uses it to decide whether the new key may be shown
--     in the HTTP RESPONSE or only emailed. A first request stays frictionless
--     — key on screen, paste it into a terminal. A request for an address that
--     already has one goes to the inbox only, so obtaining a key for an address
--     requires reading that address's mail.
--
-- The per-address ceiling still stands in front of both, and is still counted
-- on the address rather than the IP: shared egress would divide one allowance
-- among everyone behind it, the defect already recorded against parse-pdf.
--
-- DROP + CREATE because the return shape changes (was_rotated -> had_active).
-- Input signature is unchanged, so no overload and no PGRST203 risk. OUT names
-- are checked against api_keys' columns for the 42702 trap that cost this
-- schema a working API for its first hour.
DROP FUNCTION IF EXISTS public.api_key_issue(text, text, text, text);

CREATE FUNCTION public.api_key_issue(
  p_email text,
  p_name text,
  p_key_hash text,
  p_key_prefix text
)
RETURNS TABLE (
  issued boolean,
  deny_reason text,
  api_key_id uuid,
  key_tier text,
  rate_limit integer,
  quota_limit integer,
  had_active boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_today integer;
  v_active integer;
  v_id uuid;
  c_rate integer := 60;
  c_quota integer := 1000;
  c_tier text := 'free';
  c_max_active integer := 3;
BEGIN
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RETURN QUERY SELECT false, 'invalid_email', NULL::uuid, NULL::text, 0, 0, false; RETURN;
  END IF;

  SELECT count(*) INTO v_today
  FROM public.api_keys ak
  WHERE lower(ak.owner_email) = v_email AND ak.created_at > now() - interval '24 hours';

  IF v_today >= 3 THEN
    RETURN QUERY SELECT false, 'too_many_requests', NULL::uuid, NULL::text, 0, 0, false; RETURN;
  END IF;

  SELECT count(*) INTO v_active
  FROM public.api_keys ak
  WHERE lower(ak.owner_email) = v_email AND ak.revoked_at IS NULL;

  -- Cap rather than revoke. An address that has hit the cap must retire one of
  -- its own keys, which is an act only the owner can perform.
  IF v_active >= c_max_active THEN
    RETURN QUERY SELECT false, 'too_many_active_keys', NULL::uuid, NULL::text, 0, 0, true; RETURN;
  END IF;

  INSERT INTO public.api_keys (key_hash, key_prefix, name, owner_email, tier, rate_per_min, daily_quota)
  VALUES (p_key_hash, p_key_prefix, coalesce(nullif(btrim(p_name), ''), 'Untitled key'), v_email, c_tier, c_rate, c_quota)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT true, 'issued', v_id, c_tier, c_rate, c_quota, (v_active > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.api_key_issue(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_issue(text, text, text, text) TO service_role;

-- ── The daily quota was read-then-check while the per-minute limit was atomic ──
--
-- api_key_check increments the MINUTE bucket with an upsert that returns the new
-- value, so two concurrent calls cannot both read the last allowed number and
-- both pass. The DAY quota was checked with a SELECT SUM before any write, so
-- concurrent calls at the boundary can all observe the same under-quota total
-- and all proceed — a customer at 1,000/1,000 serving an unbounded burst.
--
-- Fixed by giving the day the same shape the minute already had: one counter
-- row per key per day, incremented by the upsert that reads it. api_usage stays
-- exactly as it is — it is the per-ENDPOINT metering a customer's invoice would
-- be built from, and summing it was never the right way to enforce a limit.
CREATE TABLE IF NOT EXISTS public.api_quota (
  key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  day date NOT NULL,
  calls integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, day)
);
ALTER TABLE public.api_quota ENABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS public.api_key_check(text, text);

CREATE FUNCTION public.api_key_check(
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
  IF k.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'revoked', k.id, k.tier, k.rate_per_min, 0, k.daily_quota, 0; RETURN;
  END IF;

  -- The increment IS the read, for the day exactly as for the minute.
  INSERT INTO public.api_quota AS q (key_id, day, calls) VALUES (k.id, v_day, 1)
  ON CONFLICT (key_id, day) DO UPDATE SET calls = q.calls + 1
  RETURNING q.calls INTO v_day_used;

  IF v_day_used > k.daily_quota THEN
    -- Counted and refused, the same stance the minute bucket takes: hammering
    -- past a limit must not buy a cheaper day.
    RETURN QUERY SELECT false, 'quota_exceeded', k.id, k.tier, k.rate_per_min, 0, k.daily_quota, v_day_used; RETURN;
  END IF;

  INSERT INTO public.api_rate AS r (key_id, minute, calls) VALUES (k.id, v_minute, 1)
  ON CONFLICT (key_id, minute) DO UPDATE SET calls = r.calls + 1
  RETURNING r.calls INTO v_rate;

  IF v_rate > k.rate_per_min THEN
    RETURN QUERY SELECT false, 'rate_limited', k.id, k.tier, k.rate_per_min, v_rate, k.daily_quota, v_day_used; RETURN;
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

REVOKE ALL ON FUNCTION public.api_key_check(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_check(text, text) TO service_role;
