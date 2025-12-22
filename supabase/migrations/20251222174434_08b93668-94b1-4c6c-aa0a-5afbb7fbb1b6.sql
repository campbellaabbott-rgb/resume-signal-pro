-- Add RLS policies to ai_response_cache table
-- This table should only be accessible by service role

-- First check if policies exist and drop them
DROP POLICY IF EXISTS "Service role only cache access" ON public.ai_response_cache;

-- Create restrictive policy - service role only
CREATE POLICY "Service role only cache access" 
ON public.ai_response_cache 
FOR ALL 
USING (false)
WITH CHECK (false);

-- Ensure RLS is enabled
ALTER TABLE public.ai_response_cache ENABLE ROW LEVEL SECURITY;