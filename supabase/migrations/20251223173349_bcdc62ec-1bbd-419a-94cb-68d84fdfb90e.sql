-- Add visitor_id column to error_telemetry table for user tracking
ALTER TABLE public.error_telemetry 
ADD COLUMN IF NOT EXISTS visitor_id text;

-- Add index for efficient lookups by visitor
CREATE INDEX IF NOT EXISTS idx_error_telemetry_visitor_id ON public.error_telemetry(visitor_id);

-- Add index for recent errors
CREATE INDEX IF NOT EXISTS idx_error_telemetry_created_at ON public.error_telemetry(created_at DESC);

-- Create a function to check if a visitor has had errors
CREATE OR REPLACE FUNCTION public.get_visitor_error_history(p_visitor_id text)
RETURNS TABLE (
  total_errors bigint,
  recent_errors bigint,
  last_error_at timestamptz,
  error_types text[]
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::bigint as total_errors,
    COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::bigint as recent_errors,
    MAX(created_at) as last_error_at,
    ARRAY_AGG(DISTINCT error_type) as error_types
  FROM error_telemetry
  WHERE visitor_id = p_visitor_id;
END;
$$;