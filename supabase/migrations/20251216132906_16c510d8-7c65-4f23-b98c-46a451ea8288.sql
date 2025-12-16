-- ============================================
-- Privacy Enhancement: Address PII Storage Issues
-- ============================================

-- 1. Add expiration column with 90-day default
ALTER TABLE public.resume_analyses 
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '90 days';

-- 2. Create index for efficient cleanup queries
CREATE INDEX IF NOT EXISTS idx_resume_analyses_expires_at ON public.resume_analyses(expires_at);

-- 3. Set expiration for existing records (90 days from creation)
UPDATE public.resume_analyses 
SET expires_at = created_at + INTERVAL '90 days'
WHERE expires_at IS NULL;

-- 4. Make resume_text nullable (to support redaction)
ALTER TABLE public.resume_analyses 
ALTER COLUMN resume_text DROP NOT NULL;

-- 5. Redact existing resume_text for privacy (replace with placeholder)
UPDATE public.resume_analyses 
SET resume_text = '[REDACTED - Analysis completed]'
WHERE resume_text IS NOT NULL AND resume_text != '[REDACTED - Analysis completed]';

-- 6. Create user deletion RPC function (GDPR/CCPA compliance)
CREATE OR REPLACE FUNCTION public.delete_analysis_by_share_id(p_share_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validate share_id format (24 hex characters)
  IF p_share_id IS NULL OR p_share_id !~ '^[a-f0-9]{24}$' THEN
    RAISE EXCEPTION 'Invalid share_id format';
  END IF;
  
  -- Delete the analysis record
  DELETE FROM resume_analyses WHERE share_id = p_share_id;
  
  -- Return whether a record was deleted
  RETURN FOUND;
END;
$$;

-- 7. Create cleanup function for expired analyses
CREATE OR REPLACE FUNCTION public.cleanup_expired_analyses()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM resume_analyses WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;