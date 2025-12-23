-- Create scan_metrics table for tracking individual scan outcomes
CREATE TABLE public.scan_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  scan_type TEXT NOT NULL DEFAULT 'free', -- 'free', 'paid', 'heartbeat'
  status TEXT NOT NULL, -- 'started', 'completed', 'failed', 'validation_error'
  duration_ms INTEGER,
  cache_hit BOOLEAN DEFAULT false,
  ai_model TEXT,
  error_code TEXT,
  error_message TEXT,
  ip_country TEXT,
  visitor_id TEXT,
  input_length INTEGER,
  output_valid BOOLEAN,
  response_score INTEGER, -- ATS score returned
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Create heartbeat_results table for uptime monitoring
CREATE TABLE public.heartbeat_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  function_name TEXT NOT NULL,
  status TEXT NOT NULL, -- 'healthy', 'degraded', 'down'
  response_time_ms INTEGER,
  test_passed BOOLEAN NOT NULL,
  error_message TEXT,
  checks_passed JSONB DEFAULT '{}'::jsonb, -- individual check results
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Create indexes for efficient querying
CREATE INDEX idx_scan_metrics_created_at ON public.scan_metrics(created_at DESC);
CREATE INDEX idx_scan_metrics_status ON public.scan_metrics(status);
CREATE INDEX idx_scan_metrics_scan_type ON public.scan_metrics(scan_type);
CREATE INDEX idx_scan_metrics_cache_hit ON public.scan_metrics(cache_hit);
CREATE INDEX idx_heartbeat_created_at ON public.heartbeat_results(created_at DESC);
CREATE INDEX idx_heartbeat_function ON public.heartbeat_results(function_name);
CREATE INDEX idx_heartbeat_status ON public.heartbeat_results(status);

-- Enable RLS but allow public inserts (for edge functions)
ALTER TABLE public.scan_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heartbeat_results ENABLE ROW LEVEL SECURITY;

-- Allow edge functions to insert/read (using service role or anon for internal use)
CREATE POLICY "Allow public read of scan metrics" ON public.scan_metrics
  FOR SELECT USING (true);

CREATE POLICY "Allow public insert of scan metrics" ON public.scan_metrics
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public read of heartbeat results" ON public.heartbeat_results
  FOR SELECT USING (true);

CREATE POLICY "Allow public insert of heartbeat results" ON public.heartbeat_results
  FOR INSERT WITH CHECK (true);

-- Function to get scan success rate
CREATE OR REPLACE FUNCTION public.get_scan_success_rate(
  p_hours_back INTEGER DEFAULT 24,
  p_scan_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  total_scans BIGINT,
  completed_scans BIGINT,
  failed_scans BIGINT,
  validation_errors BIGINT,
  success_rate NUMERIC,
  avg_duration_ms NUMERIC,
  p50_duration_ms NUMERIC,
  p95_duration_ms NUMERIC,
  cache_hit_rate NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT as total_scans,
    COUNT(*) FILTER (WHERE sm.status = 'completed')::BIGINT as completed_scans,
    COUNT(*) FILTER (WHERE sm.status = 'failed')::BIGINT as failed_scans,
    COUNT(*) FILTER (WHERE sm.status = 'validation_error')::BIGINT as validation_errors,
    ROUND(
      (COUNT(*) FILTER (WHERE sm.status = 'completed')::NUMERIC / NULLIF(COUNT(*), 0) * 100), 2
    ) as success_rate,
    ROUND(AVG(sm.duration_ms)::NUMERIC, 0) as avg_duration_ms,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sm.duration_ms)::NUMERIC, 0) as p50_duration_ms,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY sm.duration_ms)::NUMERIC, 0) as p95_duration_ms,
    ROUND(
      (COUNT(*) FILTER (WHERE sm.cache_hit = true)::NUMERIC / NULLIF(COUNT(*), 0) * 100), 2
    ) as cache_hit_rate
  FROM public.scan_metrics sm
  WHERE sm.created_at > now() - (p_hours_back || ' hours')::INTERVAL
    AND (p_scan_type IS NULL OR sm.scan_type = p_scan_type);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to get scan metrics by hour for trending
