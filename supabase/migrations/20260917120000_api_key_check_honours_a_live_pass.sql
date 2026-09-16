-- api_key_check HONOURS A LIVE PASS — as an overlay, on read, for /mcp/ only.
--
-- The Agent Pass raises a key's rate and daily quota for the length of a
-- session and answers a tier of its own. None of that is written to
-- api_keys: the agent key row stays 'free' at its own limits, and this
-- function OVERLAYS the pass row's numbers on the decision while a pass is
-- open. Overlay, not column write, because there is then no revert step to
-- forget (no cron, no second moving part), and a key rotation mid-pass
-- keeps the pass — the lookup is by the key's user_id, not by the key.
--
-- THE LIMITS ARE COMPARED AGAINST THE PASS NUMBERS, NOT MERELY RETURNED. The
-- agent key row is 'free'; if only the OUT values changed, the buyer's
-- calls would still be refused at the free ceilings while the headers
-- claimed otherwise. Every comparison and every RETURN below reads the
-- effective limit variables.
--
-- ONLY /mcp/ ENDPOINTS SEE THE OVERLAY. The pass is "your agent", not "your
-- script": the same key on a /v1/ endpoint keeps its own tier and limits.
--
-- ACTIVATION HAPPENS HERE, ON THE ALLOWED PATH, AND NOWHERE ELSE. The first
-- allowed /mcp/ call other than key_status stamps activated_at and computes
-- expires_at from the row's OWN session_hours — the number the grant copied
-- in, never a literal here. Never on a refused return (rate_limited, revoked,
-- quota_exceeded all RETURN before that point), never on key_status (the
-- "may I?" question every agent is told to ask first must not start the
-- clock), never on /v1/. On read in SQL rather than in the Deno dispatcher,
-- because the dispatcher learns the tier only from this function: a
-- Deno-side flip would serve the buyer's first fit_resume as free. An
-- unactivated pass already serves the pass limits from the first call; the
-- same call activates it.
--
-- EXPIRY IS LAZY: by comparison against now(), and by the shared close
-- statement that every reader runs. Nothing flips on a timer.
--
-- Two OUT columns APPENDED (pass_ends_at, pass_apps_left): NULL when there
-- is no pass; pass_ends_at is NULL for a pass not yet activated, so
-- key_status can say "not started". Every existing OUT column keeps its
-- name, type and position, so readers built against the previous shape are
-- untouched; deny_reason's vocabulary is unchanged. The two new names are
-- columns of no table this body touches (the 42702 trap).
--
-- DROP + CREATE because the RETURNS TABLE type changes and CREATE OR REPLACE
-- cannot change a return type; the input signature is unchanged so no
-- overload is created (the 20260826161200 precedent). Body carried forward
-- from 20260827162000 with the check order unchanged: count the minute ->
-- refuse if over the minute -> refuse if revoked -> count the day -> refuse
-- if over the day -> meter -> stamp -> allow.

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
  quota_used integer,
  pass_ends_at timestamptz,
  pass_apps_left integer
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
  v_mcp boolean;
  v_pass_id uuid;
  v_pass_ends timestamptz;
  v_pass_left integer;
  v_pass_rate integer;
  v_pass_quota integer;
  v_started timestamptz;
  v_rate_limit integer;
  v_quota_limit integer;
  v_tier text;
