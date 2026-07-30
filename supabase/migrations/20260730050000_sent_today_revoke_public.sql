-- agent_sent_today was callable by anon. Found in post-deploy verification, not
-- in review.
--
-- WHAT WENT WRONG: 20260730020000 granted EXECUTE to authenticated and
-- service_role and stopped there. Postgres grants EXECUTE on a new function to
-- PUBLIC by default, and a GRANT does not displace that — only a REVOKE does. So
-- the grant read like a restriction and was actually a no-op on top of an open
-- door.
--
-- Verified live against production with the anon key:
--     POST /rest/v1/rpc/agent_sent_today {"p_user":"00000000-...-000000000000"}
--     -> 200, body: 0
--
-- The function is SECURITY DEFINER and takes an arbitrary user id, so anyone
-- holding the publishable key could ask how many applications any given account
-- sent today. Small in isolation — a count, for a uuid they would have to know —
-- but it is a job seeker's activity, and "you would need the uuid" is not an
-- access control.
--
-- The two functions in 20260730030000 were written with explicit REVOKEs and
-- correctly answer 42501 to anon, which is what made the difference visible.
REVOKE ALL ON FUNCTION public.agent_sent_today(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_sent_today(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.agent_sent_today(uuid) TO authenticated, service_role;

-- Belt and braces: the count is per-caller for an authenticated user. Even with
-- EXECUTE, one candidate should not be able to read another's activity by
-- passing someone else's id.
CREATE OR REPLACE FUNCTION public.agent_sent_today(p_user uuid)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- service_role (auth.uid() IS NULL) is the runner and may ask about anyone.
  -- An authenticated caller may only ask about themselves.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user THEN
    RAISE EXCEPTION 'agent_sent_today: you may only read your own count';
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
  'Daily send count. Service role may ask about any user; an authenticated caller may only ask about itself. EXECUTE revoked from PUBLIC — a GRANT alone does not remove the default PUBLIC grant.';
