-- Create industry detection metrics table for tracking accuracy
CREATE TABLE public.industry_detection_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Detection inputs
  resume_text_length INTEGER NOT NULL,
  visitor_id TEXT,
  ip_country TEXT,
  
  -- Server-side detection results
  server_industry TEXT NOT NULL,
  server_sub_industry TEXT,
  server_parent_industry TEXT,
  server_confidence TEXT NOT NULL,
  server_score INTEGER NOT NULL,
  server_signals TEXT[],
  
  -- AI detection results
  ai_suggested_industry TEXT,
  
  -- Hybrid/final results
  final_industry TEXT NOT NULL,
  final_confidence TEXT NOT NULL,
  detection_source TEXT NOT NULL, -- 'server_high', 'server_medium', 'ai_override', 'ai_fallback'
  
  -- Match analysis
  server_ai_match BOOLEAN,
  server_ai_parent_match BOOLEAN,
  
  -- Top alternatives (for accuracy analysis)
  alternative_industries JSONB,
  
  -- Processing metadata
  detection_duration_ms INTEGER,
  
  -- Pattern match details for debugging
  matched_title_patterns TEXT[],
  matched_skill_count INTEGER,
  matched_context_patterns BOOLEAN
);

-- Enable RLS (public insert for edge function, no select by default)
ALTER TABLE public.industry_detection_metrics ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts from edge function
CREATE POLICY "Allow anonymous inserts" 
ON public.industry_detection_metrics 
FOR INSERT 
WITH CHECK (true);

-- Create index for analytics queries
CREATE INDEX idx_industry_detection_metrics_created_at ON public.industry_detection_metrics(created_at DESC);
CREATE INDEX idx_industry_detection_metrics_final_industry ON public.industry_detection_metrics(final_industry);
CREATE INDEX idx_industry_detection_metrics_detection_source ON public.industry_detection_metrics(detection_source);
CREATE INDEX idx_industry_detection_metrics_confidence ON public.industry_detection_metrics(final_confidence);

-- Create function to log industry detection metric
CREATE OR REPLACE FUNCTION public.log_industry_detection(
  p_resume_text_length INTEGER,
  p_visitor_id TEXT DEFAULT NULL,
  p_ip_country TEXT DEFAULT NULL,
  p_server_industry TEXT DEFAULT 'general',
  p_server_sub_industry TEXT DEFAULT NULL,
  p_server_parent_industry TEXT DEFAULT NULL,
  p_server_confidence TEXT DEFAULT 'low',
  p_server_score INTEGER DEFAULT 0,
  p_server_signals TEXT[] DEFAULT '{}',
  p_ai_suggested_industry TEXT DEFAULT NULL,
  p_final_industry TEXT DEFAULT 'general',
  p_final_confidence TEXT DEFAULT 'low',
  p_detection_source TEXT DEFAULT 'server_high',
  p_server_ai_match BOOLEAN DEFAULT NULL,
  p_server_ai_parent_match BOOLEAN DEFAULT NULL,
  p_alternative_industries JSONB DEFAULT NULL,
  p_detection_duration_ms INTEGER DEFAULT NULL,
  p_matched_title_patterns TEXT[] DEFAULT NULL,
  p_matched_skill_count INTEGER DEFAULT NULL,
  p_matched_context_patterns BOOLEAN DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO industry_detection_metrics (
    resume_text_length,
    visitor_id,
    ip_country,
    server_industry,
    server_sub_industry,
    server_parent_industry,
    server_confidence,
    server_score,
    server_signals,
    ai_suggested_industry,
    final_industry,
    final_confidence,
    detection_source,
    server_ai_match,
    server_ai_parent_match,
    alternative_industries,
    detection_duration_ms,
    matched_title_patterns,
    matched_skill_count,
    matched_context_patterns
  ) VALUES (
    p_resume_text_length,
    p_visitor_id,
    p_ip_country,
    p_server_industry,
    p_server_sub_industry,
    p_server_parent_industry,
    p_server_confidence,
    p_server_score,
    p_server_signals,
    p_ai_suggested_industry,
    p_final_industry,
    p_final_confidence,
    p_detection_source,
    p_server_ai_match,
    p_server_ai_parent_match,
    p_alternative_industries,
    p_detection_duration_ms,
    p_matched_title_patterns,
    p_matched_skill_count,
    p_matched_context_patterns
  )
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$$;

-- Create function to get industry detection stats
CREATE OR REPLACE FUNCTION public.get_industry_detection_stats(
  p_hours_back INTEGER DEFAULT 24
)
RETURNS TABLE (
  total_detections BIGINT,
  high_confidence_rate NUMERIC,
  medium_confidence_rate NUMERIC,
  low_confidence_rate NUMERIC,
  server_ai_match_rate NUMERIC,
  avg_server_score NUMERIC,
  top_industries JSONB,
  detection_sources JSONB,
  confidence_by_industry JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH metrics AS (
    SELECT *
    FROM industry_detection_metrics
    WHERE created_at >= NOW() - (p_hours_back || ' hours')::INTERVAL
  ),
  totals AS (
    SELECT COUNT(*) as total FROM metrics
  ),
  confidence_counts AS (
    SELECT 
      final_confidence,
      COUNT(*) as cnt
    FROM metrics
    GROUP BY final_confidence
  ),
  industry_counts AS (
    SELECT 
      final_industry,
      COUNT(*) as cnt
    FROM metrics
    GROUP BY final_industry
    ORDER BY cnt DESC
    LIMIT 10
  ),
  source_counts AS (
    SELECT 
      detection_source,
      COUNT(*) as cnt
    FROM metrics
    GROUP BY detection_source
  ),
  conf_by_industry AS (
    SELECT 
      final_industry,
      jsonb_build_object(
        'high', SUM(CASE WHEN final_confidence = 'high' THEN 1 ELSE 0 END),
        'medium', SUM(CASE WHEN final_confidence = 'medium' THEN 1 ELSE 0 END),
        'low', SUM(CASE WHEN final_confidence = 'low' THEN 1 ELSE 0 END)
      ) as conf_breakdown
    FROM metrics
    GROUP BY final_industry
    ORDER BY COUNT(*) DESC
    LIMIT 10
  )
  SELECT
    t.total as total_detections,
    COALESCE(
      (SELECT cnt::NUMERIC / NULLIF(t.total, 0) * 100 FROM confidence_counts WHERE final_confidence = 'high'),
      0
    ) as high_confidence_rate,
    COALESCE(
      (SELECT cnt::NUMERIC / NULLIF(t.total, 0) * 100 FROM confidence_counts WHERE final_confidence = 'medium'),
      0
    ) as medium_confidence_rate,
    COALESCE(
      (SELECT cnt::NUMERIC / NULLIF(t.total, 0) * 100 FROM confidence_counts WHERE final_confidence = 'low'),
      0
    ) as low_confidence_rate,
    COALESCE(
      (SELECT AVG(CASE WHEN server_ai_match THEN 100 ELSE 0 END) FROM metrics),
      0
    ) as server_ai_match_rate,
    COALESCE(
      (SELECT AVG(server_score) FROM metrics),
      0
    ) as avg_server_score,
    (SELECT jsonb_object_agg(final_industry, cnt) FROM industry_counts) as top_industries,
    (SELECT jsonb_object_agg(detection_source, cnt) FROM source_counts) as detection_sources,
    (SELECT jsonb_object_agg(final_industry, conf_breakdown) FROM conf_by_industry) as confidence_by_industry
  FROM totals t;
END;
$$;