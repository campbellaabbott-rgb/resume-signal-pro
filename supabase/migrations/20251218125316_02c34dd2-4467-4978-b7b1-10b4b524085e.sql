-- Fix 1: Block public SELECT access to free_scan_leads (contains PII - email addresses)
-- Drop the existing overly permissive SELECT policy
DROP POLICY IF EXISTS "Service role only select" ON public.free_scan_leads;

-- Create a new policy that blocks all public access (service role bypasses RLS automatically)
CREATE POLICY "Block all public select" ON public.free_scan_leads
FOR SELECT
USING (false);

-- Fix 2: Ensure ab_test_events also blocks public SELECT (contains visitor tracking data)
DROP POLICY IF EXISTS "Service role only select" ON public.ab_test_events;

CREATE POLICY "Block all public select" ON public.ab_test_events
FOR SELECT
USING (false);