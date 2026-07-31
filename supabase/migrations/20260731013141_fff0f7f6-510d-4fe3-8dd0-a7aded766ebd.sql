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

REVOKE ALL ON FUNCTION public.agent_sender_public_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_sender_public_status() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.agent_sender_public_status() IS
  'True when the apply worker is live. Anon-readable on purpose: the pricing page renders auto-apply claims only when this is true, so the copy cannot outrun the capability. Exposes no worker identity, timing or counts.';