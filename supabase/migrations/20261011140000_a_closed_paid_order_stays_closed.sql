-- A CLOSED PAID ORDER STAYS CLOSED.
--
-- WHAT WAS WRONG (critical-path plan 2026-10-12, CP-019; reproduced in
-- pglite). Every status write to product_deliveries was unconditional:
-- update_delivery_retry, log_delivery_step, and the direct updates in the
-- webhook, the success-page verifier, the retry sweep, analyze-resume and
-- generate-freelance-boost. So a refunded order whose late failure write
-- landed after payment_revoke was put back on the retry queue and generated
-- and mailed again, and a delivered order that a slower writer reported as
-- failed (or as content_generated) was regenerated and mailed a second time.
-- The same reopening now matters for the purchase-link mail of the two
-- products made on their own page (the Full Analysis and Freelance Boost):
-- its failure is recorded as email_failed so the sweep can resend it, and
-- that write must never reopen an order the buyer already received.
--
-- THE RULE, enforced below every writer by a BEFORE UPDATE trigger, so a
-- writer that does not know it cannot break it:
--   * refunded never changes again (payment_revoke writes it last);
--   * delivered moves only to refunded;
--   * content_generated with its mail already sent never goes back to
--     payment_received, generating or generation_failed.
-- A refused move keeps the row's status, next_retry_at and retry_count, and
-- every other column the writer set (an error message, a timestamp) is kept:
-- the record of what happened is not lost, only the reopening.
--
-- The trigger function is not a definer and returns trigger, so no client can
-- call it; it is closed by name anyway. Safe to re-run.

SET LOCAL statement_timeout = '2min';

CREATE OR REPLACE FUNCTION public.product_delivery_stays_closed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (OLD.status = 'refunded' AND NEW.status IS DISTINCT FROM 'refunded')
     OR (OLD.status = 'delivered' AND NEW.status IS DISTINCT FROM 'delivered' AND NEW.status IS DISTINCT FROM 'refunded')
     OR (OLD.status = 'content_generated' AND OLD.email_sent_at IS NOT NULL
         AND NEW.status IN ('payment_received', 'generating', 'generation_failed')) THEN
    NEW.status := OLD.status;
    NEW.next_retry_at := OLD.next_retry_at;
    NEW.retry_count := OLD.retry_count;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.product_delivery_stays_closed() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.product_delivery_stays_closed() IS
  'BEFORE UPDATE on product_deliveries: refunded never changes, delivered moves only to refunded, and a '
  'content_generated row whose mail was sent never returns to generation. A refused move keeps status, '
  'next_retry_at and retry_count; the writer''s other columns land. 20261011140000.';

DROP TRIGGER IF EXISTS product_delivery_stays_closed ON public.product_deliveries;
CREATE TRIGGER product_delivery_stays_closed
  BEFORE UPDATE ON public.product_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.product_delivery_stays_closed();

