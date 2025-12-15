-- Create a security definer function to access analyses by share_id only
CREATE OR REPLACE FUNCTION public.get_analysis_by_share_id(share_id_param TEXT)
RETURNS TABLE (
  id UUID,
  analysis_result JSONB,
  created_at TIMESTAMPTZ,
  share_id TEXT,
  resume_text TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, analysis_result, created_at, share_id, resume_text 
  FROM resume_analyses 
  WHERE share_id = share_id_param;
$$;

-- Drop the overly permissive SELECT policy
DROP POLICY IF EXISTS "Anyone can view analyses" ON public.resume_analyses;

-- Create a new restrictive SELECT policy that denies direct table access
-- Users must use the security definer function instead
CREATE POLICY "No direct table access" 
ON public.resume_analyses 
FOR SELECT 
USING (false);