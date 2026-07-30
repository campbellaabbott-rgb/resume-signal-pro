-- agent_sent_today is callable by anon. Confirmed live, twice, still true.
--
-- WHAT WENT WRONG: 20260730020000 granted EXECUTE to authenticated and
-- service_role and stopped there. Postgres grants EXECUTE on a new function to
-- PUBLIC by default, and a GRANT does not displace that — only a REVOKE does. So
-- the grant read like a restriction and was a no-op on top of an open door.
--
-- Verified against production with the anon key, on 2026-07-30 and again after
-- the following deploy:
--     POST /rest/v1/rpc/agent_sent_today {"p_user":"00000000-...-000000000000"}
--     -> 200, body: 0
--
-- The control that proves the probe can see a denial at all: agent_claim_submission
-- and agent_mark_uncertain, which were written with explicit REVOKEs, both answer
-- 401 / 42501 to the same anon key.
--
-- The function is SECURITY DEFINER and takes an arbitrary user id, so anyone
-- holding the publishable key can ask how many applications any given account
-- sent today. Small in isolation — a count, for a uuid they would have to know —
-- but it is a job seeker's activity, and "you would need the uuid" is not access
-- control.
REVOKE ALL ON FUNCTION public.agent_sent_today(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_sent_today(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.agent_sent_today(uuid) TO authenticated, service_role;

-- A check INSIDE the function, because the REVOKE above is exactly the kind of
-- statement that has already failed to reach this database once.
--
-- MY FIRST VERSION OF THIS GUARD DID NOT WORK, and the reason is worth keeping.
-- It read:
--
--     IF auth.uid() IS NOT NULL AND auth.uid() <> p_user THEN RAISE ...
--
-- treating "auth.uid() IS NULL" as "this is the service role, let it through".
-- But an ANONYMOUS caller also has a NULL auth.uid(). So the one caller the
-- REVOKE was meant to stop was the one caller the fallback waved through — a
-- belt-and-braces that shared a single point of failure with the belt.
--
-- auth.role() distinguishes them: 'anon', 'authenticated', or 'service_role'.
-- Now anon is refused even if the REVOKE never applies, which given this
-- project's deploy history is the case worth designing for.
CREATE OR REPLACE FUNCTION public.agent_sent_today(p_user uuid)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND (auth.uid() IS NULL OR auth.uid() <> p_user) THEN
    RAISE EXCEPTION 'agent_sent_today: you may only read your own count'
      USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT count(*)::integer
    FROM public.agent_submissions
    WHERE user_id = p_user
      AND submitted_at >= date_trunc('day', now())
  );
END;
$$;

REVOKE ALL ON FUNCTION public.agent_sent_today(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_sent_today(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.agent_sent_today(uuid) IS
  'Daily send count. Service role may ask about any user; an authenticated caller may only ask about itself; anon is refused twice over (REVOKE, and an auth.role() check inside). A GRANT alone does not remove the default PUBLIC grant.';
