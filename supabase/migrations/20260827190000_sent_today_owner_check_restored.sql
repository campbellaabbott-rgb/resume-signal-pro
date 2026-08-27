-- A FIX THAT WAS UNDONE BY A LATER REWRITE.
--
-- agent_sent_today(uuid) takes the user id as a parameter, is SECURITY DEFINER,
-- and is granted to `authenticated`. On 2026-07-30 that combination was found
-- and closed twice — 20260730050000 and again in 20260730224753 — by adding a
-- caller check inside the body:
--
--     IF auth.role() <> 'service_role' AND auth.uid() <> p_user THEN RAISE ...
--
-- Then the cap was changed to count COMMITMENTS rather than completions
-- (20260803120000, refined in 20260803135316). Both of those rewrites were
-- correct about counting and both used CREATE OR REPLACE with a plain
-- `LANGUAGE sql` body — which silently dropped the ownership check, because
-- CREATE OR REPLACE replaces the WHOLE function, not the part you were thinking
-- about. Since 2026-08-03 any signed-in user has been able to POST
-- rpc/agent_sent_today with somebody else's uuid and read their daily
-- application count.
--
-- The leak is small — one integer, and only for users who have an agent mandate
-- — but it is a real read of another person's activity, and the shape is the
-- part worth fixing: a security property that lives only in a function body is
-- one CREATE OR REPLACE away from gone, and nothing failed when it went. The
-- accompanying guard now pins BOTH properties against the LATEST definition, so
-- the next rewrite that keeps one and forgets the other fails the battery
-- instead of shipping.
--
-- The REVOKE is not the fix. anon was already revoked; the caller here is
-- `authenticated`, which the GRANT deliberately allows. Only the in-body check
-- distinguishes "this user asking about themselves" from "this user asking
-- about someone else", and the worker keeps its access through auth.role().

CREATE OR REPLACE FUNCTION public.agent_sent_today(p_user uuid)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The worker legitimately asks about other users; a person may only ask
  -- about themselves. A null uid (anon reaching this despite the REVOKE, or a
  -- malformed JWT) fails the second test and is refused.
  IF coalesce(auth.role(), '') <> 'service_role'
     AND (auth.uid() IS NULL OR auth.uid() <> p_user) THEN
    RAISE EXCEPTION 'agent_sent_today: you may only read your own count'
      USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT count(*)::integer
    FROM public.agent_submissions
    WHERE user_id = p_user
      AND (
        -- Actually sent today.
        submitted_at >= date_trunc('day', now())
        -- Or released today and still in flight. Mutually exclusive with the
        -- branch above, so a row released AND submitted today counts once.
        OR (submitted_at IS NULL AND released_at >= date_trunc('day', now()))
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.agent_sent_today(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_sent_today(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.agent_sent_today(uuid) IS
  'Applications COMMITTED today for this user: submitted, or released and awaiting the worker. Counts commitments rather than completions, so the daily cap cannot be exceeded by releasing faster than the worker sends. Per-user, so it holds across multiple mandates. Service role may ask about any user; an authenticated caller may only ask about itself.';
