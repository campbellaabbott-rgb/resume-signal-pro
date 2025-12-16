-- Create rate_limits table for persistent rate limiting
CREATE TABLE public.rate_limits (
  ip_address TEXT NOT NULL,
  function_name TEXT NOT NULL,
  request_count INT DEFAULT 1,
  window_start TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (ip_address, function_name)
);

-- Create index for cleanup queries
CREATE INDEX idx_rate_limits_window ON public.rate_limits(window_start);

-- Enable RLS (but allow service role full access)
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- No public access - only service role can access
CREATE POLICY "Service role only" ON public.rate_limits
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- Create function to check and update rate limit
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_ip TEXT,
  p_function TEXT,
  p_max_requests INT,
  p_window_minutes INT DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
  v_window_start TIMESTAMPTZ;
  v_window_cutoff TIMESTAMPTZ;
BEGIN
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
$$;