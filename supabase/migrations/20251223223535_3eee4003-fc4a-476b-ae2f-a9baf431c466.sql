-- Create product_deliveries table to track full lifecycle
CREATE TABLE public.product_deliveries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  stripe_session_id TEXT NOT NULL,
  customer_email TEXT,
  product_type TEXT NOT NULL,
  product_name TEXT,
  amount_cents INTEGER,
  
  -- Lifecycle stages (timestamps when each step completed)
  payment_completed_at TIMESTAMP WITH TIME ZONE,
  content_generation_started_at TIMESTAMP WITH TIME ZONE,
  content_generation_completed_at TIMESTAMP WITH TIME ZONE,
  email_sent_at TIMESTAMP WITH TIME ZONE,
  email_delivered_at TIMESTAMP WITH TIME ZONE,
  
  -- Status and quality tracking
  status TEXT NOT NULL DEFAULT 'payment_received',
  generation_success BOOLEAN,
  generation_error TEXT,
  email_success BOOLEAN,
  email_error TEXT,
  
  -- AI quality metrics
  ai_response_valid BOOLEAN,
  ai_parse_error TEXT,
  generation_duration_ms INTEGER,
  
  -- Metadata
  metadata JSONB
);

-- Create index for lookups
CREATE INDEX idx_product_deliveries_session ON public.product_deliveries(stripe_session_id);
CREATE INDEX idx_product_deliveries_email ON public.product_deliveries(customer_email);
CREATE INDEX idx_product_deliveries_status ON public.product_deliveries(status);
CREATE INDEX idx_product_deliveries_created ON public.product_deliveries(created_at DESC);

-- Enable RLS (admin access only through service role)
ALTER TABLE public.product_deliveries ENABLE ROW LEVEL SECURITY;

-- Function to log delivery step
CREATE OR REPLACE FUNCTION public.log_delivery_step(
  p_stripe_session_id TEXT,
  p_step TEXT,
  p_success BOOLEAN DEFAULT true,
  p_error TEXT DEFAULT NULL,
  p_duration_ms INTEGER DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delivery_id UUID;
BEGIN
  -- Get or create delivery record
  SELECT id INTO v_delivery_id 
  FROM product_deliveries 
  WHERE stripe_session_id = p_stripe_session_id;
  
  IF v_delivery_id IS NULL THEN
    INSERT INTO product_deliveries (stripe_session_id, status)
    VALUES (p_stripe_session_id, p_step)
    RETURNING id INTO v_delivery_id;
  END IF;
  
  -- Update based on step
  CASE p_step
    WHEN 'payment_received' THEN
      UPDATE product_deliveries SET
        payment_completed_at = now(),
        customer_email = COALESCE((p_metadata->>'email')::TEXT, customer_email),
        product_type = COALESCE((p_metadata->>'product_type')::TEXT, product_type),
        product_name = COALESCE((p_metadata->>'product_name')::TEXT, product_name),
        amount_cents = COALESCE((p_metadata->>'amount_cents')::INTEGER, amount_cents),
        status = 'payment_received'
      WHERE id = v_delivery_id;
      
    WHEN 'generation_started' THEN
      UPDATE product_deliveries SET
        content_generation_started_at = now(),
        status = 'generating'
      WHERE id = v_delivery_id;
      
    WHEN 'generation_completed' THEN
      UPDATE product_deliveries SET
        content_generation_completed_at = now(),
        generation_success = p_success,
        generation_error = p_error,
        generation_duration_ms = p_duration_ms,
        ai_response_valid = p_success,
        ai_parse_error = CASE WHEN NOT p_success THEN p_error ELSE NULL END,
        status = CASE WHEN p_success THEN 'generated' ELSE 'generation_failed' END
      WHERE id = v_delivery_id;
      
    WHEN 'email_sent' THEN
      UPDATE product_deliveries SET
        email_sent_at = now(),
        email_success = p_success,
        email_error = p_error,
        status = CASE WHEN p_success THEN 'delivered' ELSE 'email_failed' END
      WHERE id = v_delivery_id;
      
    ELSE
      UPDATE product_deliveries SET
        status = p_step,
        metadata = COALESCE(metadata, '{}'::JSONB) || COALESCE(p_metadata, '{}'::JSONB)
      WHERE id = v_delivery_id;
  END CASE;
  
  RETURN v_delivery_id;
END;
$$;

-- Function to get delivery health stats
CREATE OR REPLACE FUNCTION public.get_delivery_health(p_hours_back INTEGER DEFAULT 24)
RETURNS TABLE(
  total_orders INTEGER,
  fully_delivered INTEGER,
  generation_failed INTEGER,
  email_failed INTEGER,
  pending INTEGER,
  delivery_rate NUMERIC,
  avg_generation_time_ms NUMERIC,
  recent_failures JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH stats AS (
    SELECT
      COUNT(*)::INTEGER as total,
      COUNT(*) FILTER (WHERE status = 'delivered')::INTEGER as delivered,
      COUNT(*) FILTER (WHERE status = 'generation_failed')::INTEGER as gen_failed,
      COUNT(*) FILTER (WHERE status = 'email_failed')::INTEGER as mail_failed,
      COUNT(*) FILTER (WHERE status IN ('payment_received', 'generating', 'generated'))::INTEGER as in_progress,
      AVG(generation_duration_ms) FILTER (WHERE generation_success = true) as avg_gen_time
    FROM product_deliveries
    WHERE created_at >= now() - (p_hours_back || ' hours')::INTERVAL
  ),
  failures AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'session_id', stripe_session_id,
        'email', customer_email,
        'product', product_name,
        'status', status,
        'error', COALESCE(generation_error, email_error),
        'created_at', created_at
      ) ORDER BY created_at DESC
    ) as recent
    FROM product_deliveries
    WHERE created_at >= now() - (p_hours_back || ' hours')::INTERVAL
      AND status IN ('generation_failed', 'email_failed')
    LIMIT 10
  )
  SELECT
    stats.total,
    stats.delivered,
    stats.gen_failed,
    stats.mail_failed,
    stats.in_progress,
    CASE WHEN stats.total > 0 
      THEN ROUND((stats.delivered::NUMERIC / stats.total) * 100, 1)
      ELSE 100
    END,
    ROUND(stats.avg_gen_time, 0),
    COALESCE(failures.recent, '[]'::JSONB)
  FROM stats, failures;
