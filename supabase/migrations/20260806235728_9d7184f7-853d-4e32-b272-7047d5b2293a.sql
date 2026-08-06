DROP FUNCTION IF EXISTS public.email_delivery_health(integer);

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

REVOKE ALL ON FUNCTION public.email_delivery_health(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_delivery_health(integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.email_delivery_health(integer) IS
  'Counts of email sends by status over a recent window, plus the count stranded '
  'in a non-terminal state for over two hours. The stuck column exists because a '
  'row pending for thirty-four days was counted as neither sent nor failed, and '
  'therefore read as clean. Returns counts only — no address, no error text.';