-- A staging table anyone can rewrite runs as the definer.
-- public._mig_stage held the SQL text that public._mig_exec(text) (SECURITY DEFINER,
-- owned by postgres) executed at apply time, under public-schema default privileges:
-- the anon key could SELECT and UPDATE it and have the definer run rewritten SQL.
-- public._mig_probe held service-role output under the same exposure.
-- Idempotent and safe to re-run.

-- 1. PUBLIC and the named roles are different grantees; revoke both.
REVOKE ALL ON TABLE public._mig_stage FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public._mig_probe FROM PUBLIC, anon, authenticated;

-- 2. RLS on, with no inherited policy left standing.
ALTER TABLE public._mig_stage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._mig_probe ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('_mig_stage', '_mig_probe')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- 3. The only two roles that legitimately touch these tables.
GRANT ALL ON TABLE public._mig_stage TO service_role, sandbox_exec;
GRANT ALL ON TABLE public._mig_probe TO service_role, sandbox_exec;

CREATE POLICY sandbox_exec_all ON public._mig_stage
  FOR ALL TO sandbox_exec USING (true) WITH CHECK (true);
CREATE POLICY sandbox_exec_all ON public._mig_probe
  FOR ALL TO sandbox_exec USING (true) WITH CHECK (true);

-- 4. Re-assert the revoke on the definer itself.
REVOKE ALL ON FUNCTION public._mig_exec(text) FROM PUBLIC, anon, authenticated;