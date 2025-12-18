-- Update get_analysis_by_share_id to enforce expiration at query time
CREATE OR REPLACE FUNCTION public.get_analysis_by_share_id(share_id_param text)
RETURNS TABLE(id uuid, analysis_result jsonb, created_at timestamp with time zone, share_id text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Validate share_id format (legacy 24-hex or new 32-hex)
  IF share_id_param IS NULL OR share_id_param !~ '^([a-f0-9]{24}|[a-f0-9]{32})$' THEN
    RAISE EXCEPTION 'Invalid share_id format';
  END IF;

  RETURN QUERY
  SELECT 
    ra.id, ra.analysis_result, ra.created_at, ra.share_id
  FROM resume_analyses ra
  WHERE ra.share_id = share_id_param
    AND (ra.expires_at IS NULL OR ra.expires_at > NOW());
END;
$$;