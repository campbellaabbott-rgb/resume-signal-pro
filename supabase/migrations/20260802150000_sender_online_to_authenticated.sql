-- Let a signed-in candidate see whether our sender is up.
--
-- WHY THIS IS BEING RELAXED, AND WHY ONLY THIS FAR. agent_sender_online was
-- correctly locked down: REVOKE ALL FROM PUBLIC, anon, authenticated, then
-- GRANT to service_role alone. Verified still holding today — an anon call
-- returns 42501 permission denied. That was the right fix for the definer
-- exposure, and none of it is being undone for anon.
--
-- But the lockdown has a cost nobody priced. When our worker is offline,
-- decideRelease refuses every packet with `sender-offline` — OUR outage, not
-- the candidate's problem. The Account page could not read that fact, so the
-- screen showed the same nothing it shows when no jobs matched. The person sees
-- an idle agent and reasonably concludes they have configured something wrong,
-- or that the product does not work. Both are wrong, and the truthful answer
-- was one boolean away the whole time.
--
-- WHAT IT DISCLOSES: exactly one bit — "has any worker checked in within the
-- window". No user data, no worker identity, no counts. Every signed-in person
-- gets the same answer, and it is the kind of thing a status page publishes on
-- purpose. anon stays revoked because there is no reason for a logged-out
-- visitor to probe our fleet's health.

REVOKE ALL ON FUNCTION public.agent_sender_online(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_sender_online(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agent_sender_online(integer) TO service_role;

COMMENT ON FUNCTION public.agent_sender_online(integer) IS
  'True when a worker has checked in within the window. Default 900s — comfortably longer than the worker idle sleep (30s) plus one slow application, so a busy worker is never mistaken for a dead one. Readable by authenticated users so the Account page can say "this is on us" instead of showing an unexplained idle agent; anon is revoked.';

-- CONFIRM AFTERWARDS — anon must still be refused:
--   curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/agent_sender_online" \
--     -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--     -H 'Content-Type: application/json' -d '{"p_max_age_seconds":900}'
--   expected: 401 {"code":"42501", ... "permission denied for function agent_sender_online"}
