-- Create a simple function to trigger report generation that can be called via edge function
-- No pg_cron dependency - reports can be triggered manually or via external scheduler

-- Add a last_generated_at tracking to prevent duplicate runs
CREATE OR REPLACE FUNCTION public.should_generate_weekly_report()
RETURNS boolean AS $$
DECLARE
  last_report_date DATE;
BEGIN
  SELECT MAX(report_date) INTO last_report_date 
  FROM public.cohort_weekly_reports;
  
  -- Generate if no reports exist or last report is more than 6 days old
  IF last_report_date IS NULL THEN
    RETURN true;
  ELSIF CURRENT_DATE - last_report_date >= 7 THEN
    RETURN true;
  END IF;
  
  RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;