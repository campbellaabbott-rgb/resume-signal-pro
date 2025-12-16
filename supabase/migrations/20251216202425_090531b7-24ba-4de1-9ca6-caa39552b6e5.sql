-- Update save_free_scan_lead to add table size limit protection
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