CREATE OR REPLACE FUNCTION public.get_scan_metrics_hourly(
  p_hours_back INTEGER DEFAULT 24
)
RETURNS TABLE (
  hour_bucket TIMESTAMP WITH TIME ZONE,
  total_scans BIGINT,
  completed_scans BIGINT,
  failed_scans BIGINT,
  avg_duration_ms NUMERIC,
  cache_hit_rate NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    date_trunc('hour', sm.created_at) as hour_bucket,
    COUNT(*)::BIGINT as total_scans,
    COUNT(*) FILTER (WHERE sm.status = 'completed')::BIGINT as completed_scans,
    COUNT(*) FILTER (WHERE sm.status = 'failed')::BIGINT as failed_scans,
    ROUND(AVG(sm.duration_ms)::NUMERIC, 0) as avg_duration_ms,
    ROUND(
      (COUNT(*) FILTER (WHERE sm.cache_hit = true)::NUMERIC / NULLIF(COUNT(*), 0) * 100), 2
    ) as cache_hit_rate
  FROM public.scan_metrics sm
  WHERE sm.created_at > now() - (p_hours_back || ' hours')::INTERVAL
  GROUP BY date_trunc('hour', sm.created_at)
  ORDER BY hour_bucket DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to get geographic failure distribution
CREATE OR REPLACE FUNCTION public.get_scan_geo_stats(
  p_hours_back INTEGER DEFAULT 24
)
RETURNS TABLE (
  country TEXT,
  total_scans BIGINT,
  failed_scans BIGINT,
  failure_rate NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(sm.ip_country, 'Unknown') as country,
    COUNT(*)::BIGINT as total_scans,
    COUNT(*) FILTER (WHERE sm.status IN ('failed', 'validation_error'))::BIGINT as failed_scans,
    ROUND(
      (COUNT(*) FILTER (WHERE sm.status IN ('failed', 'validation_error'))::NUMERIC / NULLIF(COUNT(*), 0) * 100), 2
    ) as failure_rate
  FROM public.scan_metrics sm
  WHERE sm.created_at > now() - (p_hours_back || ' hours')::INTERVAL
  GROUP BY COALESCE(sm.ip_country, 'Unknown')
  ORDER BY total_scans DESC
  LIMIT 20;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to check current scan health status
CREATE OR REPLACE FUNCTION public.get_scan_health_status()
RETURNS TABLE (
  status TEXT,
  last_successful_scan TIMESTAMP WITH TIME ZONE,
  scans_last_hour BIGINT,
  success_rate_last_hour NUMERIC,
  avg_latency_last_hour NUMERIC,
  last_heartbeat_status TEXT,
  last_heartbeat_time TIMESTAMP WITH TIME ZONE,
  issues TEXT[]
) AS $$
DECLARE
  v_issues TEXT[] := '{}';
  v_success_rate NUMERIC;
  v_avg_latency NUMERIC;
  v_scans_count BIGINT;
  v_last_success TIMESTAMP WITH TIME ZONE;
  v_heartbeat_status TEXT;
  v_heartbeat_time TIMESTAMP WITH TIME ZONE;
  v_overall_status TEXT := 'healthy';
BEGIN
  -- Get metrics from last hour
  SELECT 
    COUNT(*),
    ROUND((COUNT(*) FILTER (WHERE sm.status = 'completed')::NUMERIC / NULLIF(COUNT(*), 0) * 100), 2),
    ROUND(AVG(sm.duration_ms)::NUMERIC, 0)
  INTO v_scans_count, v_success_rate, v_avg_latency
  FROM public.scan_metrics sm
  WHERE sm.created_at > now() - interval '1 hour';

  -- Get last successful scan
  SELECT sm.created_at INTO v_last_success
  FROM public.scan_metrics sm
  WHERE sm.status = 'completed'
  ORDER BY sm.created_at DESC
  LIMIT 1;

  -- Get last heartbeat
  SELECT hr.status, hr.created_at INTO v_heartbeat_status, v_heartbeat_time
  FROM public.heartbeat_results hr
  WHERE hr.function_name = 'free-keyword-scan'
  ORDER BY hr.created_at DESC
  LIMIT 1;

  -- Determine issues and overall status
  IF v_success_rate IS NOT NULL AND v_success_rate < 90 THEN
    v_issues := array_append(v_issues, 'Success rate below 90%: ' || v_success_rate || '%');
    v_overall_status := 'degraded';
  END IF;

  IF v_success_rate IS NOT NULL AND v_success_rate < 50 THEN
    v_overall_status := 'critical';
  END IF;

  IF v_avg_latency IS NOT NULL AND v_avg_latency > 30000 THEN
    v_issues := array_append(v_issues, 'High latency: ' || v_avg_latency || 'ms');
    IF v_overall_status = 'healthy' THEN v_overall_status := 'degraded'; END IF;
  END IF;

  IF v_last_success IS NULL OR v_last_success < now() - interval '1 hour' THEN
    v_issues := array_append(v_issues, 'No successful scans in last hour');
    v_overall_status := 'critical';
  END IF;

  IF v_heartbeat_status IS NOT NULL AND v_heartbeat_status != 'healthy' THEN
    v_issues := array_append(v_issues, 'Last heartbeat: ' || v_heartbeat_status);
    IF v_overall_status = 'healthy' THEN v_overall_status := 'degraded'; END IF;
  END IF;

  RETURN QUERY SELECT
    v_overall_status,
    v_last_success,
    COALESCE(v_scans_count, 0),
    COALESCE(v_success_rate, 0),
    COALESCE(v_avg_latency, 0),
    v_heartbeat_status,
    v_heartbeat_time,
    v_issues;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to log scan metric (called from edge function)
CREATE OR REPLACE FUNCTION public.log_scan_metric(
  p_scan_type TEXT DEFAULT 'free',
  p_status TEXT DEFAULT 'started',
  p_duration_ms INTEGER DEFAULT NULL,
  p_cache_hit BOOLEAN DEFAULT false,
  p_ai_model TEXT DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_ip_country TEXT DEFAULT NULL,
  p_visitor_id TEXT DEFAULT NULL,
  p_input_length INTEGER DEFAULT NULL,
  p_output_valid BOOLEAN DEFAULT NULL,
  p_response_score INTEGER DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.scan_metrics (
    scan_type, status, duration_ms, cache_hit, ai_model,
    error_code, error_message, ip_country, visitor_id,
    input_length, output_valid, response_score, metadata
  ) VALUES (
    p_scan_type, p_status, p_duration_ms, p_cache_hit, p_ai_model,
    p_error_code, p_error_message, p_ip_country, p_visitor_id,
    p_input_length, p_output_valid, p_response_score, p_metadata
  )
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to log heartbeat result
CREATE OR REPLACE FUNCTION public.log_heartbeat_result(
  p_function_name TEXT,
  p_status TEXT,
  p_response_time_ms INTEGER,
  p_test_passed BOOLEAN,
  p_error_message TEXT DEFAULT NULL,
  p_checks_passed JSONB DEFAULT '{}'::jsonb,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.heartbeat_results (
    function_name, status, response_time_ms, test_passed,
    error_message, checks_passed, metadata
  ) VALUES (
    p_function_name, p_status, p_response_time_ms, p_test_passed,
    p_error_message, p_checks_passed, p_metadata
  )
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;