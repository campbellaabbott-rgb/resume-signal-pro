
-- 1) heartbeat_results: remove public read, restrict to service_role
DROP POLICY IF EXISTS "Allow public read of heartbeat results" ON public.heartbeat_results;
CREATE POLICY "Service role can read heartbeat results"
  ON public.heartbeat_results
  FOR SELECT
  TO service_role
  USING (true);
REVOKE SELECT ON public.heartbeat_results FROM anon, authenticated;

-- 2) resume_analyses: replace public-INSERT policy with service_role-only
DROP POLICY IF EXISTS "Service role can insert analyses" ON public.resume_analyses;
CREATE POLICY "Service role can insert analyses"
  ON public.resume_analyses
  FOR INSERT
  TO service_role
  WITH CHECK (true);
REVOKE INSERT ON public.resume_analyses FROM anon, authenticated;
