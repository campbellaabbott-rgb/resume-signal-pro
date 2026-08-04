-- A DEAD SENDER AND A SENDER THAT WAS NEVER INSTALLED LOOK IDENTICAL.
--
-- `agent_sender_online(900)` returns a boolean, and false means BOTH:
--   * no worker has ever checked in  — nothing is wrong, nothing is installed
--   * a worker checked in and stopped — the host died and applications are not
--     going out
--
-- Alerting on the boolean would therefore either page on a machine that was
-- never set up, or say nothing when the one that was set up dies. A probe that
-- returns the same answer for two different states is not a measurement.
--
-- WHY THIS MATTERS TODAY. The worker runs on a laptop. macOS sleeps ~11 minutes
-- after you stop touching it unless `pmset -c sleep 0` is set, and that setting
-- is the kind an OS update quietly reverts. When it does, the agent stops and
-- the failure is invisible: no error anywhere, and to a candidate it reads
-- exactly like "no matching jobs today".
--
-- So this returns the STATE and lets the caller decide, rather than baking a
-- verdict into the database.

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
    -- NULL when nothing has ever checked in, so "never armed" stays
    -- distinguishable from "offline for 0 seconds" at every layer above.
    (SELECT EXTRACT(EPOCH FROM (now() - max(last_seen)))::int
       FROM public.agent_worker_heartbeat),
    -- What is actually at stake. A sleeping worker with no mandate costs
    -- nothing; the same worker with a paying candidate behind it is an outage.
    (SELECT count(*)::int FROM public.agent_mandates WHERE active IS TRUE),
    -- agent_submissions, NOT agent_queue: the queue is the morning shortlist,
    -- the submissions table is what apply-broker actually hands to a worker.
    -- 'ready' is the only status that is waiting on the sender — 'preparing'
    -- has not been drafted yet, and the rest are terminal.
    (SELECT count(*)::int FROM public.agent_submissions WHERE status = 'ready');
$$;

COMMENT ON FUNCTION public.agent_sender_state() IS
  'Apply-worker liveness as STATE, not a verdict: ever_seen separates "never installed" from "died", '
  'and active_mandates/pending_packets say whether a dead worker currently costs anyone anything. '
  'agent_sender_online() stays the release gate; this exists because alerting needs to tell those apart.';

REVOKE ALL ON FUNCTION public.agent_sender_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_sender_state() TO service_role;
