-- Create table for storing weekly cohort reports
CREATE TABLE public.cohort_weekly_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_date DATE NOT NULL DEFAULT CURRENT_DATE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  report_data JSONB NOT NULL,
  top_traffic_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_segments JSONB NOT NULL DEFAULT '[]'::jsonb,
  insights TEXT[],
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.cohort_weekly_reports ENABLE ROW LEVEL SECURITY;

-- Service role only access (reports are internal)
CREATE POLICY "Service role only for cohort reports"
ON public.cohort_weekly_reports
FOR ALL
USING (false)
WITH CHECK (false);

-- Create index for efficient querying
CREATE INDEX idx_cohort_reports_week ON public.cohort_weekly_reports(week_start DESC);
CREATE INDEX idx_cohort_reports_date ON public.cohort_weekly_reports(report_date DESC);