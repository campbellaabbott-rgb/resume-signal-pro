-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Service role can manage credits" ON public.user_scan_credits;

-- Create restrictive policy - blocks all public access
-- Service role bypasses RLS, so edge functions will still work
CREATE POLICY "No public access to credits"
ON public.user_scan_credits
FOR ALL
USING (false)
WITH CHECK (false);