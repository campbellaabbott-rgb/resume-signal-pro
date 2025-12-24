-- Restrict public INSERT access on operational metrics tables
-- Edge Functions use SUPABASE_SERVICE_ROLE_KEY which bypasses RLS entirely

-- Drop the permissive public INSERT policies
DROP POLICY IF EXISTS "Allow public insert of scan metrics" ON public.scan_metrics;
DROP POLICY IF EXISTS "Allow public insert of heartbeat results" ON public.heartbeat_results;

-- Create restrictive INSERT policies (service role bypasses these)
CREATE POLICY "Service role only insert scan metrics" 
  ON public.scan_metrics FOR INSERT WITH CHECK (false);

CREATE POLICY "Service role only insert heartbeat results" 
  ON public.heartbeat_results FOR INSERT WITH CHECK (false);