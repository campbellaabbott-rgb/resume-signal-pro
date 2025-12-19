-- Add bounds validation to check_rate_limit function
CREATE OR REPLACE FUNCTION public.check_rate_limit(p_ip text, p_function text, p_max_requests integer, p_window_minutes integer DEFAULT 60)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count INT;
  v_window_start TIMESTAMPTZ;
  v_window_cutoff TIMESTAMPTZ;
BEGIN
  -- Validate input bounds (defense-in-depth)
  IF p_max_requests < 1 OR p_max_requests > 1000 THEN
    RAISE EXCEPTION 'Invalid rate limit value';
  END IF;
  IF p_window_minutes < 1 OR p_window_minutes > 1440 THEN
    RAISE EXCEPTION 'Invalid time window value';
  END IF;
  IF p_ip IS NULL OR length(p_ip) > 45 THEN
    RAISE EXCEPTION 'Invalid IP address';
  END IF;
  IF p_function IS NULL OR length(p_function) > 100 THEN
    RAISE EXCEPTION 'Invalid function name';
  END IF;

  v_window_cutoff := NOW() - (p_window_minutes || ' minutes')::INTERVAL;
  
  -- Clean up old entries periodically (1% chance per call)
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits WHERE window_start < v_window_cutoff;
  END IF;
  
  -- Try to get existing record
  SELECT request_count, window_start INTO v_count, v_window_start
  FROM public.rate_limits
  WHERE ip_address = p_ip AND function_name = p_function;
  
  -- No record found or window expired - create/reset
  IF NOT FOUND OR v_window_start < v_window_cutoff THEN
    INSERT INTO public.rate_limits (ip_address, function_name, request_count, window_start)
    VALUES (p_ip, p_function, 1, NOW())
    ON CONFLICT (ip_address, function_name) 
    DO UPDATE SET request_count = 1, window_start = NOW();
    RETURN TRUE;
  END IF;
  
  -- Check if limit exceeded
  IF v_count >= p_max_requests THEN
    RETURN FALSE;
  END IF;
  
  -- Increment counter
  UPDATE public.rate_limits
  SET request_count = request_count + 1
  WHERE ip_address = p_ip AND function_name = p_function;
  
  RETURN TRUE;
END;
$function$;

-- Add bounds validation to add_scan_credits function
CREATE OR REPLACE FUNCTION public.add_scan_credits(p_email text, p_credits integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Validate email format
  IF p_email IS NULL OR p_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email format';
  END IF;
  
  -- Validate credit amount bounds (defense-in-depth: prevent abuse if edge function compromised)
  IF p_credits < 1 OR p_credits > 100 THEN
    RAISE EXCEPTION 'Invalid credit amount';
  END IF;

  INSERT INTO public.user_scan_credits (email, credits_remaining, total_credits_purchased)
  VALUES (lower(trim(p_email)), p_credits, p_credits)
  ON CONFLICT (email) DO UPDATE
  SET 
    credits_remaining = user_scan_credits.credits_remaining + p_credits,
    total_credits_purchased = user_scan_credits.total_credits_purchased + p_credits,
    updated_at = now();
  RETURN true;
END;
$function$;

-- Add bounds validation to check_global_rate_limit function
CREATE OR REPLACE FUNCTION public.check_global_rate_limit(p_ip text, p_max_requests integer DEFAULT 100, p_window_minutes integer DEFAULT 60)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_count INT;
  v_window_cutoff TIMESTAMPTZ;
BEGIN
  -- Validate input bounds (defense-in-depth)
  IF p_max_requests < 1 OR p_max_requests > 1000 THEN
    RAISE EXCEPTION 'Invalid rate limit value';
  END IF;
  IF p_window_minutes < 1 OR p_window_minutes > 1440 THEN
    RAISE EXCEPTION 'Invalid time window value';
  END IF;
  IF p_ip IS NULL OR length(p_ip) > 45 THEN
    RAISE EXCEPTION 'Invalid IP address';
  END IF;

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
$function$;