-- Self-verifying: the trigger exists and fires, each closed state refuses the
-- writers that used to reopen it (the RPCs the functions call, and a plain
-- update), and the open states still move. The probe rows are rolled back.
DO $verify$
DECLARE
  v_bad      text[] := ARRAY[]::text[];
  v_id       uuid;
  v_status   text;
  v_next     timestamptz;
  v_err      text;
  v_sentinel constant text := 'closed-order probe: rolled back';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.product_deliveries'::regclass
       AND t.tgname = 'product_delivery_stays_closed'
       AND NOT t.tgisinternal
       AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'the product_delivery_stays_closed trigger is missing or disabled';
  END IF;
  IF has_function_privilege('anon', 'public.product_delivery_stays_closed()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.product_delivery_stays_closed()', 'EXECUTE') THEN
    v_bad := v_bad || 'the trigger function is executable by a client role'::text;
  END IF;

  BEGIN
    -- A refunded order and a late failure write from the webhook or the sweep.
    INSERT INTO public.product_deliveries (stripe_session_id, product_type, status, next_retry_at)
      VALUES ('cs_selfcheck_140000_refunded', 'full_analysis', 'refunded', 'infinity') RETURNING id INTO v_id;
    PERFORM public.update_delivery_retry(v_id, 'generation_failed', 'Generation failed: 400', true);
    SELECT status, next_retry_at INTO v_status, v_next FROM public.product_deliveries WHERE id = v_id;
    IF v_status <> 'refunded' OR v_next IS DISTINCT FROM 'infinity'::timestamptz THEN
      v_bad := v_bad || format('a refunded order was reopened by update_delivery_retry (%s, %s)', v_status, v_next);
    END IF;
    UPDATE public.product_deliveries SET status = 'delivered' WHERE id = v_id;
    SELECT status INTO v_status FROM public.product_deliveries WHERE id = v_id;
    IF v_status <> 'refunded' THEN
      v_bad := v_bad || 'a refunded order was marked delivered by a late success write'::text;
    END IF;

    -- A delivered order and a slower writer's failure, its email failure and its generated copy.
    INSERT INTO public.product_deliveries (stripe_session_id, product_type, status)
      VALUES ('cs_selfcheck_140000_delivered', 'full_analysis', 'delivered') RETURNING id INTO v_id;
    PERFORM public.update_delivery_retry(v_id, 'email_failed', 'send-product-email answered 502', true);
    PERFORM public.log_delivery_step('cs_selfcheck_140000_delivered', 'generation_completed', false, 'late failure');
    UPDATE public.product_deliveries SET status = 'content_generated' WHERE id = v_id;
    SELECT status, last_retry_error INTO v_status, v_err FROM public.product_deliveries WHERE id = v_id;
    IF v_status <> 'delivered' THEN
      v_bad := v_bad || format('a delivered order was reopened as %s', v_status);
    END IF;
    IF v_err IS DISTINCT FROM 'send-product-email answered 502' THEN
      v_bad := v_bad || 'the refused writer''s error message was lost'::text;
    END IF;
    -- ...and a refund still closes it.
    UPDATE public.product_deliveries SET status = 'refunded' WHERE id = v_id;
    SELECT status INTO v_status FROM public.product_deliveries WHERE id = v_id;
    IF v_status <> 'refunded' THEN
      v_bad := v_bad || 'a delivered order could not be marked refunded'::text;
    END IF;

    -- A mailed saved copy is not taken back to generation.
    INSERT INTO public.product_deliveries (stripe_session_id, product_type, status, email_sent_at)
      VALUES ('cs_selfcheck_140000_mailed', 'cover_letter', 'content_generated', now()) RETURNING id INTO v_id;
    PERFORM public.update_delivery_retry(v_id, 'generation_failed', 'Generation failed: 400', true);
    SELECT status INTO v_status FROM public.product_deliveries WHERE id = v_id;
    IF v_status <> 'content_generated' THEN
      v_bad := v_bad || 'a mailed saved copy was sent back to generation'::text;
    END IF;

    -- The open states still move.
    INSERT INTO public.product_deliveries (stripe_session_id, product_type, status)
      VALUES ('cs_selfcheck_140000_open', 'cover_letter', 'payment_received') RETURNING id INTO v_id;
    PERFORM public.update_delivery_retry(v_id, 'email_failed', 'send-product-email answered 502', true);
    SELECT status INTO v_status FROM public.product_deliveries WHERE id = v_id;
    IF v_status <> 'email_failed' THEN
      v_bad := v_bad || 'an open order could not record its failed mail'::text;
    END IF;
    UPDATE public.product_deliveries SET status = 'delivered' WHERE id = v_id;
    SELECT status INTO v_status FROM public.product_deliveries WHERE id = v_id;
    IF v_status <> 'delivered' THEN
      v_bad := v_bad || 'an open order could not be closed as delivered'::text;
    END IF;

    RAISE EXCEPTION USING MESSAGE = v_sentinel;
  EXCEPTION WHEN others THEN
    IF SQLERRM <> v_sentinel THEN
      v_bad := v_bad || ('the probe could not run: ' || SQLERRM);
    END IF;
  END;

  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'closed-order self-check failed: %', array_to_string(v_bad, ' | ');
  END IF;
  RAISE NOTICE 'self-verify 20261011140000: a refunded order never reopens, a delivered order moves only to refunded, a mailed copy is never regenerated';
END
$verify$;
