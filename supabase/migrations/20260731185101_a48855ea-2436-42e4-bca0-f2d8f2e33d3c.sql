ALTER TABLE public.agent_mandates
  ADD COLUMN IF NOT EXISTS consent_to_processing boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.agent_mandates.consent_to_processing IS
  'Explicit opt-in allowing the apply agent to accept an employer''s privacy '
  'notice / data-processing consent / truthfulness declaration on the '
  'candidate''s behalf. False = the agent refuses those forms and queues them '
  'for the person to complete. Never inferred from any other setting.';

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
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'agent_work_pending: service role only'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_subs FROM public.agent_subscribers;

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