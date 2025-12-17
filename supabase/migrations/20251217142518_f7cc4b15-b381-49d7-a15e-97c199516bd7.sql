-- Create a simple counter table for daily scan statistics
CREATE TABLE public.daily_scan_stats (
  date DATE PRIMARY KEY DEFAULT CURRENT_DATE,
  free_scan_count INTEGER NOT NULL DEFAULT 0,
  paid_scan_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.daily_scan_stats ENABLE ROW LEVEL SECURITY;

-- Allow public read access (no auth required)
CREATE POLICY "Anyone can read scan stats"
ON public.daily_scan_stats
FOR SELECT
USING (true);

-- Only service role can insert/update
CREATE POLICY "Service role can manage stats"
ON public.daily_scan_stats
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Create a function to increment today's free scan count
CREATE OR REPLACE FUNCTION public.increment_free_scan_count()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO daily_scan_stats (date, free_scan_count)
  VALUES (CURRENT_DATE, 1)
  ON CONFLICT (date) 
  DO UPDATE SET 
    free_scan_count = daily_scan_stats.free_scan_count + 1,
    updated_at = now();
END;
$$;

-- Create a function to get today's count (publicly callable)
CREATE OR REPLACE FUNCTION public.get_today_scan_count()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT free_scan_count INTO v_count
  FROM daily_scan_stats
  WHERE date = CURRENT_DATE;
  
  RETURN COALESCE(v_count, 0);
END;
$$;