END;
$$;

-- Function to get AI quality metrics
CREATE OR REPLACE FUNCTION public.get_ai_quality_stats(p_hours_back INTEGER DEFAULT 24)
RETURNS TABLE(
  total_generations INTEGER,
  successful INTEGER,
  parse_failures INTEGER,
  success_rate NUMERIC,
  avg_duration_ms NUMERIC,
  p95_duration_ms NUMERIC,
  recent_errors JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH stats AS (
    SELECT
      COUNT(*) FILTER (WHERE content_generation_started_at IS NOT NULL)::INTEGER as total,
      COUNT(*) FILTER (WHERE generation_success = true)::INTEGER as success,
      COUNT(*) FILTER (WHERE ai_response_valid = false)::INTEGER as parse_fail,
      AVG(generation_duration_ms) FILTER (WHERE generation_success = true) as avg_dur,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY generation_duration_ms) 
        FILTER (WHERE generation_success = true) as p95_dur
    FROM product_deliveries
    WHERE created_at >= now() - (p_hours_back || ' hours')::INTERVAL
  ),
  errors AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'product', product_type,
        'error', ai_parse_error,
        'duration_ms', generation_duration_ms,
        'created_at', created_at
      ) ORDER BY created_at DESC
    ) as recent
    FROM product_deliveries
    WHERE created_at >= now() - (p_hours_back || ' hours')::INTERVAL
      AND ai_response_valid = false
    LIMIT 10
  )
  SELECT
    stats.total,
    stats.success,
    stats.parse_fail,
    CASE WHEN stats.total > 0 
      THEN ROUND((stats.success::NUMERIC / stats.total) * 100, 1)
      ELSE 100
    END,
    ROUND(stats.avg_dur, 0),
    ROUND(stats.p95_dur::NUMERIC, 0),
    COALESCE(errors.recent, '[]'::JSONB)
  FROM stats, errors;
END;
$$;

-- Function to get checkout funnel stats
CREATE OR REPLACE FUNCTION public.get_checkout_funnel(p_hours_back INTEGER DEFAULT 24)
RETURNS TABLE(
  checkouts_started INTEGER,
  payments_completed INTEGER,
  content_generated INTEGER,
  fully_delivered INTEGER,
  checkout_to_payment_rate NUMERIC,
  payment_to_delivery_rate NUMERIC,
  end_to_end_rate NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH delivery_stats AS (
    SELECT
      COUNT(*)::INTEGER as payments,
      COUNT(*) FILTER (WHERE generation_success = true)::INTEGER as generated,
      COUNT(*) FILTER (WHERE status = 'delivered')::INTEGER as delivered
    FROM product_deliveries
    WHERE created_at >= now() - (p_hours_back || ' hours')::INTERVAL
  ),
  checkout_stats AS (
    -- Estimate checkouts started from Stripe sessions that were created
    -- For now, use payments as proxy (we'd need to track checkout.session.created events)
    SELECT COUNT(*)::INTEGER as started
    FROM used_stripe_sessions
    WHERE used_at >= now() - (p_hours_back || ' hours')::INTERVAL
  )
  SELECT
    GREATEST(checkout_stats.started, delivery_stats.payments),
    delivery_stats.payments,
    delivery_stats.generated,
    delivery_stats.delivered,
    CASE WHEN checkout_stats.started > 0 
      THEN ROUND((delivery_stats.payments::NUMERIC / checkout_stats.started) * 100, 1)
      ELSE 100
    END,
    CASE WHEN delivery_stats.payments > 0 
      THEN ROUND((delivery_stats.delivered::NUMERIC / delivery_stats.payments) * 100, 1)
      ELSE 100
    END,
    CASE WHEN checkout_stats.started > 0 
      THEN ROUND((delivery_stats.delivered::NUMERIC / checkout_stats.started) * 100, 1)
      ELSE 100
    END
  FROM delivery_stats, checkout_stats;
END;
$$;