-- Drop the broken overload that returns text and tries to insert text into UUID column
DROP FUNCTION IF EXISTS public.store_temp_resume(text, text, text);

-- Recreate it properly returning UUID
CREATE FUNCTION public.store_temp_resume(
  p_resume text,
  p_linkedin text DEFAULT NULL::text,
  p_job_description text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  -- Validate inputs
  IF p_resume IS NULL OR length(p_resume) < 50 THEN
    RAISE EXCEPTION 'Invalid resume text';
  END IF;

  IF length(p_resume) > 50000 THEN
    RAISE EXCEPTION 'Resume text too long';
  END IF;

  IF p_linkedin IS NOT NULL AND length(p_linkedin) > 50000 THEN
    RAISE EXCEPTION 'LinkedIn text too long';
  END IF;

  IF p_job_description IS NOT NULL AND length(p_job_description) > 50000 THEN
    RAISE EXCEPTION 'Job description text too long';
  END IF;

  -- Opportunistic cleanup (5% chance per call)
  IF random() < 0.05 THEN
    DELETE FROM temp_resume_storage WHERE expires_at < NOW();
  END IF;

  -- Insert and return the auto-generated UUID
  INSERT INTO temp_resume_storage (resume_text, linkedin_text, job_description_text)
  VALUES (p_resume, p_linkedin, p_job_description)
  RETURNING session_id INTO v_id;

  RETURN v_id;
END;
$function$;

-- Also fix get_temp_resume to properly cast text to UUID
CREATE OR REPLACE FUNCTION public.get_temp_resume(p_session_id text)
RETURNS TABLE(resume_text text, linkedin_text text, job_description_text text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uuid uuid;
BEGIN
  -- Try to cast session_id to UUID
  BEGIN
    v_uuid := p_session_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Invalid UUID format, return empty
    RETURN;
  END;

  -- Get and delete in one operation (one-time retrieval)
  RETURN QUERY
  DELETE FROM temp_resume_storage
  WHERE session_id = v_uuid
    AND expires_at > NOW()
  RETURNING temp_resume_storage.resume_text,
            temp_resume_storage.linkedin_text,
            temp_resume_storage.job_description_text;
END;
$function$;