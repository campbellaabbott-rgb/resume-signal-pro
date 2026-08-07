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
         count(*) FILTER (
           WHERE s.status NOT IN ('sent', 'failed', 'bounced', 'complained', 'suppressed', 'dlq')
             AND s.created_at < now() - interval '2 hours'
         )::bigint AS stuck,
         max(s.created_at) FILTER (
           WHERE s.created_at >= now() - make_interval(hours => GREATEST(COALESCE(p_hours, 24), 1))
         ) AS last_at
    FROM public.email_send_log s
   WHERE s.created_at >= now() - make_interval(hours => GREATEST(COALESCE(p_hours, 24), 1))
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