-- 20260728190000_ghost_stats_stated_date_only.sql
DROP FUNCTION IF EXISTS public.get_ghost_job_index_stats();

CREATE FUNCTION public.get_ghost_job_index_stats()
RETURNS TABLE (
  total_open bigint,
  total_companies bigint,
  total_company_names bigint,
  closed_90d bigint,
  observed_days integer,
  median_days_open numeric,
  median_days_to_close numeric,
  posted_coverage_pct numeric
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '25s'
AS $$
  WITH served AS (
    SELECT posted_at FROM public.job_board_postings WHERE missing_since IS NULL
  )
  SELECT
    (SELECT count(*) FROM served),
    (SELECT count(DISTINCT company_token) FROM public.job_board_postings WHERE missing_since IS NULL),
    (SELECT count(DISTINCT company)
       FROM public.job_board_postings WHERE company <> '' AND missing_since IS NULL),
    (SELECT count(*) FROM public.job_board_closures WHERE closed_at > now() - interval '90 days'),
    (SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (now() - MIN(closed_at))) / 86400.0))::integer
       FROM public.job_board_closures),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (
       ORDER BY GREATEST(EXTRACT(EPOCH FROM (now() - posted_at)) / 86400.0, 0)))::numeric, 1)
     FROM served WHERE posted_at IS NOT NULL),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (
       ORDER BY EXTRACT(EPOCH FROM (closed_at - posted_at)) / 86400.0))::numeric, 1)
     FROM public.job_board_closures
     WHERE closed_at > now() - interval '90 days'
       AND posted_at IS NOT NULL
       AND closed_at >= posted_at),
    (SELECT CASE WHEN count(*) > 0
              THEN round(100.0 * count(posted_at) / count(*), 1) END
       FROM served);
$$;

GRANT EXECUTE ON FUNCTION public.get_ghost_job_index_stats() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_date_coverage()
RETURNS TABLE (source text, total bigint, dated bigint)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  SELECT source, count(*) AS total, count(posted_at) AS dated
  FROM public.job_board_postings
  WHERE missing_since IS NULL
  GROUP BY source
  ORDER BY count(*) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_date_coverage() TO anon, authenticated;

-- 20260630000000_scan_feedback.sql
CREATE TABLE IF NOT EXISTS public.scan_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  visitor_id      TEXT,
  rating          BOOLEAN NOT NULL,
  industry        TEXT,
  ats_score       INTEGER,
  had_job_description BOOLEAN DEFAULT false,
  resume_word_count   INTEGER,
  feedback_text   TEXT
);

GRANT ALL ON public.scan_feedback TO service_role;

ALTER TABLE public.scan_feedback ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS scan_feedback_industry_created
  ON public.scan_feedback (industry, created_at DESC);

CREATE OR REPLACE FUNCTION public.record_scan_feedback(
  p_visitor_id        TEXT DEFAULT NULL,
  p_rating            BOOLEAN DEFAULT true,
  p_industry          TEXT DEFAULT NULL,
  p_ats_score         INTEGER DEFAULT NULL,
  p_had_job_description BOOLEAN DEFAULT false,
  p_resume_word_count INTEGER DEFAULT NULL,
  p_feedback_text     TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO scan_feedback (
    visitor_id, rating, industry, ats_score,
    had_job_description, resume_word_count, feedback_text
  ) VALUES (
    p_visitor_id, p_rating, p_industry, p_ats_score,
    p_had_job_description, p_resume_word_count, p_feedback_text
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_scan_feedback TO anon, authenticated;

-- 20260317000000_add_industry_detection_breakdown_rpcs.sql
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

GRANT EXECUTE ON FUNCTION public.get_industry_detection_breakdown TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_industry_detection_recent TO anon, authenticated;