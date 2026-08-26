-- api_key_check returned 42702 on EVERY authenticated call, so the API was
-- unusable the moment a real key existed.
--
--   {"error":{"code":"auth_unavailable"}}   ← what the caller saw
--   column reference "key_id" is ambiguous  ← what actually happened
--
-- This is the get_board_flow defect, second occurrence. Every name in
-- `RETURNS TABLE (...)` becomes an OUT PARAMETER in scope for the whole plpgsql
-- body, and three of them — key_id, tier, daily_quota — are also real columns
-- of the tables these functions touch. The body then said:
--
--   ON CONFLICT (key_id, minute) DO UPDATE ...
--
-- and PostgreSQL could not tell the column from the variable.
--
-- WHY ISSUANCE WORKED AND VERIFICATION DID NOT, which is what made this look
-- like a deploy problem rather than a code one: api_key_issue names the same
-- colliding words, but only inside an INSERT COLUMN LIST, and a column list is
-- not an expression — nothing is substituted there. api_key_check put one in an
-- ON CONFLICT inference clause, which IS resolved as a column reference. So a
-- key could be minted and then never authenticated.
--
-- FIXED BY RENAMING RATHER THAN QUALIFYING. An ON CONFLICT target cannot be
-- alias-qualified, so the rule "qualify the collision" has no spelling here.
-- Removing the collision outright is the only fix that also survives the next
-- edit to either return shape.
--
-- DROP + CREATE, not CREATE OR REPLACE: renaming an OUT parameter changes the
-- function's return type, and CREATE OR REPLACE refuses that. Input signatures
-- are unchanged, so no overload is created — the PGRST203 hazard does not apply.
DROP FUNCTION IF EXISTS public.api_key_check(text, text);
DROP FUNCTION IF EXISTS public.api_key_issue(text, text, text, text);

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

  SELECT COALESCE(SUM(u.calls), 0) INTO v_day_used
  FROM public.api_usage u WHERE u.key_id = k.id AND u.day = v_day;

  IF v_day_used >= k.daily_quota THEN
    RETURN QUERY SELECT false, 'quota_exceeded', k.id, k.tier, k.rate_per_min, 0, k.daily_quota, v_day_used; RETURN;
  END IF;

  -- The upsert IS the increment, so two concurrent calls cannot both read the
  -- last allowed value and both pass.
  INSERT INTO public.api_rate AS r (key_id, minute, calls) VALUES (k.id, v_minute, 1)
  ON CONFLICT (key_id, minute) DO UPDATE SET calls = r.calls + 1
  RETURNING r.calls INTO v_rate;

  IF v_rate > k.rate_per_min THEN
    -- Counted and refused: hammering past the limit must not buy a cheaper minute.
    RETURN QUERY SELECT false, 'rate_limited', k.id, k.tier, k.rate_per_min, v_rate, k.daily_quota, v_day_used; RETURN;
  END IF;

  INSERT INTO public.api_usage AS u (key_id, day, endpoint, calls) VALUES (k.id, v_day, p_endpoint, 1)
  ON CONFLICT (key_id, day, endpoint) DO UPDATE SET calls = u.calls + 1;

  UPDATE public.api_keys ak SET last_used_at = now() WHERE ak.id = k.id;

  DELETE FROM public.api_rate r WHERE r.minute < now() - interval '10 minutes';

  RETURN QUERY SELECT true, 'ok', k.id, k.tier, k.rate_per_min, v_rate, k.daily_quota, v_day_used + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.api_key_check(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_check(text, text) TO service_role;

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
  was_rotated boolean
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
  v_rotated boolean := false;
  v_id uuid;
  c_rate integer := 60;
  c_quota integer := 1000;
  c_tier text := 'free';
BEGIN
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RETURN QUERY SELECT false, 'invalid_email', NULL::uuid, NULL::text, 0, 0, false; RETURN;
  END IF;

  -- Per-address, never per-IP: shared egress would divide one allowance among
  -- everyone behind it, and no IP is stored anywhere in this flow.
  SELECT count(*) INTO v_today
  FROM public.api_keys ak
  WHERE lower(ak.owner_email) = v_email AND ak.created_at > now() - interval '24 hours';

  IF v_today >= 3 THEN
    RETURN QUERY SELECT false, 'too_many_requests', NULL::uuid, NULL::text, 0, 0, false; RETURN;
  END IF;

  UPDATE public.api_keys ak
     SET revoked_at = now(),
         notes = coalesce(ak.notes, '') || ' rotated ' || now()::text
   WHERE lower(ak.owner_email) = v_email AND ak.revoked_at IS NULL;
  v_rotated := FOUND;

  INSERT INTO public.api_keys (key_hash, key_prefix, name, owner_email, tier, rate_per_min, daily_quota)
  VALUES (p_key_hash, p_key_prefix, coalesce(nullif(btrim(p_name), ''), 'Untitled key'), v_email, c_tier, c_rate, c_quota)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT true, 'issued', v_id, c_tier, c_rate, c_quota, v_rotated;
END;
$$;

REVOKE ALL ON FUNCTION public.api_key_issue(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_issue(text, text, text, text) TO service_role;
