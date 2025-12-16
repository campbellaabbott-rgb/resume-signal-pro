-- Add job_description_text column to temp_resume_storage
ALTER TABLE public.temp_resume_storage
ADD COLUMN job_description_text text;

-- Update store_temp_resume function to accept job description
CREATE OR REPLACE FUNCTION public.store_temp_resume(p_resume text, p_linkedin text DEFAULT NULL, p_job_description text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id text;
BEGIN
  new_id := gen_random_uuid()::text;
  
  INSERT INTO temp_resume_storage (session_id, resume_text, linkedin_text, job_description_text, expires_at)
  VALUES (new_id, p_resume, p_linkedin, p_job_description, NOW() + INTERVAL '1 hour');
  
  RETURN new_id;
END;
$$;

-- Update get_temp_resume function to return job description
DROP FUNCTION IF EXISTS public.get_temp_resume(text);

CREATE OR REPLACE FUNCTION public.get_temp_resume(p_session_id text)
RETURNS TABLE(resume_text text, linkedin_text text, job_description_text text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Get and delete in one operation (one-time retrieval)
  RETURN QUERY
  DELETE FROM temp_resume_storage
  WHERE session_id = p_session_id
    AND expires_at > NOW()
  RETURNING temp_resume_storage.resume_text, temp_resume_storage.linkedin_text, temp_resume_storage.job_description_text;
END;
$$;