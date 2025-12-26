-- Create table to track industry detection corrections
CREATE TABLE public.industry_corrections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  visitor_id TEXT,
  original_industry TEXT NOT NULL,
  original_confidence TEXT,
  corrected_industry TEXT NOT NULL,
  detection_source TEXT,
  resume_text_length INTEGER,
  server_signals TEXT[],
  ai_suggested_industry TEXT,
  ip_country TEXT
);

-- Enable RLS (public inserts allowed for anonymous tracking)
ALTER TABLE public.industry_corrections ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts for tracking
CREATE POLICY "Allow anonymous inserts" 
ON public.industry_corrections 
FOR INSERT 
WITH CHECK (true);

-- Allow reading for analytics (can restrict later if needed)
CREATE POLICY "Allow reading for analytics" 
ON public.industry_corrections 
FOR SELECT 
USING (true);

-- Create function to log industry correction
CREATE OR REPLACE FUNCTION public.log_industry_correction(
  p_original_industry TEXT,
  p_corrected_industry TEXT,
  p_original_confidence TEXT DEFAULT NULL,
  p_detection_source TEXT DEFAULT NULL,
  p_resume_text_length INTEGER DEFAULT NULL,
  p_server_signals TEXT[] DEFAULT NULL,
  p_ai_suggested_industry TEXT DEFAULT NULL,
  p_visitor_id TEXT DEFAULT NULL,
  p_ip_country TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.industry_corrections (
    original_industry,
    corrected_industry,
    original_confidence,
    detection_source,
    resume_text_length,
    server_signals,
    ai_suggested_industry,
    visitor_id,
    ip_country
  ) VALUES (
    p_original_industry,
    p_corrected_industry,
    p_original_confidence,
    p_detection_source,
    p_resume_text_length,
    p_server_signals,
    p_ai_suggested_industry,
    p_visitor_id,
    p_ip_country
  )
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$$;

-- Create function to get correction stats for improving detection
CREATE OR REPLACE FUNCTION public.get_industry_correction_stats(p_days_back INTEGER DEFAULT 30)
RETURNS TABLE (
  original_industry TEXT,
  corrected_to TEXT,
  correction_count BIGINT,
  avg_confidence TEXT,
  common_signals TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ic.original_industry,
    ic.corrected_industry as corrected_to,
    COUNT(*) as correction_count,
    MODE() WITHIN GROUP (ORDER BY ic.original_confidence) as avg_confidence,
    ARRAY_AGG(DISTINCT unnest_signal) FILTER (WHERE unnest_signal IS NOT NULL) as common_signals
  FROM public.industry_corrections ic
  LEFT JOIN LATERAL unnest(ic.server_signals) as unnest_signal ON true
  WHERE ic.created_at > now() - (p_days_back || ' days')::INTERVAL
  GROUP BY ic.original_industry, ic.corrected_industry
  ORDER BY correction_count DESC;
END;
$$;