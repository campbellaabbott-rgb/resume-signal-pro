-- industry_detection_metrics has RLS enabled but no policies at all (confirmed via
-- audit: migration 20251226040656 enables RLS but never adds a SELECT policy).
-- That's intentional, not an oversight to "fix" with a public policy — the table
-- contains visitor_id and ip_country per row, and a public SELECT policy would let
-- anyone with the anon key harvest per-visitor tracking data directly.
--
-- get_industry_detection_stats (SECURITY DEFINER) already works around this for
-- aggregate stats. IndustryDetectionChart.tsx also queries the table directly for
-- two more views (industry breakdown, recent detections) — those direct queries
-- silently return nothing because of the missing policy. Adding two more
-- SECURITY DEFINER RPCs that return only the non-sensitive aggregate columns the
-- chart actually needs, matching the existing pattern instead of opening the table.

CREATE OR REPLACE FUNCTION public.get_industry_detection_breakdown(
  p_hours_back INTEGER DEFAULT 168
)
RETURNS TABLE (
  final_industry TEXT,
  final_confidence TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT m.final_industry, m.final_confidence
  FROM industry_detection_metrics m
  WHERE m.created_at >= NOW() - (p_hours_back || ' hours')::INTERVAL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_industry_detection_recent(
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  final_industry TEXT,
  final_confidence TEXT,
  server_score INTEGER,
  detection_source TEXT,
  matched_skill_count INTEGER,
  created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT m.final_industry, m.final_confidence, m.server_score, m.detection_source, m.matched_skill_count, m.created_at
  FROM industry_detection_metrics m
  ORDER BY m.created_at DESC
  LIMIT p_limit;
END;
$$;
