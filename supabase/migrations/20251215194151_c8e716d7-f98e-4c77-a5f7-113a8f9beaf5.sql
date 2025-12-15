-- Update get_analysis_by_share_id with input validation
CREATE OR REPLACE FUNCTION public.get_analysis_by_share_id(share_id_param text)
RETURNS TABLE(id uuid, analysis_result jsonb, created_at timestamp with time zone, share_id text, resume_text text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validate share_id format (24 hex characters)
  IF share_id_param IS NULL OR share_id_param !~ '^[a-f0-9]{24}$' THEN
    RAISE EXCEPTION 'Invalid share_id format';
  END IF;
  
  RETURN QUERY
  SELECT 
    ra.id, 
    ra.analysis_result, 
    ra.created_at, 
    ra.share_id,
    ra.resume_text
  FROM resume_analyses ra
  WHERE ra.share_id = share_id_param;
END;
$$;