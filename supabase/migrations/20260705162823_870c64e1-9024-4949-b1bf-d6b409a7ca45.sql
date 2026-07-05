DROP POLICY IF EXISTS "Allow reading for analytics" ON public.industry_corrections;
DROP POLICY IF EXISTS "Allow anonymous inserts" ON public.industry_corrections;

GRANT ALL ON public.industry_corrections TO service_role;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.industry_corrections FROM anon, authenticated;

DROP POLICY IF EXISTS "service role manages industry corrections" ON public.industry_corrections;
CREATE POLICY "service role manages industry corrections"
  ON public.industry_corrections
  FOR ALL
  TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');