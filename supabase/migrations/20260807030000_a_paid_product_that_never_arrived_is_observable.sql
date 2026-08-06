-- A PAID PRODUCT THAT NEVER GENERATED ENDS IN SILENCE, AND THE SAFETY NET
-- CANNOT SEE IT.
--
-- Audited 2026-08-06, tracing every checkout path end to end. The delivery
-- chain itself is sound and better than expected: every product_type the
-- catalogue can emit has a handler (scan packs add credits, freelance products
-- defer to the intake page, apply_assistant is handled, the rest map to a
-- generator), failures land in product_deliveries, and retry-failed-deliveries
-- is genuinely scheduled.
--
-- The chain's END is where it breaks. retry-failed-deliveries marks a delivery
-- 'generation_failed' and tells nobody — no alert, no owner email, nothing that
-- surfaces. A customer paid, the generation failed, the retry failed, and the
-- only remaining signal is a refund request.
--
-- WHY reconcile-stripe DOES NOT COVER THIS, which is the part worth being
-- precise about. That sweep finds paid Stripe sessions with NO
-- used_stripe_sessions marker. The webhook writes that marker at the TOP of
-- triggerProductDelivery, before generating anything. So a delivery that fails
-- AFTER the marker is written looks fulfilled to the sweep, forever. The two
-- failures are disjoint: reconcile-stripe catches "the webhook never ran", and
-- nothing at all caught "the webhook ran and the product never came".
--
-- THE OTHER STUCK STATE. 'payment_received' and 'generating' are transient by
-- design and terminal by accident: if the webhook dies mid-flight the row sits
-- in one of them forever. That is also money taken with nothing delivered, also
-- invisible to the sweep, and it is not a failure anyone thought to record
-- because no code path writes it deliberately.
--
-- Same projection discipline as email_delivery_health: counts by status and a
-- timestamp. No customer_email, no generation_error (which can quote a provider
-- response containing an address), no product_type — a status endpoint must not
-- become a way to enumerate who bought what.

CREATE OR REPLACE FUNCTION public.product_delivery_health(p_hours integer DEFAULT 24)
RETURNS TABLE(
  status text,
  n bigint,
  -- Retries are spent. This is the true "permanently failed and nobody was
  -- told" count, as distinct from a row still working through its attempts.
  exhausted bigint,
  -- In a NON-TERMINAL state for more than two hours. Generation takes seconds,
  -- so two hours is not slow — it is stopped.
  stuck bigint,
  last_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.status,
         count(*) AS n,
         count(*) FILTER (
           WHERE d.retry_count >= d.max_retries
         )::bigint AS exhausted,
         count(*) FILTER (
           WHERE d.status IN ('payment_received', 'generating', 'generation_failed')
             AND d.created_at < now() - interval '2 hours'
         )::bigint AS stuck,
         max(d.created_at) AS last_at
    FROM public.product_deliveries d
   WHERE d.created_at >= now() - make_interval(hours => GREATEST(COALESCE(p_hours, 24), 1))
   GROUP BY d.status
   ORDER BY count(*) DESC;
$$;

-- Readable without a session for the same reason the other health functions
-- are: the heartbeat is where this becomes visible, and the heartbeat is read
-- without one. Safe because the projection carries a status string and four
-- numbers — nothing that names a person or a purchase.
REVOKE ALL ON FUNCTION public.product_delivery_health(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.product_delivery_health(integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.product_delivery_health(integer) IS
  'Counts of paid-product deliveries by status over a recent window, with the '
  'exhausted-retry and stuck counts. Exists because a delivery that fails after '
  'the idempotency marker is written is invisible to reconcile-stripe, and '
  'retry-failed-deliveries gives up silently. Counts only — no address, no error '
  'text, no product — so it is safe to read without a session.';
