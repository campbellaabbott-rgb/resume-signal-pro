-- AN EMAIL STUCK IN `pending` READS AS HEALTHY.
--
-- Found by looking at live data 2026-08-06, hours after shipping
-- email_delivery_health. Over a one-year window the log holds exactly two rows:
-- one `sent`, and one `pending` whose last_at is 2026-07-03. That row has been
-- pending for thirty-four days. It is not in flight; it is stopped.
--
-- The check shipped this morning computes `total = sent + failed` and treats
-- `failed + bounced + dlq` as the failure set, so `pending` is in NEITHER. A log
-- consisting entirely of permanently-stuck emails would report reason 'clean'
-- with a failRate of null and nothing would look wrong. That is the same
-- one-value-two-states fault the original migration was written to remove,
-- reintroduced one layer down by a status nobody enumerated.
--
-- WHY `stuck` IS DEFINED BY EXCLUSION. The terminal statuses are known — sent,
-- failed, bounced, complained, suppressed, dlq — and anything else is a state
-- the sender moved through and did not leave. Listing the non-terminal states
-- positively would mean this check silently stops covering any status added
-- later, which is exactly how `pending` escaped in the first place. Unknown
-- states are far likelier to be stuck than to be fine, so they count as stuck.
--
-- Two hours: a send takes seconds. Two hours is not slow, it is abandoned.

-- The return type gains a column, and Postgres will not CREATE OR REPLACE
-- across a signature change. The drop leaves a brief window where the RPC does
-- not exist; the heartbeat already degrades that to reason 'rpc-missing' rather
-- than failing, which is why that path was built.
DROP FUNCTION IF EXISTS public.email_delivery_health(integer);

CREATE OR REPLACE FUNCTION public.email_delivery_health(p_hours integer DEFAULT 24)
RETURNS TABLE(
  status text,
  n bigint,
  -- In a non-terminal state for more than two hours: sent to nobody, failed for
  -- nobody, and counted by nothing until now.
  stuck bigint,
  last_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.status,
         count(*) AS n,
         count(*) FILTER (
           WHERE s.status NOT IN ('sent', 'failed', 'bounced', 'complained', 'suppressed', 'dlq')
             AND s.created_at < now() - interval '2 hours'
         )::bigint AS stuck,
         max(s.created_at) AS last_at
    FROM public.email_send_log s
   WHERE s.created_at >= now() - make_interval(hours => GREATEST(COALESCE(p_hours, 24), 1))
   GROUP BY s.status
   ORDER BY count(*) DESC;
$$;

-- Unchanged from 20260807010000: counts and a timestamp, never the recipient
-- address and never the provider error text.
REVOKE ALL ON FUNCTION public.email_delivery_health(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_delivery_health(integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.email_delivery_health(integer) IS
  'Counts of email sends by status over a recent window, plus the count stranded '
  'in a non-terminal state for over two hours. The stuck column exists because a '
  'row pending for thirty-four days was counted as neither sent nor failed, and '
  'therefore read as clean. Returns counts only — no address, no error text.';
