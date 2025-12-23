-- Webhook event logging
CREATE TABLE public.webhook_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  payload JSONB,
  processed BOOLEAN DEFAULT false,
  processing_error TEXT,
  processing_time_ms INTEGER
);

-- Alert tracking (avoid spam)
CREATE TABLE public.alert_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  alert_type TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  threshold_value NUMERIC,
  actual_value NUMERIC,
  sent_to TEXT,
  sent_successfully BOOLEAN DEFAULT false
);

-- Parse failure tracking
CREATE TABLE public.parse_failures (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  file_type TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  file_size_bytes INTEGER,
  visitor_id TEXT,
  metadata JSONB
);

-- Enable RLS
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parse_failures ENABLE ROW LEVEL SECURITY;

-- Service-only policies
CREATE POLICY "Service role only" ON public.webhook_events FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY "Service role only" ON public.alert_log FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY "Service role only" ON public.parse_failures FOR ALL USING (false) WITH CHECK (false);

-- Webhook health stats function
CREATE OR REPLACE FUNCTION public.get_webhook_health(p_hours_back INTEGER DEFAULT 24)
RETURNS TABLE (
  total_received BIGINT,
  processed_successfully BIGINT,
  processing_failed BIGINT,
  success_rate NUMERIC,
  avg_processing_time_ms NUMERIC,
  events_by_type JSONB,
  recent_failures JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT as total_received,
    COUNT(*) FILTER (WHERE processed = true AND processing_error IS NULL)::BIGINT as processed_successfully,
    COUNT(*) FILTER (WHERE processing_error IS NOT NULL)::BIGINT as processing_failed,
    ROUND(
      CASE WHEN COUNT(*) > 0 
      THEN (COUNT(*) FILTER (WHERE processed = true AND processing_error IS NULL)::NUMERIC / COUNT(*)::NUMERIC) * 100 
      ELSE 100 END, 1
    ) as success_rate,
    ROUND(AVG(processing_time_ms)::NUMERIC, 0) as avg_processing_time_ms,
    COALESCE(
      jsonb_object_agg(sub.event_type, sub.cnt) FILTER (WHERE sub.event_type IS NOT NULL),
      '{}'::jsonb
    ) as events_by_type,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'event_type', w.event_type,
        'error', w.processing_error,
        'created_at', w.created_at
      ) ORDER BY w.created_at DESC)
      FROM webhook_events w
      WHERE w.processing_error IS NOT NULL
        AND w.created_at > now() - (p_hours_back || ' hours')::interval
      LIMIT 5),
      '[]'::jsonb
    ) as recent_failures
  FROM webhook_events we
  LEFT JOIN LATERAL (
    SELECT event_type, COUNT(*) as cnt
    FROM webhook_events
    WHERE created_at > now() - (p_hours_back || ' hours')::interval
    GROUP BY event_type
  ) sub ON true
  WHERE we.created_at > now() - (p_hours_back || ' hours')::interval;
END;
$$;

-- Parse failure stats function
CREATE OR REPLACE FUNCTION public.get_parse_failure_stats(p_hours_back INTEGER DEFAULT 24)
RETURNS TABLE (
  total_failures BIGINT,
  pdf_failures BIGINT,
  docx_failures BIGINT,
  spreadsheet_failures BIGINT,
  common_errors JSONB,
  recent_failures JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT as total_failures,
    COUNT(*) FILTER (WHERE file_type = 'pdf')::BIGINT as pdf_failures,
    COUNT(*) FILTER (WHERE file_type = 'docx')::BIGINT as docx_failures,
    COUNT(*) FILTER (WHERE file_type = 'spreadsheet')::BIGINT as spreadsheet_failures,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('error', error_code, 'count', cnt))
       FROM (
         SELECT error_code, COUNT(*) as cnt
         FROM parse_failures
         WHERE created_at > now() - (p_hours_back || ' hours')::interval
         GROUP BY error_code
         ORDER BY cnt DESC
         LIMIT 5
       ) top_errors),
      '[]'::jsonb
    ) as common_errors,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'file_type', pf.file_type,
        'error', pf.error_message,
        'created_at', pf.created_at
      ) ORDER BY pf.created_at DESC)
      FROM parse_failures pf
      WHERE pf.created_at > now() - (p_hours_back || ' hours')::interval
      LIMIT 5),
      '[]'::jsonb
    ) as recent_failures
  FROM parse_failures
  WHERE created_at > now() - (p_hours_back || ' hours')::interval;
END;
$$;

-- Log webhook event function
CREATE OR REPLACE FUNCTION public.log_webhook_event(
  p_event_type TEXT,
  p_event_id TEXT,
  p_payload JSONB DEFAULT NULL,
  p_processed BOOLEAN DEFAULT false,
  p_error TEXT DEFAULT NULL,
  p_time_ms INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO webhook_events (event_type, event_id, payload, processed, processing_error, processing_time_ms)
  VALUES (p_event_type, p_event_id, p_payload, p_processed, p_error, p_time_ms)
  ON CONFLICT (event_id) DO UPDATE SET
    processed = EXCLUDED.processed,
    processing_error = EXCLUDED.processing_error,
    processing_time_ms = EXCLUDED.processing_time_ms
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$$;

-- Log parse failure function
CREATE OR REPLACE FUNCTION public.log_parse_failure(
  p_file_type TEXT,
  p_error_code TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_file_size INTEGER DEFAULT NULL,
  p_visitor_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO parse_failures (file_type, error_code, error_message, file_size_bytes, visitor_id, metadata)
  VALUES (p_file_type, p_error_code, p_error_message, p_file_size, p_visitor_id, p_metadata)
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$$;

-- Check if alert was recently sent (cooldown)
CREATE OR REPLACE FUNCTION public.should_send_alert(
  p_alert_type TEXT,
  p_metric_name TEXT,
  p_cooldown_minutes INTEGER DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM alert_log
    WHERE alert_type = p_alert_type
      AND metric_name = p_metric_name
      AND sent_successfully = true
      AND created_at > now() - (p_cooldown_minutes || ' minutes')::interval
  );
END;
$$;

-- Log alert sent
CREATE OR REPLACE FUNCTION public.log_alert_sent(
  p_alert_type TEXT,
  p_metric_name TEXT,
  p_threshold NUMERIC,
  p_actual NUMERIC,
  p_sent_to TEXT,
  p_success BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO alert_log (alert_type, metric_name, threshold_value, actual_value, sent_to, sent_successfully)
  VALUES (p_alert_type, p_metric_name, p_threshold, p_actual, p_sent_to, p_success)
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$$;