-- Create error telemetry table to track user-facing errors
CREATE TABLE public.error_telemetry (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  error_code TEXT NOT NULL,
  error_type TEXT NOT NULL,
  error_message TEXT,
  http_status INTEGER,
  function_name TEXT,
  context JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.error_telemetry ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts for error tracking
CREATE POLICY "Anyone can insert error telemetry"
ON public.error_telemetry
FOR INSERT
WITH CHECK (true);

-- Create index for querying by error code and date
CREATE INDEX idx_error_telemetry_code ON public.error_telemetry(error_code);
CREATE INDEX idx_error_telemetry_created ON public.error_telemetry(created_at DESC);

-- Create function to log errors
CREATE OR REPLACE FUNCTION public.log_error_telemetry(
  p_error_code TEXT,
  p_error_type TEXT,
  p_error_message TEXT DEFAULT NULL,
  p_http_status INTEGER DEFAULT NULL,
  p_function_name TEXT DEFAULT NULL,
  p_context JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.error_telemetry (error_code, error_type, error_message, http_status, function_name, context)
  VALUES (p_error_code, p_error_type, p_error_message, p_http_status, p_function_name, p_context);
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;