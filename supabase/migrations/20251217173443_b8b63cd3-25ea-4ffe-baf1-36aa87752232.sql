-- Add explicit RLS policies to free_scan_leads table
-- Currently relies on default-deny; adding explicit policies for clarity

-- Policy: Only service role can insert (via RPC function save_free_scan_lead)
CREATE POLICY "Service role only insert" 
ON public.free_scan_leads 
FOR INSERT 
TO service_role
WITH CHECK (true);

-- Policy: Only service role can select (for admin purposes)
CREATE POLICY "Service role only select" 
ON public.free_scan_leads 
FOR SELECT 
TO service_role
USING (true);

-- Create cleanup function for used_stripe_sessions (30-day retention)
CREATE OR REPLACE FUNCTION public.cleanup_expired_stripe_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM used_stripe_sessions 
  WHERE used_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Create cleanup function for rate_limits (cleanup old entries)
CREATE OR REPLACE FUNCTION public.cleanup_old_rate_limits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM rate_limits 
  WHERE window_start < NOW() - INTERVAL '24 hours';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;