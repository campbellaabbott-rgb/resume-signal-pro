-- Fix PUBLIC_DATA_EXPOSURE: Remove public read access to scan_metrics and heartbeat_results

-- Drop the overly permissive public read policies
DROP POLICY IF EXISTS "Allow public read of scan metrics" ON public.scan_metrics;
DROP POLICY IF EXISTS "Allow public read of heartbeat results" ON public.heartbeat_results;

-- Create service-role-only read policies (false = blocked for anon, service role bypasses RLS)
CREATE POLICY "Service role only read scan metrics" 
  ON public.scan_metrics FOR SELECT 
  USING (false);

CREATE POLICY "Service role only read heartbeat results" 
  ON public.heartbeat_results FOR SELECT 
  USING (false);