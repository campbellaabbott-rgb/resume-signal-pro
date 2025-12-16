-- Create table for email captures from free scan
CREATE TABLE public.free_scan_leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  industry TEXT,
  ats_score_estimate INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.free_scan_leads ENABLE ROW LEVEL SECURITY;

-- Allow inserts from anyone (public form)
CREATE POLICY "Anyone can submit their email"
ON public.free_scan_leads
FOR INSERT
WITH CHECK (true);

-- Only service role can read (admin access)
CREATE POLICY "Service role can read leads"
ON public.free_scan_leads
FOR SELECT
USING (false);

-- Create index on email for duplicate checks
CREATE INDEX idx_free_scan_leads_email ON public.free_scan_leads(email);

-- Create function to save lead (with duplicate handling)
CREATE OR REPLACE FUNCTION public.save_free_scan_lead(
  p_email TEXT,
  p_industry TEXT DEFAULT NULL,
  p_ats_score INTEGER DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validate email format
  IF p_email IS NULL OR p_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email format';
  END IF;
  
  -- Insert or update (upsert on email)
  INSERT INTO free_scan_leads (email, industry, ats_score_estimate)
  VALUES (lower(trim(p_email)), p_industry, p_ats_score)
  ON CONFLICT (email) DO UPDATE SET
    industry = COALESCE(EXCLUDED.industry, free_scan_leads.industry),
    ats_score_estimate = COALESCE(EXCLUDED.ats_score_estimate, free_scan_leads.ats_score_estimate);
  
  RETURN TRUE;
END;
$$;

-- Add unique constraint on email
ALTER TABLE public.free_scan_leads ADD CONSTRAINT free_scan_leads_email_unique UNIQUE (email);