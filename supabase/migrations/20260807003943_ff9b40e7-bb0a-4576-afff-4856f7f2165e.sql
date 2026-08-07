-- A STRANDED ROW STOPS BEING REPORTED WHILE IT IS STILL STRANDED.
--
-- Caught live 2026-08-06, minutes after deploying the `stuck` counts. Proof, in
-- one measurement, against the real pending row that has sat since 2026-07-03:
--
--   p_hours=24   -> []                          <- what the heartbeat calls
--   p_hours=8760 -> [{"status":"pending","stuck":1}]
--
-- The heartbeat asks for 24 hours, gets nothing back, and reports reason 'idle'
-- and stuck 0 while a customer's email has been stuck for thirty-four days.
--
-- THE MISTAKE. `stuck` was bolted onto a windowed query. A window is right for
-- events — how many sends failed today — and wrong for a CONDITION. Something
-- stuck is not a thing that happened recently; it is a thing that is still true.
-- Filtering it by creation time means the alert can only fire between the second
-- hour and the twenty-fourth, then goes quiet forever with the condition
-- unchanged. That is precisely the failure these functions were written to
-- remove: a signal that reverts to reassuring while nothing has been fixed. It
-- is worse than not counting stuck at all, because a monitor that reported the
-- problem yesterday and is silent today reads as "it got resolved".
--
-- THE FIX. Two questions, two scopes, in one row per status:
--   n       counts events INSIDE the window   (unchanged meaning)
--   stuck   counts the standing condition, at ANY age
-- and the WHERE admits a status that is currently stuck even when it has no
-- rows in the window at all — otherwise the GROUP BY drops it and there is
-- nothing to report the count on. That is why the old query returned [] rather
-- than a row with stuck>0.
--
-- SCAN COST. `stuck` is deliberately unbounded in time. Non-terminal rows are
-- pathological and therefore few — if either table grows enough for the partial
-- scan to matter, add a partial index on the non-terminal statuses rather than
-- reintroducing a time bound, which would recreate exactly this bug at a longer
-- horizon.

CREATE OR REPLACE FUNCTION public.email_delivery_health(p_hours integer DEFAULT 24)
RETURNS TABLE(
  status text,
  n bigint,
  stuck bigint,
  last_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.status,
         count(*) FILTER (
           WHERE s.created_at >= now() - make_interval(hours => GREATEST(COALESCE(p_hours, 24), 1))
         )::bigint AS n,
         -- No window. Still stuck is still reportable, at any age.
         count(*) FILTER (
           WHERE s.status NOT IN ('sent', 'failed', 'bounced', 'complained', 'suppressed', 'dlq')
             AND s.created_at < now() - interval '2 hours'
         )::bigint AS stuck,
         max(s.created_at) FILTER (
           WHERE s.created_at >= now() - make_interval(hours => GREATEST(COALESCE(p_hours, 24), 1))
         ) AS last_at
    FROM public.email_send_log s
   WHERE s.created_at >= now() - make_interval(hours => GREATEST(COALESCE(p_hours, 24), 1))
      -- Admit currently-stuck rows regardless of age, or the GROUP BY drops the
      -- status entirely and the count has nowhere to live.
      OR (s.status NOT IN ('sent', 'failed', 'bounced', 'complained', 'suppressed', 'dlq')
          AND s.created_at < now() - interval '2 hours')
   GROUP BY s.status
   ORDER BY count(*) DESC;
$$;

REVOKE ALL ON FUNCTION public.email_delivery_health(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_delivery_health(integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.email_delivery_health(integer) IS
  'Email sends by status: n counts events inside the window, stuck counts the '
  'standing non-terminal condition at ANY age. The two scopes differ on purpose '
  '— a windowed stuck count went silent after 24h while the row stayed stuck, '
  'which reads as resolved. Counts only, no address, no error text.';

-- The identical flaw, shipped in the identical shape an hour earlier.
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
         -- Also unwindowed: a purchase whose retries are spent stays unfulfilled
         -- until somebody acts on it, however long ago it was bought.
         count(*) FILTER (
           WHERE d.retry_count >= d.max_retries
             AND d.status <> 'delivered'
             AND d.status <> 'content_generated'
         )::bigint AS exhausted,
         count(*) FILTER (
           WHERE d.status IN ('payment_received', 'generating', 'generation_failed')
           AND d.created_at < now() - interval '2 hours'
         )::bigint AS stuck,
         max(d.created_at) FILTER (
           WHERE d.created_at >= now() - make_interval(hours => GREATEST(COALESCE(p_hours, 24), 1))
         ) AS last_at
    FROM public.product_deliveries d
   WHERE d.created_at >= now() - make_interval(hours => GREATEST(COALESCE(p_hours, 24), 1))
      OR (d.status IN ('payment_received', 'generating', 'generation_failed')
          AND d.created_at < now() - interval '2 hours')
   GROUP BY d.status
   ORDER BY count(*) DESC;
$$;

REVOKE ALL ON FUNCTION public.product_delivery_health(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.product_delivery_health(integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.product_delivery_health(integer) IS
  'Paid-product deliveries by status: n counts events inside the window, while '
  'exhausted and stuck count standing conditions at ANY age. A customer who paid '
  'and never received does not stop being owed after 24 hours. Counts only.';