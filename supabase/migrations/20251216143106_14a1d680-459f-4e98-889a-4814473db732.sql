-- Add a global rate limit function that limits total requests across ALL edge functions
-- This provides defense-in-depth against distributed attacks

CREATE OR REPLACE FUNCTION public.check_global_rate_limit(
  p_ip text,
  p_max_requests integer DEFAULT 100,
  p_window_minutes integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total_count INT;
  v_window_cutoff TIMESTAMPTZ;
BEGIN
  v_window_cutoff := NOW() - (p_window_minutes || ' minutes')::INTERVAL;
  
  -- Count total requests across ALL functions for this IP within the window
  SELECT COALESCE(SUM(request_count), 0) INTO v_total_count
  FROM public.rate_limits
  WHERE ip_address = p_ip 
    AND window_start >= v_window_cutoff;
  
  -- Check if global limit exceeded
  IF v_total_count >= p_max_requests THEN
    RETURN FALSE;
  END IF;
  
  RETURN TRUE;
END;
$$;