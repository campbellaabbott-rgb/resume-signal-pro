CREATE OR REPLACE FUNCTION public.agent_sender_state()
RETURNS TABLE (
  ever_seen        boolean,
  last_seen        timestamptz,
  offline_seconds  integer,
  active_mandates  integer,
  pending_packets  integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.agent_worker_heartbeat),
    (SELECT max(last_seen) FROM public.agent_worker_heartbeat),
    (SELECT EXTRACT(EPOCH FROM (now() - max(last_seen)))::int
       FROM public.agent_worker_heartbeat),
    (SELECT count(*)::int FROM public.agent_mandates WHERE active IS TRUE),
    (SELECT count(*)::int FROM public.agent_submissions WHERE status = 'ready');
$$;

COMMENT ON FUNCTION public.agent_sender_state() IS
  'Apply-worker liveness as STATE, not a verdict: ever_seen separates "never installed" from "died", '
  'and active_mandates/pending_packets say whether a dead worker currently costs anyone anything. '
  'agent_sender_online() stays the release gate; this exists because alerting needs to tell those apart.';

REVOKE ALL ON FUNCTION public.agent_sender_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_sender_state() TO service_role;