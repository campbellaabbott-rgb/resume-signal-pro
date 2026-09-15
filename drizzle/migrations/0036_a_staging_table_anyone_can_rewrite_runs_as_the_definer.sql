DO $lock$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY['_mig_stage', '_mig_probe'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'public.% does not exist here; nothing to lock', t;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
      EXECUTE format('GRANT ALL ON TABLE public.%I TO sandbox_exec', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO sandbox_exec USING (true) WITH CHECK (true)', t || '_runner_only', t);
    END IF;
  END LOOP;

  IF to_regprocedure('public._mig_exec(text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public._mig_exec(text) FROM PUBLIC, anon, authenticated;
  END IF;
END
$lock$;