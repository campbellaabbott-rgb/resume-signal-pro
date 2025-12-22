
-- Fix get_affiliate_clicks to count unique visitors by ip_hash when referrer is null
CREATE OR REPLACE FUNCTION public.get_affiliate_clicks(p_session_token text, p_days_back integer DEFAULT 30)
 RETURNS TABLE(click_date date, click_count bigint, unique_referrers bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Count unique visitors: prefer ip_hash, fallback to referrer, then user_agent
    COUNT(DISTINCT COALESCE(ip_hash, referrer, user_agent, 'unknown')) as unique_referrers
  FROM affiliate_clicks
  WHERE affiliate_id = v_affiliate_id
    AND created_at > NOW() - (p_days_back || ' days')::INTERVAL
  GROUP BY DATE(created_at)
  ORDER BY click_date DESC;
END;
$function$;
