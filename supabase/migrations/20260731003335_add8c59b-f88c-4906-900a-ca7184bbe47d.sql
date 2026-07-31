CREATE TABLE IF NOT EXISTS public.agent_worker_heartbeat (
  worker_id     text PRIMARY KEY,
  last_seen     timestamptz NOT NULL DEFAULT now(),
  claimed_total integer NOT NULL DEFAULT 0,
  version       text NOT NULL DEFAULT ''
);

GRANT ALL ON public.agent_worker_heartbeat TO service_role;

COMMENT ON TABLE public.agent_worker_heartbeat IS
  'One row per apply worker. Written every claim loop. apply-agent refuses to release packets when no row is recent, so packets are never handed to a sender that is not there.';

ALTER TABLE public.agent_worker_heartbeat ENABLE ROW LEVEL SECURITY;

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