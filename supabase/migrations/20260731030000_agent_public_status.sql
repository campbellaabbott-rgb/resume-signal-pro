-- One boolean the marketing pages are allowed to ask: can the apply agent
-- actually send an application right now?
--
-- WHY A PUBLIC FUNCTION FOR THIS. The pricing page is about to describe an
-- agent that fills in and submits applications. That description is true only
-- while a worker is running. Nobody has purchased yet and no worker is hosted,
-- so today it would be a promise the product cannot keep — and unlike a queue
-- that can refuse with a reason, a pricing page has no way to say "actually,
-- not right now" unless it asks.
--
-- So the page asks. When this returns false the agent copy is not rendered and
-- the page sells what genuinely works: prepared applications a person sends.
-- When a worker is live it returns true and the copy appears. The claim and the
-- capability move together, which is the only arrangement that stays honest
-- without someone remembering to edit a page.
--
-- DELIBERATELY A BARE BOOLEAN. agent_sender_online (service-role only) exposes
-- the window and by implication the fleet; this exposes neither worker ids,
-- timestamps, counts, nor versions. "Is the feature operational" is a fact a
-- prospective customer is entitled to. Everything else is infrastructure.
CREATE OR REPLACE FUNCTION public.agent_sender_public_status()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agent_worker_heartbeat
    WHERE last_seen > now() - interval '15 minutes'
  );
$$;

-- Revoked from PUBLIC first, then granted explicitly. A GRANT on its own leaves
-- Postgres's default PUBLIC grant in place — that is exactly how nine functions
-- ended up reachable by anon earlier today, so the pattern is spelled out here
-- rather than assumed.
REVOKE ALL ON FUNCTION public.agent_sender_public_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_sender_public_status() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.agent_sender_public_status() IS
  'True when the apply worker is live. Anon-readable on purpose: the pricing page renders auto-apply claims only when this is true, so the copy cannot outrun the capability. Exposes no worker identity, timing or counts.';
