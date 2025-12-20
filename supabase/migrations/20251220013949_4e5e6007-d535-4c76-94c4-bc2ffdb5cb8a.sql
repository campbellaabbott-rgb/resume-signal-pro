-- Fix INPUT_VALIDATION and DEFINER_OR_RPC_BYPASS issues
-- Add comprehensive validation to SECURITY DEFINER functions

-- 1. Update get_temp_resume to validate UUID format before casting
CREATE OR REPLACE FUNCTION public.get_temp_resume(p_session_id text)
 RETURNS TABLE(resume_text text, linkedin_text text, job_description_text text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uuid uuid;
BEGIN
  -- Validate UUID format strictly BEFORE attempting cast
  IF p_session_id IS NULL OR p_session_id !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
    -- Return empty result for invalid format (don't expose error details)
    RETURN;
  END IF;

  -- Try to cast session_id to UUID (should always succeed now due to regex validation)
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

-- 2. Update store_temp_resume to have consistent validation for ALL fields
CREATE OR REPLACE FUNCTION public.store_temp_resume(p_resume text, p_linkedin text DEFAULT NULL::text, p_job_description text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  -- Validate resume (required field)
  IF p_resume IS NULL OR length(p_resume) < 50 THEN
    RAISE EXCEPTION 'Invalid resume text';
  END IF;

  IF length(p_resume) > 50000 THEN
    RAISE EXCEPTION 'Resume text too long';
  END IF;

  -- Validate LinkedIn (optional field)
  IF p_linkedin IS NOT NULL AND length(p_linkedin) > 50000 THEN
    RAISE EXCEPTION 'LinkedIn text too long';
  END IF;

  -- Validate job description (optional field)
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

-- 3. Update save_free_scan_lead to add bounds validation for industry and ats_score
CREATE OR REPLACE FUNCTION public.save_free_scan_lead(p_email text, p_industry text DEFAULT NULL::text, p_ats_score integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_recent_count INTEGER;
BEGIN
  -- Validate email format
  IF p_email IS NULL OR p_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email format';
  END IF;
  
  -- Validate email length (defense-in-depth)
  IF length(p_email) > 255 THEN
    RAISE EXCEPTION 'Email too long';
  END IF;
  
  -- Validate industry if provided (prevent oversized inputs)
  IF p_industry IS NOT NULL AND length(p_industry) > 100 THEN
    RAISE EXCEPTION 'Industry name too long';
  END IF;
  
  -- Validate ATS score bounds if provided
  IF p_ats_score IS NOT NULL AND (p_ats_score < 0 OR p_ats_score > 100) THEN
    RAISE EXCEPTION 'Invalid ATS score';
  END IF;
  
  -- Check table size limit (max 10,000 leads in last 30 days to prevent abuse)
  SELECT COUNT(*) INTO v_recent_count
  FROM free_scan_leads
  WHERE created_at > NOW() - INTERVAL '30 days';
  
  IF v_recent_count > 10000 THEN
    RAISE EXCEPTION 'Lead collection temporarily unavailable';
  END IF;
  
  -- Insert or update (upsert on email)
  INSERT INTO free_scan_leads (email, industry, ats_score_estimate)
  VALUES (lower(trim(p_email)), p_industry, p_ats_score)
  ON CONFLICT (email) DO UPDATE SET
    industry = COALESCE(EXCLUDED.industry, free_scan_leads.industry),
    ats_score_estimate = COALESCE(EXCLUDED.ats_score_estimate, free_scan_leads.ats_score_estimate);
  
  RETURN TRUE;
END;
$function$;