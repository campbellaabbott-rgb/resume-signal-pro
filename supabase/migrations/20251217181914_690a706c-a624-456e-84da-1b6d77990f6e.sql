-- Create A/B test tracking table
CREATE TABLE public.ab_test_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_name TEXT NOT NULL,
  variant TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('view', 'conversion')),
  visitor_id TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ab_test_events ENABLE ROW LEVEL SECURITY;

-- Service role only - no direct client access
CREATE POLICY "Service role only insert" ON public.ab_test_events
  FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role only select" ON public.ab_test_events
  FOR SELECT TO service_role
  USING (true);

-- Index for fast queries
CREATE INDEX idx_ab_test_events_test_name ON public.ab_test_events(test_name, variant);
CREATE INDEX idx_ab_test_events_created_at ON public.ab_test_events(created_at);

-- Function to track A/B test events (called from edge function)
CREATE OR REPLACE FUNCTION public.track_ab_event(
  p_test_name TEXT,
  p_variant TEXT,
  p_event_type TEXT,
  p_visitor_id TEXT,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validate inputs
  IF p_test_name IS NULL OR length(p_test_name) < 1 OR length(p_test_name) > 100 THEN
    RAISE EXCEPTION 'Invalid test name';
  END IF;
  
  IF p_variant IS NULL OR length(p_variant) < 1 OR length(p_variant) > 50 THEN
    RAISE EXCEPTION 'Invalid variant';
  END IF;
  
  IF p_event_type NOT IN ('view', 'conversion') THEN
    RAISE EXCEPTION 'Invalid event type';
  END IF;
  
  IF p_visitor_id IS NULL OR length(p_visitor_id) < 10 THEN
    RAISE EXCEPTION 'Invalid visitor ID';
  END IF;

  INSERT INTO ab_test_events (test_name, variant, event_type, visitor_id, metadata)
  VALUES (p_test_name, p_variant, p_event_type, p_visitor_id, p_metadata);
  
  RETURN TRUE;
END;
$$;

-- Function to get A/B test stats
CREATE OR REPLACE FUNCTION public.get_ab_test_stats(p_test_name TEXT)
RETURNS TABLE(
  variant TEXT,
  views BIGINT,
  conversions BIGINT,
  conversion_rate NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.variant,
    COUNT(*) FILTER (WHERE e.event_type = 'view') as views,
    COUNT(*) FILTER (WHERE e.event_type = 'conversion') as conversions,
    CASE 
      WHEN COUNT(*) FILTER (WHERE e.event_type = 'view') > 0 
      THEN ROUND(
        (COUNT(*) FILTER (WHERE e.event_type = 'conversion')::NUMERIC / 
         COUNT(*) FILTER (WHERE e.event_type = 'view')::NUMERIC) * 100, 2
      )
      ELSE 0
    END as conversion_rate
  FROM ab_test_events e
  WHERE e.test_name = p_test_name
  GROUP BY e.variant
  ORDER BY e.variant;
END;
$$;