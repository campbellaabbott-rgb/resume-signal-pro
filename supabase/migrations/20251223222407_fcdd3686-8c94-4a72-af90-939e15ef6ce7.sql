-- Create email_logs table to track all email sends
CREATE TABLE public.email_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  email_type TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Enable RLS
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (edge functions use service role)
CREATE POLICY "Service role can manage email_logs"
ON public.email_logs
FOR ALL
USING (true)
WITH CHECK (true);

-- Create function to log email sends
CREATE OR REPLACE FUNCTION public.log_email_send(
  p_email_type TEXT,
  p_recipient TEXT,
  p_subject TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'sent',
  p_error_message TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.email_logs (email_type, recipient, subject, status, error_message, metadata)
  VALUES (p_email_type, p_recipient, p_subject, p_status, p_error_message, p_metadata)
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$$;

-- Create function to get recent email logs
CREATE OR REPLACE FUNCTION public.get_email_health(p_hours_back INTEGER DEFAULT 24)
RETURNS TABLE(
  total_emails BIGINT,
  successful_emails BIGINT,
  failed_emails BIGINT,
  success_rate NUMERIC,
  recent_emails JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH stats AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'sent') as success,
      COUNT(*) FILTER (WHERE status = 'failed') as failed
    FROM public.email_logs
    WHERE created_at > now() - (p_hours_back || ' hours')::INTERVAL
  ),
  recent AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', id,
        'email_type', email_type,
        'recipient', recipient,
        'status', status,
        'error_message', error_message,
        'created_at', created_at
      ) ORDER BY created_at DESC
    ), '[]'::jsonb) as emails
    FROM (
      SELECT * FROM public.email_logs
      ORDER BY created_at DESC
      LIMIT 10
    ) e
  )
  SELECT
    stats.total,
    stats.success,
    stats.failed,
    ROUND((stats.success::NUMERIC / NULLIF(stats.total, 0) * 100), 1),
    recent.emails
  FROM stats, recent;
END;
$$;

-- Create function to get edge function error rates
CREATE OR REPLACE FUNCTION public.get_function_error_rates(p_hours_back INTEGER DEFAULT 24)
RETURNS TABLE(
  function_name TEXT,
  total_errors BIGINT,
  error_types TEXT[],
  last_error_at TIMESTAMP WITH TIME ZONE,
  sample_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(e.function_name, 'unknown') as function_name,
    COUNT(*) as total_errors,
    array_agg(DISTINCT e.error_type) as error_types,
    MAX(e.created_at) as last_error_at,
    (array_agg(e.error_message ORDER BY e.created_at DESC))[1] as sample_message
  FROM public.error_telemetry e
  WHERE e.created_at > now() - (p_hours_back || ' hours')::INTERVAL
  GROUP BY COALESCE(e.function_name, 'unknown')
  ORDER BY total_errors DESC
  LIMIT 10;
END;
$$;

-- Create function to get rate limit stats
CREATE OR REPLACE FUNCTION public.get_rate_limit_stats(p_hours_back INTEGER DEFAULT 24)
RETURNS TABLE(
  total_limited BIGINT,
  unique_ips BIGINT,
  by_function JSONB,
  recent_limits JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH rate_errors AS (
    SELECT * FROM public.error_telemetry
    WHERE error_type = 'rate_limit'
      AND created_at > now() - (p_hours_back || ' hours')::INTERVAL
  ),
  by_func AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object('function', function_name, 'count', cnt)
      ORDER BY cnt DESC
    ), '[]'::jsonb) as funcs
    FROM (
      SELECT function_name, COUNT(*) as cnt
      FROM rate_errors
      GROUP BY function_name
    ) f
  ),
  recent AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'visitor_id', visitor_id,
        'function', function_name,
        'created_at', created_at
      ) ORDER BY created_at DESC
    ), '[]'::jsonb) as limits
    FROM (
      SELECT * FROM rate_errors
      ORDER BY created_at DESC
      LIMIT 10
    ) r
  )
  SELECT
    (SELECT COUNT(*) FROM rate_errors),
    (SELECT COUNT(DISTINCT visitor_id) FROM rate_errors),
    by_func.funcs,
    recent.limits
  FROM by_func, recent;
END;
$$;

-- Create function to get payment flow health
CREATE OR REPLACE FUNCTION public.get_payment_health(p_hours_back INTEGER DEFAULT 24)
RETURNS TABLE(
  total_attempts BIGINT,
  successful BIGINT,
  failed BIGINT,
  success_rate NUMERIC,
  recent_failures JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH checkout_events AS (
    SELECT * FROM public.ab_test_events
    WHERE test_name = 'conversion_funnel'
      AND variant IN ('checkout_started', 'purchase_completed')
      AND created_at > now() - (p_hours_back || ' hours')::INTERVAL
  ),
  stats AS (
    SELECT
      COUNT(DISTINCT visitor_id) FILTER (WHERE variant = 'checkout_started') as attempts,
      COUNT(DISTINCT visitor_id) FILTER (WHERE variant = 'purchase_completed') as success
    FROM checkout_events
  ),
  failures AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'payment_intent_id', payment_intent_id,
        'failure_code', failure_code,
        'failure_message', failure_message,
        'amount', amount,
        'created_at', created_at
      ) ORDER BY created_at DESC
    ), '[]'::jsonb) as recent
    FROM (
      SELECT * FROM public.payment_failures
      WHERE created_at > now() - (p_hours_back || ' hours')::INTERVAL
      ORDER BY created_at DESC
      LIMIT 10
    ) f
  )
  SELECT
    stats.attempts,
    stats.success,
    stats.attempts - stats.success,
    ROUND((stats.success::NUMERIC / NULLIF(stats.attempts, 0) * 100), 1),
    failures.recent
  FROM stats, failures;
END;
$$;