-- Self-serve key issuance, and the free tier that makes traffic possible.
--
-- The API works but nobody can use it: keys exist only if someone writes SQL.
-- That is the wrong shape for a product whose first job is to be TRIED. This
-- adds one function that mints a key for an email address, with the two limits
-- that keep "free and self-serve" from meaning "free and unbounded".
--
-- CHARGING LATER NEEDS NO NEW SHAPE, WHICH IS WHY THE TIER IS A COLUMN AND NOT
-- A CONSTANT. A key already carries its own tier, rate_per_min and daily_quota,
-- and api_usage already meters per key per day. Turning this into a paid
-- product is then: take payment, raise those two numbers, set tier. No
-- migration of existing keys, no second code path, and the usage history a
-- customer's first invoice would be based on is already being recorded from
-- their first free call. Deliberately NOT adding stripe columns today — there
-- is no customer, and a column that holds nothing for months is a column
-- everyone forgets the meaning of.
--
-- ROTATE, DON'T ACCUMULATE. Asking again revokes the previous key and issues
-- one. Otherwise "I lost my key" has no answer except a support email, and
-- abandoned keys pile up as live credentials nobody is watching.
CREATE OR REPLACE FUNCTION public.api_key_issue(
  p_email text,
  p_name text,
  p_key_hash text,
  p_key_prefix text
)
RETURNS TABLE (
  ok boolean,
  reason text,
  key_id uuid,
  tier text,
  rate_per_min integer,
  daily_quota integer,
  rotated boolean
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
  -- The free tier. 60/min is generous enough to develop against without
  -- thinking about it, and 1,000/day is small enough that a real integration
  -- outgrows it — which is the conversation this is meant to start.
  c_rate integer := 60;
  c_quota integer := 1000;
  c_tier text := 'free';
BEGIN
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RETURN QUERY SELECT false, 'invalid_email', NULL::uuid, NULL::text, 0, 0, false; RETURN;
  END IF;

  -- Per-address ceiling. Not an IP ceiling: shared egress (an office, a
  -- university, mobile CGNAT) would divide one allowance among everyone behind
  -- it, which is the exact defect that made parse-pdf's per-IP limit a problem
  -- on this platform. Email is the thing being granted, so email is the thing
  -- counted — and no IP is stored anywhere in this flow.
  SELECT count(*) INTO v_today
  FROM public.api_keys
  WHERE lower(owner_email) = v_email AND created_at > now() - interval '24 hours';

  IF v_today >= 3 THEN
    RETURN QUERY SELECT false, 'too_many_requests', NULL::uuid, NULL::text, 0, 0, false; RETURN;
  END IF;

  UPDATE public.api_keys
     SET revoked_at = now(),
         notes = coalesce(notes, '') || ' rotated ' || now()::text
   WHERE lower(owner_email) = v_email AND revoked_at IS NULL;
  v_rotated := FOUND;

  INSERT INTO public.api_keys (key_hash, key_prefix, name, owner_email, tier, rate_per_min, daily_quota)
  VALUES (p_key_hash, p_key_prefix, coalesce(nullif(btrim(p_name), ''), 'Untitled key'), v_email, c_tier, c_rate, c_quota)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT true, 'issued', v_id, c_tier, c_rate, c_quota, v_rotated;
END;
$$;

REVOKE ALL ON FUNCTION public.api_key_issue(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_issue(text, text, text, text) TO service_role;

-- Existing rows predate the tier name this function issues under; nothing has
-- consumed them yet, so align them rather than leave two spellings of "free".
UPDATE public.api_keys SET tier = 'free' WHERE tier = 'trial';
