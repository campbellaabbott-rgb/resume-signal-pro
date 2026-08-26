-- The public data API: keys, per-key limits, and metering.
--
-- /data-api has been a mailto page since it shipped ("no self-serve keys until
-- there's a customer to justify it"). This is the storage half of making it
-- real. Nothing here changes an existing surface.
--
-- ITS OWN LIMITER, ON PURPOSE — it must never touch `rate_limits`.
-- check_global_rate_limit sums request_count across every rate_limits row for
-- an IP, and 20260803170000 had to SCOPE that sum to five functions after
-- board browsing silently 429'd résumé upload and Stripe checkout. An API
-- serving machine traffic at machine rates is the most effective way possible
-- to re-create that starvation, so it counts in tables of its own and is keyed
-- on the API KEY, not the IP. Two callers behind one NAT are two budgets here,
-- which is also the correct answer for an API.
--
-- THE RAW KEY IS NEVER STORED. Only sha256(key). A leaked database backup
-- therefore leaks no working credential, and there is no "show me the key
-- again" path — reissue instead. key_prefix exists so a human can tell two
-- keys apart in a list without the secret.
CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  name text NOT NULL,
  owner_email text NOT NULL,
  tier text NOT NULL DEFAULT 'trial',
  rate_per_min integer NOT NULL DEFAULT 60,
  daily_quota integer NOT NULL DEFAULT 1000,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  notes text
);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
-- No policy is deliberate: RLS on with zero policies denies anon and
-- authenticated outright, and the service role bypasses RLS. A key table that
-- any board visitor could select is not a key table.
COMMENT ON TABLE public.api_keys IS 'Public data-API credentials. Service-role only; raw keys are never stored, only sha256.';

-- Metering: one row per key per day per endpoint. Deliberately coarse — this
-- answers "what is this customer using and should they be on a bigger tier",
-- not "replay their traffic". No IPs, no query strings, no user agents.
CREATE TABLE IF NOT EXISTS public.api_usage (
  key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  day date NOT NULL,
  endpoint text NOT NULL,
  calls integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, day, endpoint)
);
ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;

-- Rate buckets: one row per key per minute, swept by the checker itself.
CREATE TABLE IF NOT EXISTS public.api_rate (
  key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  minute timestamptz NOT NULL,
  calls integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, minute)
);
ALTER TABLE public.api_rate ENABLE ROW LEVEL SECURITY;

-- ONE ROUND TRIP FOR AUTH + RATE + QUOTA + METER.
--
-- Doing these as four statements from the edge function would leave four ways
-- to half-apply a request: counted but refused, allowed but unmetered, and so
-- on. It is one SECURITY DEFINER function so the whole decision is atomic, and
-- so the edge function needs no direct grant on the key table.
--
-- Returns the decision AND the numbers behind it, because the response has to
-- carry X-RateLimit headers and a refusal that does not say what it refused on
-- is a support ticket.
CREATE OR REPLACE FUNCTION public.api_key_check(
  p_key_hash text,
  p_endpoint text
)
RETURNS TABLE (
  allowed boolean,
  reason text,
  key_id uuid,
  tier text,
  rate_limit integer,
  rate_used integer,
  daily_quota integer,
  daily_used integer
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
  SELECT id, api_keys.tier, api_keys.rate_per_min, api_keys.daily_quota, revoked_at
    INTO k
  FROM public.api_keys
  WHERE key_hash = p_key_hash;

  IF k.id IS NULL THEN
    RETURN QUERY SELECT false, 'unknown_key', NULL::uuid, NULL::text, 0, 0, 0, 0; RETURN;
  END IF;
  IF k.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'revoked', k.id, k.tier, k.rate_per_min, 0, k.daily_quota, 0; RETURN;
  END IF;

  -- Quota first: it is the cheaper refusal and the one a caller can plan for.
  SELECT COALESCE(SUM(calls), 0) INTO v_day_used
  FROM public.api_usage WHERE api_usage.key_id = k.id AND day = v_day;

  IF v_day_used >= k.daily_quota THEN
    RETURN QUERY SELECT false, 'quota_exceeded', k.id, k.tier, k.rate_per_min, 0, k.daily_quota, v_day_used; RETURN;
  END IF;

  -- Rate bucket for this minute. The upsert IS the increment, so two
  -- concurrent calls cannot both read 59 and both write 60.
  INSERT INTO public.api_rate (key_id, minute, calls) VALUES (k.id, v_minute, 1)
  ON CONFLICT (key_id, minute) DO UPDATE SET calls = public.api_rate.calls + 1
  RETURNING calls INTO v_rate;

  IF v_rate > k.rate_per_min THEN
    -- Counted and refused, deliberately: a caller hammering past the limit does
    -- not get a cheaper minute by hammering harder.
    RETURN QUERY SELECT false, 'rate_limited', k.id, k.tier, k.rate_per_min, v_rate, k.daily_quota, v_day_used; RETURN;
  END IF;

  INSERT INTO public.api_usage (key_id, day, endpoint, calls) VALUES (k.id, v_day, p_endpoint, 1)
  ON CONFLICT (key_id, day, endpoint) DO UPDATE SET calls = public.api_usage.calls + 1;

  UPDATE public.api_keys SET last_used_at = now() WHERE id = k.id;

  -- Old buckets are swept opportunistically rather than by a cron: the table
  -- only ever holds one row per key per minute, and this keeps it that way
  -- without another moving part to forget about.
  DELETE FROM public.api_rate WHERE minute < now() - interval '10 minutes';

  RETURN QUERY SELECT true, 'ok', k.id, k.tier, k.rate_per_min, v_rate, k.daily_quota, v_day_used + 1;
END;
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, and this one both reads
-- the key table and mutates counters. Same lockdown as the other definer
-- functions in this schema (see 20260730070000).
REVOKE ALL ON FUNCTION public.api_key_check(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_check(text, text) TO service_role;

CREATE INDEX IF NOT EXISTS api_usage_day_idx ON public.api_usage (day);
CREATE INDEX IF NOT EXISTS api_keys_owner_idx ON public.api_keys (owner_email);
