-- scan_feedback: stores user ratings on free scan results.
-- Used to identify which recommendation types are systematically wrong.

CREATE TABLE IF NOT EXISTS public.scan_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  visitor_id      TEXT,
  rating          BOOLEAN NOT NULL,           -- true = helpful, false = not helpful
  industry        TEXT,
  ats_score       INTEGER,
  had_job_description BOOLEAN DEFAULT false,
  resume_word_count   INTEGER,
  feedback_text   TEXT                        -- optional free-text comment
);

-- Index for analytics queries by industry and date
CREATE INDEX IF NOT EXISTS scan_feedback_industry_created
  ON public.scan_feedback (industry, created_at DESC);

-- RPC so the frontend never touches the table directly
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

-- Allow anon callers to invoke the RPC (same pattern as other public RPCs)
GRANT EXECUTE ON FUNCTION public.record_scan_feedback TO anon, authenticated;
