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

  INSERT INTO public.api_rate AS r (key_id, minute, calls) VALUES (k.id, v_minute, 1)
  ON CONFLICT (key_id, minute) DO UPDATE SET calls = r.calls + 1
  RETURNING r.calls INTO v_rate;

  IF v_rate > v_rate_limit THEN
    RETURN QUERY SELECT false, 'rate_limited', k.id, v_tier, v_rate_limit, v_rate, v_quota_limit, 0, v_pass_ends, v_pass_left; RETURN;
  END IF;

  IF k.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'revoked', k.id, v_tier, v_rate_limit, v_rate, v_quota_limit, 0, v_pass_ends, v_pass_left; RETURN;
  END IF;

  INSERT INTO public.api_quota AS q (key_id, day, calls) VALUES (k.id, v_day, 1)
  ON CONFLICT (key_id, day) DO UPDATE SET calls = q.calls + 1
  RETURNING q.calls INTO v_day_used;

  IF v_day_used > v_quota_limit THEN
    RETURN QUERY SELECT false, 'quota_exceeded', k.id, v_tier, v_rate_limit, v_rate, v_quota_limit, v_day_used, v_pass_ends, v_pass_left; RETURN;
  END IF;

  INSERT INTO public.api_usage AS u (key_id, day, endpoint, calls) VALUES (k.id, v_day, p_endpoint, 1)
  ON CONFLICT (key_id, day, endpoint) DO UPDATE SET calls = u.calls + 1;

  UPDATE public.api_keys ak SET last_used_at = now() WHERE ak.id = k.id;

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

REVOKE ALL ON FUNCTION public.api_key_check(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_check(text, text) TO service_role;