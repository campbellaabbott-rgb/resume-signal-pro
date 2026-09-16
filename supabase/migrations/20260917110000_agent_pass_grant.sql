-- THE GRANT: money was taken, so this either records a pass or says loudly why not.
--
-- Called by stripe-webhook on checkout.session.completed (payment_status
-- paid, metadata.product_type = the pass), and by the authenticated success
-- page repair (agent-pass-status with ?session_id=) when the webhook has not
-- landed yet. Both hand in the SAME numbers, read from the charging
-- runtime's constants — nothing here spells a price, an hour, an
-- application count, a quota, a rate or a shelf length. The row copies them
-- in and keeps them.
--
-- THREE OUTCOMES, NONE SWALLOWED.
--   granted      a new row; granted_pass_id is it.
--   duplicate    this Stripe session (or payment intent) was already
--                recorded — a webhook retry, or the success page racing
--                the webhook. granted_ok stays true and the existing id is
--                returned, because the buyer DID get their pass; the caller
--                just asked twice.
--   refused      pass_already_open: the buyer already holds an unactivated
--                or live pass (the partial unique index in the previous
--                migration). Two checkouts paid before either was granted —
--                the checkout refusal in create-pass-checkout normally
--                stops this earlier. The CALLER writes the paid-but-
--                undelivered alert row (product_deliveries, status
--                generation_failed, product_type agent_pass) so the existing
--                product_delivery_health projection surfaces it. Never a
--                swallowed error, because money was taken.
--
-- LAZY CLOSE FIRST. Before inserting, any pass of this user whose clock or
-- shelf has run out is closed (the shared statement every reader uses). That
-- is what makes the partial unique index a real constraint: a purchase after
-- the previous pass ended never trips it. The close sits OUTSIDE the
-- exception block on purpose — a refused grant must not roll it back.
--
-- Idempotency is the two UNIQUE constraints on the Stripe ids — NOT
-- webhook_events (its RPC upserts; it records, it does not deduplicate) and
-- NOT used_stripe_sessions (purged after a month). ON CONFLICT names only
-- the session id as its arbiter, so a collision on the payment intent (the
-- "two separate Event objects" case Stripe documents) arrives as a unique
-- violation and is told apart from the open-pass collision by
-- CONSTRAINT_NAME. Any other unique violation is re-raised: an unknown
-- failure after a charge is exactly the kind of thing that must not be
-- absorbed into a false "duplicate".
--
-- OUT names are prefixed so none is a column of agent_passes (the 42702
-- trap; see plpgsql-out-params-cannot-capture-columns.test.ts).

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

  -- The shared lazy-close: an ended session or an expired shelf is closed
  -- here so the open-pass index sees only passes that are genuinely open.
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
    -- The session id was already on a row: the same purchase, asked twice.
    SELECT ap.id INTO v_id FROM public.agent_passes ap
     WHERE ap.stripe_session_id = btrim(p_stripe_session_id);
    RETURN QUERY SELECT true, 'duplicate'::text, v_id, true; RETURN;
  END IF;

  RETURN QUERY SELECT true, 'granted'::text, v_id, false;
END;
$$;

-- SERVICE ROLE ONLY. This function records a paid entitlement from numbers
-- it is handed; an anonymous caller reaching it would mint passes for free.
-- REVOKE by name from PUBLIC, anon and authenticated in the same file
-- (project_definer_exposure: a GRANT alone restricts nothing).
REVOKE ALL ON FUNCTION public.agent_pass_grant(uuid, text, text, integer, integer, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_pass_grant(uuid, text, text, integer, integer, integer, integer, integer, integer) TO service_role;