BEGIN
  SELECT ak.id, ak.tier, ak.rate_per_min, ak.daily_quota, ak.revoked_at, ak.user_id
    INTO k
  FROM public.api_keys ak
  WHERE ak.key_hash = p_key_hash;

  IF k.id IS NULL THEN
    RETURN QUERY SELECT false, 'unknown_key', NULL::uuid, NULL::text, 0, 0, 0, 0, NULL::timestamptz, NULL::integer; RETURN;
  END IF;

  -- THE OVERLAY, READS ONLY. An account-linked key on an /mcp/ endpoint
  -- looks for its user's open pass after closing any that has run out.
  v_mcp := p_endpoint LIKE '/mcp/%';
  IF k.user_id IS NOT NULL AND v_mcp THEN
    UPDATE public.agent_passes ap
       SET closed_at = now(),
           close_reason = CASE WHEN ap.activated_at IS NULL THEN 'shelf_expired' ELSE 'session_ended' END
     WHERE ap.user_id = k.user_id
       AND ap.closed_at IS NULL
       AND coalesce(ap.expires_at, ap.shelf_expires_at) <= now();

    SELECT ap.id, ap.expires_at, ap.applications_total - ap.applications_used, ap.rate_per_min, ap.daily_quota
      INTO v_pass_id, v_pass_ends, v_pass_left, v_pass_rate, v_pass_quota
      FROM public.agent_passes ap
     WHERE ap.user_id = k.user_id
       AND ap.closed_at IS NULL
       AND (ap.activated_at IS NULL OR ap.expires_at > now());
  END IF;
  v_rate_limit  := CASE WHEN v_pass_id IS NOT NULL THEN v_pass_rate  ELSE k.rate_per_min END;
  v_quota_limit := CASE WHEN v_pass_id IS NOT NULL THEN v_pass_quota ELSE k.daily_quota  END;
  v_tier        := CASE WHEN v_pass_id IS NOT NULL THEN 'pass'       ELSE k.tier         END;

  -- THE MINUTE BUCKET IS COUNTED FIRST, BEFORE ANY REFUSAL CAN RETURN.
  -- Counted and then refused, which is the stance the day bucket already
  -- takes: hammering past a limit must not buy a cheaper minute.
  INSERT INTO public.api_rate AS r (key_id, minute, calls) VALUES (k.id, v_minute, 1)
  ON CONFLICT (key_id, minute) DO UPDATE SET calls = r.calls + 1
  RETURNING r.calls INTO v_rate;

  IF v_rate > v_rate_limit THEN
    RETURN QUERY SELECT false, 'rate_limited', k.id, v_tier, v_rate_limit, v_rate, v_quota_limit, 0, v_pass_ends, v_pass_left; RETURN;
  END IF;

  -- Revoked AFTER the minute bucket so the refusal is counted, but BEFORE the
  -- day bucket: a revoked key must not consume a quota it no longer has.
  IF k.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'revoked', k.id, v_tier, v_rate_limit, v_rate, v_quota_limit, 0, v_pass_ends, v_pass_left; RETURN;
  END IF;

  -- The increment IS the read, for the day exactly as for the minute.
  INSERT INTO public.api_quota AS q (key_id, day, calls) VALUES (k.id, v_day, 1)
  ON CONFLICT (key_id, day) DO UPDATE SET calls = q.calls + 1
  RETURNING q.calls INTO v_day_used;

  IF v_day_used > v_quota_limit THEN
    RETURN QUERY SELECT false, 'quota_exceeded', k.id, v_tier, v_rate_limit, v_rate, v_quota_limit, v_day_used, v_pass_ends, v_pass_left; RETURN;
  END IF;

  -- Per-endpoint metering, unchanged. This is what an invoice is built from;
  -- it is not what the limit is enforced with.
  INSERT INTO public.api_usage AS u (key_id, day, endpoint, calls) VALUES (k.id, v_day, p_endpoint, 1)
  ON CONFLICT (key_id, day, endpoint) DO UPDATE SET calls = u.calls + 1;

  UPDATE public.api_keys ak SET last_used_at = now() WHERE ak.id = k.id;

  -- ACTIVATION: one statement, on the allowed path, beside the last_used_at
  -- stamp. The clock length is the row's own session_hours. A pass already
  -- activated matches no row and v_started stays NULL.
  IF v_pass_id IS NOT NULL AND p_endpoint <> '/mcp/key_status' THEN
    UPDATE public.agent_passes ap
       SET activated_at = now(),
           expires_at = now() + make_interval(hours => ap.session_hours)
     WHERE ap.id = v_pass_id AND ap.activated_at IS NULL
    RETURNING ap.expires_at INTO v_started;
    IF v_started IS NOT NULL THEN
      v_pass_ends := v_started;
    END IF;
  END IF;

  DELETE FROM public.api_rate r WHERE r.minute < now() - interval '10 minutes';

  RETURN QUERY SELECT true, 'ok', k.id, v_tier, v_rate_limit, v_rate, v_quota_limit, v_day_used, v_pass_ends, v_pass_left;
END;
$$;

-- SERVICE ROLE ONLY, restated in the same file: this function decides whether
-- a caller is allowed, spends their quota, and now starts a paid clock.
-- DROP + CREATE discards the previous grants, so the REVOKE is not a
-- restatement here — it is the lockdown.
REVOKE ALL ON FUNCTION public.api_key_check(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_check(text, text) TO service_role;
