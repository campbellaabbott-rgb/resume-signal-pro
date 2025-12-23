-- Function to detect error spikes for individual users
CREATE OR REPLACE FUNCTION public.detect_user_error_spikes(
  p_spike_threshold integer DEFAULT 5,
  p_recent_minutes integer DEFAULT 15,
  p_baseline_hours integer DEFAULT 24
)
RETURNS TABLE (
  visitor_id text,
  recent_error_count bigint,
  baseline_hourly_rate numeric,
  spike_multiplier numeric,
  recent_error_types text[],
  last_error_at timestamptz,
  is_spike boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH recent_errors AS (
    SELECT 
      e.visitor_id,
      COUNT(*) as recent_count,
      array_agg(DISTINCT e.error_type) as error_types,
      MAX(e.created_at) as last_error
    FROM error_telemetry e
    WHERE e.created_at > NOW() - (p_recent_minutes || ' minutes')::interval
      AND e.visitor_id IS NOT NULL
    GROUP BY e.visitor_id
    HAVING COUNT(*) >= p_spike_threshold
  ),
  baseline_errors AS (
    SELECT 
      e.visitor_id,
      COUNT(*)::numeric / p_baseline_hours as hourly_rate
    FROM error_telemetry e
    WHERE e.created_at > NOW() - (p_baseline_hours || ' hours')::interval
      AND e.created_at <= NOW() - (p_recent_minutes || ' minutes')::interval
      AND e.visitor_id IS NOT NULL
    GROUP BY e.visitor_id
  )
  SELECT 
    r.visitor_id,
    r.recent_count,
    COALESCE(b.hourly_rate, 0) as baseline_hourly_rate,
    CASE 
      WHEN COALESCE(b.hourly_rate, 0) = 0 THEN r.recent_count::numeric
      ELSE (r.recent_count::numeric / (p_recent_minutes::numeric / 60)) / b.hourly_rate
    END as spike_multiplier,
    r.error_types,
    r.last_error,
    CASE 
      WHEN COALESCE(b.hourly_rate, 0) = 0 THEN r.recent_count >= p_spike_threshold
      ELSE (r.recent_count::numeric / (p_recent_minutes::numeric / 60)) > (b.hourly_rate * 3)
    END as is_spike
  FROM recent_errors r
  LEFT JOIN baseline_errors b ON r.visitor_id = b.visitor_id
  ORDER BY r.recent_count DESC;
END;
$$;

-- Function to get error summary by type for diagnostics
CREATE OR REPLACE FUNCTION public.get_error_diagnostics(
  p_hours_back integer DEFAULT 24
)
RETURNS TABLE (
  error_type text,
  error_code text,
  error_count bigint,
  unique_users bigint,
  avg_per_user numeric,
  most_recent timestamptz,
  sample_message text,
  affected_functions text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.error_type,
    e.error_code,
    COUNT(*) as error_count,
    COUNT(DISTINCT e.visitor_id) as unique_users,
    ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT e.visitor_id), 0), 2) as avg_per_user,
    MAX(e.created_at) as most_recent,
    (array_agg(e.error_message ORDER BY e.created_at DESC))[1] as sample_message,
    array_agg(DISTINCT e.function_name) FILTER (WHERE e.function_name IS NOT NULL) as affected_functions
  FROM error_telemetry e
  WHERE e.created_at > NOW() - (p_hours_back || ' hours')::interval
  GROUP BY e.error_type, e.error_code
  ORDER BY error_count DESC;
END;
$$;

-- Function to check if current user is experiencing issues
CREATE OR REPLACE FUNCTION public.check_user_health(
  p_visitor_id text
)
RETURNS TABLE (
  status text,
  recent_errors bigint,
  error_trend text,
  primary_issue text,
  recommendation text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_count bigint;
  v_older_count bigint;
  v_primary_error text;
BEGIN
  -- Count recent errors (last 15 mins)
  SELECT COUNT(*) INTO v_recent_count
  FROM error_telemetry
  WHERE visitor_id = p_visitor_id
    AND created_at > NOW() - interval '15 minutes';
  
  -- Count older errors (15-60 mins ago)
  SELECT COUNT(*) INTO v_older_count
  FROM error_telemetry
  WHERE visitor_id = p_visitor_id
    AND created_at > NOW() - interval '60 minutes'
    AND created_at <= NOW() - interval '15 minutes';
  
  -- Get most common recent error
  SELECT error_type INTO v_primary_error
  FROM error_telemetry
  WHERE visitor_id = p_visitor_id
    AND created_at > NOW() - interval '15 minutes'
  GROUP BY error_type
  ORDER BY COUNT(*) DESC
  LIMIT 1;
  
  RETURN QUERY
  SELECT 
    CASE 
      WHEN v_recent_count = 0 THEN 'healthy'
      WHEN v_recent_count >= 5 THEN 'critical'
      WHEN v_recent_count >= 2 THEN 'degraded'
      ELSE 'minor_issues'
    END as status,
    v_recent_count as recent_errors,
    CASE 
      WHEN v_recent_count > v_older_count * 2 THEN 'worsening'
      WHEN v_recent_count < v_older_count / 2 THEN 'improving'
      ELSE 'stable'
    END as error_trend,
    COALESCE(v_primary_error, 'none') as primary_issue,
    CASE 
      WHEN v_recent_count = 0 THEN 'No action needed'
      WHEN v_primary_error = 'rate_limit' THEN 'Consider upgrading or waiting before retrying'
      WHEN v_primary_error = 'api_error' THEN 'Service may be experiencing issues, try again shortly'
      WHEN v_primary_error = 'client_error' THEN 'Please refresh the page or clear browser cache'
      ELSE 'Contact support if issues persist'
    END as recommendation;
END;
$$;