REVOKE SELECT ON public.job_board_meta FROM anon, authenticated;
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='job_board_meta' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.job_board_meta', p.policyname);
  END LOOP;
END $$;
CREATE POLICY "job_board_meta_service_only" ON public.job_board_meta FOR SELECT TO service_role USING (true);