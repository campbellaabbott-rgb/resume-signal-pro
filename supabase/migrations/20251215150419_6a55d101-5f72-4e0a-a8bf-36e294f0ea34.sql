-- Create table for storing resume analyses with shareable links
CREATE TABLE public.resume_analyses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  share_id TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  resume_text TEXT NOT NULL,
  analysis_result JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.resume_analyses ENABLE ROW LEVEL SECURITY;

-- Allow anyone to view analyses via share_id
CREATE POLICY "Anyone can view analyses" 
ON public.resume_analyses 
FOR SELECT 
USING (true);

-- Allow inserts from edge functions (service role)
CREATE POLICY "Service role can insert analyses" 
ON public.resume_analyses 
FOR INSERT 
WITH CHECK (true);

-- Create index for faster share_id lookups
CREATE INDEX idx_resume_analyses_share_id ON public.resume_analyses(share_id);