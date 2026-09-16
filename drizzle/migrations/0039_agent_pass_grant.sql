CREATE OR REPLACE FUNCTION public.agent_pass_grant(
  p_user_id uuid,
  p_stripe_session_id text,
  p_payment_intent_id text,
  p_amount_cents integer,
  p_session_hours integer,
  p_applications_total integer,
  p_rate_per_min integer,
  p_daily_quota integer,
  p_shelf_days integer
)
RETURNS TABLE (
  granted_ok boolean,
  grant_reason text,
  granted_pass_id uuid,
  was_duplicate boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_constraint text;
BEGIN
  IF p_user_id IS NULL
     OR coalesce(btrim(p_stripe_session_id), '') = ''
     OR p_amount_cents IS NULL OR p_amount_cents < 0
     OR p_session_hours IS NULL OR p_session_hours < 1
     OR p_applications_total IS NULL OR p_applications_total < 0
     OR p_rate_per_min IS NULL OR p_rate_per_min < 1
     OR p_daily_quota IS NULL OR p_daily_quota < 1
     OR p_shelf_days IS NULL OR p_shelf_days < 1 THEN
    RETURN QUERY SELECT false, 'bad_request'::text, NULL::uuid, false; RETURN;
  END IF;

  UPDATE public.agent_passes ap
     SET closed_at = now(),
         close_reason = CASE WHEN ap.activated_at IS NULL THEN 'shelf_expired' ELSE 'session_ended' END
   WHERE ap.user_id = p_user_id
     AND ap.closed_at IS NULL
     AND coalesce(ap.expires_at, ap.shelf_expires_at) <= now();

  BEGIN
    INSERT INTO public.agent_passes (
      user_id, stripe_session_id, stripe_payment_intent_id, amount_cents,
      session_hours, applications_total, rate_per_min, daily_quota,
      purchased_at, shelf_expires_at
    ) VALUES (
      p_user_id, btrim(p_stripe_session_id), nullif(btrim(p_payment_intent_id), ''), p_amount_cents,
      p_session_hours, p_applications_total, p_rate_per_min, p_daily_quota,
      now(), now() + make_interval(days => p_shelf_days)
    )
    ON CONFLICT (stripe_session_id) DO NOTHING
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'agent_passes_one_open_pass_per_user' THEN
        RETURN QUERY SELECT false, 'pass_already_open'::text, NULL::uuid, false; RETURN;
      ELSIF v_constraint = 'agent_passes_stripe_payment_intent_id_key' THEN
        SELECT ap.id INTO v_id FROM public.agent_passes ap
         WHERE ap.stripe_payment_intent_id = nullif(btrim(p_payment_intent_id), '');
        RETURN QUERY SELECT true, 'duplicate'::text, v_id, true; RETURN;
      END IF;
      RAISE;
  END;

  IF v_id IS NULL THEN
    SELECT ap.id INTO v_id FROM public.agent_passes ap
     WHERE ap.stripe_session_id = btrim(p_stripe_session_id);
    RETURN QUERY SELECT true, 'duplicate'::text, v_id, true; RETURN;
  END IF;

  RETURN QUERY SELECT true, 'granted'::text, v_id, false;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_pass_grant(uuid, text, text, integer, integer, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_pass_grant(uuid, text, text, integer, integer, integer, integer, integer, integer) TO service_role;