-- Extend temp_resume_storage default expiry from 1 hour to 24 hours
ALTER TABLE public.temp_resume_storage 
ALTER COLUMN expires_at SET DEFAULT (now() + '24 hours'::interval);

-- Update existing unexpired records to have more time
UPDATE public.temp_resume_storage 
SET expires_at = created_at + '24 hours'::interval
WHERE expires_at > now();

-- Recreate get_temp_resume to NOT delete data (just read it)
-- This allows both frontend and webhook to access the same resume data
CREATE OR REPLACE FUNCTION public.get_temp_resume(p_session_id uuid)
RETURNS TABLE (
  resume_text text,
  job_description_text text,
  linkedin_text text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Just return the data without deleting
  -- Data will be cleaned up by the expiry mechanism
  RETURN QUERY
  SELECT 
    t.resume_text,
    t.job_description_text,
    t.linkedin_text
  FROM temp_resume_storage t
  WHERE t.session_id = p_session_id
    AND t.expires_at > now();
END;
$$;

-- Create cleanup function for expired resume data (runs periodically)
CREATE OR REPLACE FUNCTION public.cleanup_expired_temp_resumes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM temp_resume_storage
  WHERE expires_at < now();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;