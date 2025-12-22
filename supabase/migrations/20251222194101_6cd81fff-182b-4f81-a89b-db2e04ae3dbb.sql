-- Create function to get affiliate click history with date filtering
CREATE OR REPLACE FUNCTION public.get_affiliate_clicks(
  p_session_token text,
  p_days_back integer DEFAULT 30
)
RETURNS TABLE(
  click_date date,
  click_count bigint,
  unique_referrers bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_affiliate_id UUID;
BEGIN
  -- Validate session
  SELECT affiliate_id INTO v_affiliate_id
  FROM affiliate_sessions
  WHERE session_token = p_session_token
    AND expires_at > now();
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired session';
  END IF;
  
  RETURN QUERY
  SELECT 
    DATE(created_at) as click_date,
    COUNT(*) as click_count,
    COUNT(DISTINCT referrer) as unique_referrers
  FROM affiliate_clicks
  WHERE affiliate_id = v_affiliate_id
    AND created_at > NOW() - (p_days_back || ' days')::INTERVAL
  GROUP BY DATE(created_at)
  ORDER BY click_date DESC;
END;
$$;

-- Create function to get affiliate stats with date range
CREATE OR REPLACE FUNCTION public.get_affiliate_stats_by_date(
  p_session_token text,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS TABLE(
  total_clicks bigint,
  total_conversions bigint,
  total_revenue bigint,
  pending_payout bigint,
  paid_out bigint,
  conversion_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_affiliate_id UUID;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  -- Validate session
  SELECT affiliate_id INTO v_affiliate_id
  FROM affiliate_sessions
  WHERE session_token = p_session_token
    AND expires_at > now();
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired session';
  END IF;
  
  -- Set date range (default to all time if not specified)
  v_start := COALESCE(p_start_date::timestamptz, '1970-01-01'::timestamptz);
  v_end := COALESCE((p_end_date + interval '1 day')::timestamptz, now() + interval '1 day');
  
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM affiliate_clicks 
     WHERE affiliate_id = v_affiliate_id 
       AND created_at >= v_start AND created_at < v_end) as total_clicks,
    (SELECT COUNT(*) FROM affiliate_conversions 
     WHERE affiliate_id = v_affiliate_id 
       AND status != 'rejected'
       AND created_at >= v_start AND created_at < v_end) as total_conversions,
    (SELECT COALESCE(SUM(sale_amount), 0) FROM affiliate_conversions 
     WHERE affiliate_id = v_affiliate_id 
       AND status != 'rejected'
       AND created_at >= v_start AND created_at < v_end) as total_revenue,
    (SELECT COALESCE(SUM(commission_amount), 0) FROM affiliate_conversions 
     WHERE affiliate_id = v_affiliate_id 
       AND status = 'approved'
       AND created_at >= v_start AND created_at < v_end) as pending_payout,
    (SELECT COALESCE(SUM(commission_amount), 0) FROM affiliate_conversions 
     WHERE affiliate_id = v_affiliate_id 
       AND status = 'paid'
       AND created_at >= v_start AND created_at < v_end) as paid_out,
    CASE 
      WHEN (SELECT COUNT(*) FROM affiliate_clicks 
            WHERE affiliate_id = v_affiliate_id 
              AND created_at >= v_start AND created_at < v_end) > 0 
      THEN ROUND(
        (SELECT COUNT(*)::NUMERIC FROM affiliate_conversions 
         WHERE affiliate_id = v_affiliate_id 
           AND status != 'rejected'
           AND created_at >= v_start AND created_at < v_end) / 
        (SELECT COUNT(*)::NUMERIC FROM affiliate_clicks 
         WHERE affiliate_id = v_affiliate_id 
           AND created_at >= v_start AND created_at < v_end) * 100, 2
      )
      ELSE 0
    END as conversion_rate;
END;
$$;