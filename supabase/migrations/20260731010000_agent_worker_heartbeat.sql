-- Proof that something is alive to actually send applications.
--
-- WHY THIS MATTERS NOW. The apply agent is going into the subscription, charged
-- for and used on purchase. The worker that fills and submits forms is a
-- SEPARATE service — it needs a real browser, which edge functions do not have —
-- so it can be down while every other part of the system is up and cheerful.
--
-- Without this table, apply-agent would prepare packets, mark them released, and
-- hand them to nobody. The subscriber sees a queue that reads as "on its way"
-- and never moves. That is the one failure mode a paid product must not have:
-- taking money and silently doing nothing. A refusal with a reason is
-- recoverable. A promise that quietly does nothing is not.
--
-- Nobody has purchased yet, which is exactly why this goes in now — the first
-- purchase should not be the test of whether anything is running.
CREATE TABLE IF NOT EXISTS public.agent_worker_heartbeat (
  worker_id     text PRIMARY KEY,
  last_seen     timestamptz NOT NULL DEFAULT now(),
  claimed_total integer NOT NULL DEFAULT 0,
  -- What the worker believes about itself. Useful when two versions overlap
  -- during a redeploy and one of them is the one misbehaving.
  version       text NOT NULL DEFAULT ''
);

COMMENT ON TABLE public.agent_worker_heartbeat IS
  'One row per apply worker. Written every claim loop. apply-agent refuses to release packets when no row is recent, so packets are never handed to a sender that is not there.';

ALTER TABLE public.agent_worker_heartbeat ENABLE ROW LEVEL SECURITY;
-- No policy for anon or authenticated: this is infrastructure state, and the
-- service role bypasses RLS. Candidates learn the sender is down from the
-- refusal reason on their own packet, not by reading this table.

-- Is any worker alive? SECURITY DEFINER so apply-agent can ask without needing
-- a policy, and revoked from PUBLIC because a GRANT alone would leave the
-- default PUBLIC grant in place — the mistake that put nine functions in reach
-- of anon earlier today.
CREATE OR REPLACE FUNCTION public.agent_sender_online(p_max_age_seconds integer DEFAULT 900)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agent_worker_heartbeat
    WHERE last_seen > now() - make_interval(secs => greatest(p_max_age_seconds, 60))
  );
$$;

REVOKE ALL ON FUNCTION public.agent_sender_online(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_sender_online(integer) TO service_role;

COMMENT ON FUNCTION public.agent_sender_online(integer) IS
  'True when a worker has checked in within the window. Default 900s — comfortably longer than the worker idle sleep (30s) plus one slow application, so a busy worker is never mistaken for a dead one.';

-- Record a check-in. The worker calls this once per claim loop; upsert keeps it
-- to one row per worker no matter how many times it restarts.
CREATE OR REPLACE FUNCTION public.agent_worker_ping(p_worker text, p_version text DEFAULT '', p_claimed integer DEFAULT 0)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.agent_worker_heartbeat (worker_id, last_seen, claimed_total, version)
  VALUES (p_worker, now(), greatest(p_claimed, 0), coalesce(p_version, ''))
  ON CONFLICT (worker_id) DO UPDATE
    SET last_seen     = now(),
        claimed_total = public.agent_worker_heartbeat.claimed_total + greatest(p_claimed, 0),
        version       = coalesce(EXCLUDED.version, '');
$$;

REVOKE ALL ON FUNCTION public.agent_worker_ping(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_worker_ping(text, text, integer) TO service_role;
