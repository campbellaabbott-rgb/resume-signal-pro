-- Fix 1: Drop and recreate get_analysis_by_share_id RPC without resume_text
DROP FUNCTION IF EXISTS public.get_analysis_by_share_id(text);

CREATE FUNCTION public.get_analysis_by_share_id(share_id_param text)
RETURNS TABLE(
  id uuid, 
  analysis_result jsonb, 
  created_at timestamp with time zone, 
  share_id text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF share_id_param IS NULL OR share_id_param !~ '^[a-f0-9]{24}$' THEN
    RAISE EXCEPTION 'Invalid share_id format';
  END IF;
  
  RETURN QUERY
  SELECT 
    ra.id, ra.analysis_result, ra.created_at, ra.share_id
  FROM resume_analyses ra
  WHERE ra.share_id = share_id_param;
END;
$$;

-- Fix 2: Create temp_resume_storage table for server-side PII storage
CREATE TABLE IF NOT EXISTS public.temp_resume_storage (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resume_text TEXT NOT NULL,
  linkedin_text TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient cleanup of expired records
CREATE INDEX IF NOT EXISTS idx_temp_resume_expires ON public.temp_resume_storage(expires_at);

-- Enable RLS - no direct access allowed
ALTER TABLE public.temp_resume_storage ENABLE ROW LEVEL SECURITY;

-- RLS: No direct table access
CREATE POLICY "No direct table access" ON public.temp_resume_storage
  FOR ALL USING (false) WITH CHECK (false);

-- RPC: Store temp resume (returns session_id)
CREATE OR REPLACE FUNCTION public.store_temp_resume(p_resume TEXT, p_linkedin TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE 
  v_id UUID;
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
  
  -- Clean up expired entries (5% chance per call)
  IF random() < 0.05 THEN
    DELETE FROM temp_resume_storage WHERE expires_at < NOW();
  END IF;
  
  INSERT INTO temp_resume_storage (resume_text, linkedin_text)
  VALUES (p_resume, p_linkedin)
  RETURNING session_id INTO v_id;
  
  RETURN v_id;
END;
$$;

-- RPC: Get temp resume (auto-deletes after retrieval)
CREATE OR REPLACE FUNCTION public.get_temp_resume(p_session_id UUID)
RETURNS TABLE(resume_text TEXT, linkedin_text TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Return data only if not expired
  RETURN QUERY
  SELECT t.resume_text, t.linkedin_text
  FROM temp_resume_storage t
  WHERE t.session_id = p_session_id
    AND t.expires_at > NOW();
  
  -- Delete the record after retrieval (one-time use)
  DELETE FROM temp_resume_storage
  WHERE session_id = p_session_id;
END;
$$;