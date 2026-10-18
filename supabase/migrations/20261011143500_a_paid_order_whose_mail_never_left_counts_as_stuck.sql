-- A PAID ORDER WHOSE MAIL NEVER LEFT COUNTS AS STUCK; A TEST PURCHASE NEVER COUNTS.
--
-- WHAT WAS WRONG (critical-path plan 2026-10-12, CP-021 and CP-C item 9).
-- product_delivery_health (20260807050000) counted as stuck only orders left
-- in payment_received, generating or generation_failed for two hours. An
-- order that was made and never mailed ('generated' by the success page,
-- 'content_generated' by the webhook or the sweep, with no mail sent), and an
-- order whose mail was refused and is still being retried (email_failed),
-- counted as nothing: the heartbeat read a buyer who paid and heard nothing
-- as a clean day. And the owner's test-mode rehearsal (a cs_test_ purchase,
-- tagged metadata.livemode = false by the webhook and the verifier) counted
-- like a sale.
--
-- NOW, after two hours, a made order with no mail sent and an email_failed
-- order count as stuck. A made order the sweep took off the schedule
-- (next_retry_at infinity: it has no address to mail, the buyer saw it on
-- the page) is not counted, because nothing will ever mail it and nobody is
-- waiting for a mail. A test purchase is left out of every count. The
-- signature, the grants (service role only, 20261004110000) and every other
-- count are unchanged. Safe to re-run.

SET LOCAL statement_timeout = '2min';

CREATE OR REPLACE FUNCTION public.product_delivery_health(p_hours integer DEFAULT 24)
RETURNS TABLE(
  status text,
  n bigint,
  exhausted bigint,
  stuck bigint,
  last_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.status,
         count(*) FILTER (
           WHERE d.created_at >= now() - make_interval(hours => GREATEST(COALESCE(p_hours, 24), 1))
         )::bigint AS n,
         -- Unwindowed: a purchase whose retries are spent stays unfulfilled
         -- until somebody acts on it, however long ago it was bought.
         count(*) FILTER (
           WHERE d.retry_count >= d.max_retries
             AND d.status <> 'delivered'
             AND d.status <> 'content_generated'
         )::bigint AS exhausted,
         -- Unwindowed too: paid, two hours on, and nothing has reached the buyer.
         count(*) FILTER (
           WHERE d.created_at < now() - interval '2 hours'
             AND (d.status IN ('payment_received', 'generating', 'generation_failed', 'email_failed')
                  OR (d.status IN ('generated', 'content_generated')
                      AND d.email_sent_at IS NULL
                      AND d.next_retry_at IS DISTINCT FROM 'infinity'::timestamptz))
         )::bigint AS stuck,
         max(d.created_at) FILTER (
           WHERE d.created_at >= now() - make_interval(hours => GREATEST(COALESCE(p_hours, 24), 1))
         ) AS last_at
    FROM public.product_deliveries d
   WHERE (d.created_at >= now() - make_interval(hours => GREATEST(COALESCE(p_hours, 24), 1))
      OR (d.status IN ('payment_received', 'generating', 'generation_failed', 'email_failed', 'generated', 'content_generated')
          AND d.created_at < now() - interval '2 hours'))
     -- The owner's test-mode rehearsal is not a sale.
     AND COALESCE(d.metadata->>'livemode', '') <> 'false'
   GROUP BY d.status
   ORDER BY count(*) DESC;
$$;

REVOKE ALL ON FUNCTION public.product_delivery_health(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_delivery_health(integer) TO service_role;

COMMENT ON FUNCTION public.product_delivery_health(integer) IS
  'Paid-product deliveries by status: n counts events inside the window; exhausted and stuck count standing '
  'conditions at ANY age. Stuck: two hours on, still payment_received, generating, generation_failed or '
  'email_failed, or made (generated, content_generated) with no mail sent and still scheduled. Test-mode '
  'purchases (metadata.livemode false) are left out. Counts only; service role only. 20261011143500.';

-- Self-verifying: service-role only, and on probe rows (rolled back) the
-- standing count grows by exactly the made-but-unmailed order and the
-- refused-mail order, never by a mailed order, an unscheduled one or a test.
DO $verify$
DECLARE
  v_bad      text[] := ARRAY[]::text[];
  v_before   bigint;
  v_after    bigint;
  v_sentinel constant text := 'delivery-health probe: rolled back';
BEGIN
  IF has_function_privilege('anon', 'public.product_delivery_health(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.product_delivery_health(integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.product_delivery_health(integer)', 'EXECUTE') THEN
    v_bad := v_bad || 'product_delivery_health is not service-role only'::text;
  END IF;

  BEGIN
    SELECT COALESCE(sum(h.stuck), 0) INTO v_before FROM public.product_delivery_health(24) h;
    INSERT INTO public.product_deliveries (stripe_session_id, product_type, status, created_at, email_sent_at, next_retry_at, metadata) VALUES
      ('cs_selfcheck_143500_unmailed',   'cover_letter', 'content_generated', now() - interval '3 hours', NULL, NULL, NULL),
      ('cs_selfcheck_143500_page',       'cover_letter', 'generated',         now() - interval '3 hours', NULL, NULL, NULL),
      ('cs_selfcheck_143500_refused',    'cover_letter', 'email_failed',      now() - interval '3 hours', NULL, now() + interval '1 hour', NULL),
      ('cs_selfcheck_143500_mailed',     'cover_letter', 'content_generated', now() - interval '3 hours', now() - interval '170 minutes', NULL, NULL),
      ('cs_selfcheck_143500_unschedule', 'cover_letter', 'generated',         now() - interval '3 hours', NULL, 'infinity', NULL),
      ('cs_selfcheck_143500_rehearsal',  'cover_letter', 'generation_failed', now() - interval '3 hours', NULL, NULL, '{"livemode": false}'::jsonb);
    SELECT COALESCE(sum(h.stuck), 0) INTO v_after FROM public.product_delivery_health(24) h;
    IF v_after - v_before <> 3 THEN
      v_bad := v_bad || format('six probe orders moved the standing count by %s, want 3 (two made and unmailed, one refused mail)', v_after - v_before);
    END IF;
    RAISE EXCEPTION USING MESSAGE = v_sentinel;
  EXCEPTION WHEN others THEN
    IF SQLERRM <> v_sentinel THEN
      v_bad := v_bad || ('the probe could not run: ' || SQLERRM);
    END IF;
  END;

  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'delivery-health self-check failed: %', array_to_string(v_bad, ' | ');
  END IF;
  RAISE NOTICE 'self-verify 20261011143500: a paid order whose mail never left counts as stuck after two hours; a test purchase never counts';
END
$verify$;
