-- A LOOK AT THE GUIDE DOES NOT START THE CLOCK.
--
-- agent-mcp 2026-09-04.6 answers prompts/get and resources/read. A prompt
-- is never metered (discovery does not spend a real call, so no row is
-- written for one and nothing here can see it). A CREDENTIALED resource
-- read IS metered through this function, under an endpoint family of its
-- own beneath the MCP prefix, so the adoption reader (agent_adoption_metrics,
-- 20260917200000) can tell a tool call and a resource read apart. Metering
-- it here is right: the row is what a channel is judged by.
--
-- What is NOT right is what the previous definition (20260917120000) would
-- do with that row: it starts a pass at the first allowed /mcp/ call other
-- than key_status, and a guide read is such a call. A buyer who opens the
-- guide resource or their key's status in an attach menu is LOOKING before
-- starting — the same question key_status is exempt for — and their pass
-- clock would start on the look. This definition exempts the resource
-- family from activation and changes nothing else: same signature, same
-- OUT columns in the same order,
-- same check order (count the minute -> refuse if over the minute -> refuse
-- if revoked -> count the day -> refuse if over the day -> meter -> stamp ->
-- allow), same overlay, same lazy close. The families are spelled here as
-- the endpoint prefixes the server writes; a guard in src/test reads both
-- runtimes and fails when they part.
--
-- CREATE OR REPLACE, not DROP + CREATE: the return type is unchanged, so the
-- previous grants survive — and are restated below anyway, because a
-- definer that decides access is locked down in every file that defines it.
--
-- Body carried forward from 20260917120000 verbatim except the activation
-- condition. OUT parameter names are unchanged and collide with no column of
-- any table this body touches (the 42702 trap).

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
  -- activated matches no row and v_started stays NULL. One endpoint family
  -- is exempt beside key_status: a resource read is looking, not doing, and
  -- looking must not start a paid clock (a prompt read never reaches here).
  IF v_pass_id IS NOT NULL AND p_endpoint <> '/mcp/key_status'
     AND p_endpoint NOT LIKE '/mcp/resource/%' THEN
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

-- SERVICE ROLE ONLY, restated: this function decides whether a caller is
-- allowed, spends their quota, and starts a paid clock.
REVOKE ALL ON FUNCTION public.api_key_check(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_check(text, text) TO service_role;
