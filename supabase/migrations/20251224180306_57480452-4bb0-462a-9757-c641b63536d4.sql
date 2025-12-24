-- Create hourly trend function for email delivery
CREATE OR REPLACE FUNCTION public.get_email_metrics_hourly(p_hours_back integer DEFAULT 24)
RETURNS TABLE(
  hour_bucket timestamptz,
  total_emails bigint,
  successful_emails bigint,
  failed_emails bigint,
  success_rate numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    date_trunc('hour', created_at) as hour_bucket,
    COUNT(*)::bigint as total_emails,
    COUNT(*) FILTER (WHERE status = 'sent')::bigint as successful_emails,
    COUNT(*) FILTER (WHERE status = 'failed')::bigint as failed_emails,
    ROUND(
      CASE WHEN COUNT(*) > 0 
        THEN COUNT(*) FILTER (WHERE status = 'sent')::numeric / COUNT(*)::numeric * 100
        ELSE 0 
      END, 2
    ) as success_rate
  FROM email_logs
  WHERE created_at > now() - (p_hours_back || ' hours')::interval
  GROUP BY date_trunc('hour', created_at)
  ORDER BY hour_bucket ASC;
END;
$$;

-- Create hourly trend function for webhook processing
CREATE OR REPLACE FUNCTION public.get_webhook_metrics_hourly(p_hours_back integer DEFAULT 24)
RETURNS TABLE(
  hour_bucket timestamptz,
  total_webhooks bigint,
  successful_webhooks bigint,
  failed_webhooks bigint,
  avg_processing_time_ms numeric,
  success_rate numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    date_trunc('hour', created_at) as hour_bucket,
    COUNT(*)::bigint as total_webhooks,
    COUNT(*) FILTER (WHERE processed = true AND processing_error IS NULL)::bigint as successful_webhooks,
    COUNT(*) FILTER (WHERE processed = false OR processing_error IS NOT NULL)::bigint as failed_webhooks,
    ROUND(AVG(processing_time_ms)::numeric, 0) as avg_processing_time_ms,
    ROUND(
      CASE WHEN COUNT(*) > 0 
        THEN COUNT(*) FILTER (WHERE processed = true AND processing_error IS NULL)::numeric / COUNT(*)::numeric * 100
        ELSE 0 
      END, 2
    ) as success_rate
  FROM webhook_events
  WHERE created_at > now() - (p_hours_back || ' hours')::interval
  GROUP BY date_trunc('hour', created_at)
  ORDER BY hour_bucket ASC;
END;
$$;

-- Create hourly trend function for AI generation quality
CREATE OR REPLACE FUNCTION public.get_ai_generation_metrics_hourly(p_hours_back integer DEFAULT 24)
RETURNS TABLE(
  hour_bucket timestamptz,
  total_generations bigint,
  successful_generations bigint,
  failed_generations bigint,
  avg_duration_ms numeric,
  success_rate numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    date_trunc('hour', created_at) as hour_bucket,
    COUNT(*)::bigint as total_generations,
    COUNT(*) FILTER (WHERE generation_success = true)::bigint as successful_generations,
    COUNT(*) FILTER (WHERE generation_success = false)::bigint as failed_generations,
    ROUND(AVG(generation_duration_ms)::numeric, 0) as avg_duration_ms,
    ROUND(
      CASE WHEN COUNT(*) > 0 
        THEN COUNT(*) FILTER (WHERE generation_success = true)::numeric / COUNT(*)::numeric * 100
        ELSE 0 
      END, 2
    ) as success_rate
  FROM product_deliveries
  WHERE created_at > now() - (p_hours_back || ' hours')::interval
    AND content_generation_started_at IS NOT NULL
  GROUP BY date_trunc('hour', created_at)
  ORDER BY hour_bucket ASC;
END;
$$;