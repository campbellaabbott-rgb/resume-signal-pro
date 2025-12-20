-- Add explicit RESTRICTIVE policies for UPDATE and DELETE on resume_analyses
-- This provides defense-in-depth security even though RLS default-deny is in effect

CREATE POLICY "Block direct updates" ON public.resume_analyses
FOR UPDATE USING (false) WITH CHECK (false);

CREATE POLICY "Block direct deletes" ON public.resume_analyses
FOR DELETE USING (false);