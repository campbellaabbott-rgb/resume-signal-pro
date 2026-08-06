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

REVOKE ALL ON FUNCTION public.email_delivery_health(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_delivery_health(integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.email_delivery_health(integer) IS
  'Counts of email sends by status over a recent window. Returns counts only — no address, no error text, no message id — so it is safe to read without a session.';

CREATE OR REPLACE FUNCTION public.reconcile_stripe_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  PERFORM net.http_post(
    url     := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/reconcile-stripe',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{"lookbackHours": 48}'::jsonb
  );

  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('reconcile_stripe_cron', jsonb_build_object('lastCronAt', now()), now())
  ON CONFLICT (k) DO UPDATE
    SET v = jsonb_build_object('lastCronAt', now()), updated_at = now();
END;
$fn$;

REVOKE ALL ON FUNCTION public.reconcile_stripe_tick() FROM PUBLIC;

COMMENT ON FUNCTION public.reconcile_stripe_tick() IS
  'Scheduled entry point for reconcile-stripe. Posts to the function and stamps job_board_meta.reconcile_stripe_cron.lastCronAt. Callable only by the scheduler.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-stripe') THEN
      PERFORM cron.unschedule('reconcile-stripe');
    END IF;
    PERFORM cron.schedule(
      'reconcile-stripe',
      '17 15 * * *',
      $job$ SELECT public.reconcile_stripe_tick(); $job$
    );
  END IF;
END $$;

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

REVOKE ALL ON FUNCTION public.product_delivery_health(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.product_delivery_health(integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.product_delivery_health(integer) IS
  'Counts of paid-product deliveries by status over a recent window, with exhausted-retry and stuck counts. Counts only — safe to read without a session.';