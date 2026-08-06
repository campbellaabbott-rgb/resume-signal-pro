-- IF PAID REPORT EMAILS START FAILING, NOTHING SAYS SO.
--
-- Audited 2026-08-06. `email_send_log` records every send with a status —
-- sent / failed / bounced / complained / suppressed / dlq — and nothing reads
-- it. check-error-spikes SENDS alert email but does not MONITOR email; neither
-- process-email-queue nor send-scan-report has a failure-alert path; the
-- heartbeat has no delivery check at all.
--
-- So the failure mode is the worst one this product has: somebody pays, the
-- report never arrives, and the first signal is a refund request. The delivery
-- log has the answer the whole time and nobody queries it.
--
-- AND IT IS NOT MERELY UNREAD, IT IS UNREADABLE. `email_send_log` is granted to
-- service_role only, so an anon probe returns `200 []` — which is the same
-- answer for "no emails have failed" and "you cannot see this table". A
-- measurement that returns the identical value for a healthy system and a blind
-- one is not a measurement, and that ambiguity is why this went unnoticed.
--
-- WHAT MAKES THIS SAFE TO EXPOSE. `recipient_email` is a customer's address and
-- `error_message` can quote a provider response containing one. Neither is
-- returned. This projects COUNTS BY STATUS and a timestamp — no address, no
-- message id, no error text, no template-level detail that could identify a
-- purchase. Same discipline as agent_confirmation_gaps and agent_fill_gaps: the
-- projection is what makes it safe, not the caller.

CREATE OR REPLACE FUNCTION public.email_delivery_health(p_hours integer DEFAULT 24)
RETURNS TABLE(
  status text,
  n bigint,
  last_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.status,
         count(*)            AS n,
         max(s.created_at)   AS last_at
    FROM public.email_send_log s
   WHERE s.created_at >= now() - make_interval(hours => GREATEST(COALESCE(p_hours, 24), 1))
   GROUP BY s.status
   ORDER BY count(*) DESC;
$$;

-- Readable without a session, deliberately, for the same reason the other two
-- gap functions are: the heartbeat is where this becomes visible and the
-- heartbeat is read without one. Safe because the projection above carries a
-- status enum, an integer and a timestamp — nothing that names a person.
REVOKE ALL ON FUNCTION public.email_delivery_health(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_delivery_health(integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.email_delivery_health(integer) IS
  'Counts of email sends by status over a recent window. Exists because a paid '
  'report that never arrives had no signal anywhere: the log recorded it and '
  'nothing read it. Returns counts only — no address, no error text, no message '
  'id — so it is safe to read without a session.';
