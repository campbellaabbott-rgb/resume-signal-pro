-- "Is there paid work waiting for a sender?"
--
-- The apply worker holds the service-role key and drives a real browser, so
-- running it around the clock for nobody is both a cost and an attack surface.
-- With zero subscribers the correct amount of worker to run is none, and today
-- that is what runs: apply-agent refuses to release anything while no heartbeat
-- is fresh, and records `sender-offline` rather than silently doing nothing.
--
-- This function is the other half — the signal that says it is now worth
-- starting one. It answers a question no single existing table can:
--
--   * somebody is PAYING (agent_subscribers), and
--   * there is something to send (agent_submissions ready and unclaimed), and
--   * how long the oldest one has been waiting
--
-- A caller can then start a machine, and the worker can stop itself when the
-- answer goes back to zero. Neither half is useful alone: waking a worker with
-- no work burns money, and a worker that exits without a way to be woken makes
-- the product silently stop working.
CREATE OR REPLACE FUNCTION public.agent_work_pending()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subs int;
  v_ready int;
  v_oldest numeric;
BEGIN
  -- SERVICE ROLE ONLY. The number of paying subscribers and the size of the
  -- send backlog are business facts, not public ones. Postgres grants EXECUTE
  -- to PUBLIC by default, so the REVOKE below is what actually restricts this —
  -- a GRANT alone would not, and 107 of 121 definer functions in this database
  -- were once anon-callable for exactly that reason.
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'agent_work_pending: service role only'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_subs FROM public.agent_subscribers;

  -- Unclaimed and still within the attempt ceiling. A row parked as `uncertain`
  -- has had its attempts pushed past the ceiling on purpose and must never
  -- count as work — waking a worker for packets nothing will ever pick up is a
  -- machine that starts every hour and does nothing.
  SELECT count(*),
         coalesce(max(extract(epoch FROM (now() - created_at)) / 60.0), 0)
    INTO v_ready, v_oldest
  FROM public.agent_submissions
  WHERE status IN ('ready', 'approved')
    AND claimed_at IS NULL
    AND coalesce(attempts, 0) < 5;

  RETURN jsonb_build_object(
    'subscribers', v_subs,
    'pending', v_ready,
    'oldest_wait_minutes', round(v_oldest, 1),
    -- The single boolean a caller acts on. Both conditions matter: packets with
    -- no subscriber mean somebody's subscription lapsed while rows sat in the
    -- queue, and starting a browser for those would send applications nobody is
    -- paying for.
    'should_run', (v_subs > 0 AND v_ready > 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.agent_work_pending() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_work_pending() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_work_pending() TO service_role;

COMMENT ON FUNCTION public.agent_work_pending() IS
  'Service-role only. Returns {subscribers, pending, oldest_wait_minutes, '
  'should_run}. should_run is true only when somebody is paying AND there are '
  'unclaimed packets under the attempt ceiling — the signal to start an apply '
  'worker, and its absence the signal one can stop.';
