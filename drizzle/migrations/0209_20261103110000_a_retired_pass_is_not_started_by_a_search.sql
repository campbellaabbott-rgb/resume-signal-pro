-- A RETIRED PASS IS NOT STARTED BY A SEARCH (audit 2026-10-31, S13-074).
--
-- WHAT WAS WRONG. The $29 Agent Pass bought ten applications inside a
-- six-hour session, and its clock started at the first allowed keyed /mcp/
-- call other than the key's status and a resource read (20260917230000).
-- Wave 4 retired the pass and its one paid tool, request_application
-- (agent-mcp answers that tool before this function is asked), and kept the
-- clock. A pre-pivot buyer holding an unused pass who searched jobs, read a
-- job or scored a fit with the key started the six hours, and the lazy close
-- later wrote 'session_ended' with 0 of 10 applications used: the row the
-- owner's refund-or-honour decision for past pass buyers is made against.
--
-- WHAT THIS CHANGES. Only a call to the tool the pass was sold for starts its
-- clock. Nothing reaches that tool today, so an unused pass stays unused and
-- closes as 'shelf_expired' at the end of its shelf life, which says what
-- happened. The two "looking" exemptions are still spelled in the condition
-- (they are implied by the new clause; the guards that pin them read them).
-- Everything else is carried forward from 20260917230000 verbatim: the same
-- signature and OUT columns in the same order, the same check order, the
-- same overlay (a live pass still serves its limits) and the same lazy close.
-- agent-mcp's activated_via stamp writes only a pass whose activated_at is
-- already set, so it stamps nothing either.
--
-- CREATE OR REPLACE, not DROP + CREATE: the return type is unchanged, so the
-- grants survive; they are restated below anyway. Safe to re-run. Verify:
-- src/test/a-retired-pass-is-not-started-by-a-search.test.ts runs the winning
-- definition in pglite from Supabase's default grants, this file twice; the
-- DO block at the end checks the catalogue and the body.

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
  -- activated matches no row and v_started stays NULL. Only the call the
  -- pass was sold for starts it: a search, a job read, a fit, the key's
  -- status and a resource read are all looking, and looking must not start
  -- a paid clock (20261103110000; that tool is retired, so nothing does).
  IF v_pass_id IS NOT NULL AND p_endpoint <> '/mcp/key_status'
     AND p_endpoint NOT LIKE '/mcp/resource/%'
     AND p_endpoint = '/mcp/request_application' THEN
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

-- Self-verifying: one function of this name, a definer with a fixed
-- search_path, closed to the client roles, whose activation names the pass's
-- own tool.
DO $$
DECLARE
  n integer;
  f text := 'public.api_key_check(text,text)';
  v_def boolean;
  v_cfg text[];
  v_src text;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'api_key_check';
  IF n <> 1 THEN RAISE EXCEPTION 'api_key_check must be exactly one function, found %', n; END IF;
  SELECT p.prosecdef, p.proconfig, p.prosrc INTO v_def, v_cfg, v_src FROM pg_proc p WHERE p.oid = f::regprocedure;
  IF NOT coalesce(v_def, false) OR v_cfg IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(v_cfg) c WHERE c LIKE 'search_path=%') THEN
    RAISE EXCEPTION '% is not a definer with a fixed search_path', f;
  END IF;
  IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
    RAISE EXCEPTION '% is executable by a client role', f;
  END IF;
  IF position('p_endpoint = ''/mcp/request_application''' IN v_src) = 0 THEN
    RAISE EXCEPTION 'api_key_check starts a pass on calls other than the tool it was sold for';
  END IF;
END $$;
