REVOKE ALL ON public.agent_passes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.agent_passes TO authenticated;
GRANT ALL ON public.agent_passes TO service_role;

DO $$
DECLARE
  v_col text;
  v_priv text;
BEGIN
  FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('authenticated', 'public.agent_passes', v_priv) THEN
      RAISE EXCEPTION 'self-check: a signed-in account still holds % on agent_passes', v_priv;
    END IF;
    IF has_table_privilege('anon', 'public.agent_passes', v_priv) THEN
      RAISE EXCEPTION 'self-check: an anonymous caller still holds % on agent_passes', v_priv;
    END IF;
  END LOOP;
  FOR v_col IN
    SELECT a.attname FROM pg_attribute a
     WHERE a.attrelid = 'public.agent_passes'::regclass AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    IF has_column_privilege('authenticated', 'public.agent_passes', v_col, 'UPDATE')
       OR has_column_privilege('authenticated', 'public.agent_passes', v_col, 'INSERT') THEN
      RAISE EXCEPTION 'self-check: a signed-in account can still write agent_passes.%', v_col;
    END IF;
  END LOOP;
  IF has_table_privilege('anon', 'public.agent_passes', 'SELECT') THEN
    RAISE EXCEPTION 'self-check: an anonymous caller can read agent_passes';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.agent_passes', 'SELECT') THEN
    RAISE EXCEPTION 'self-check: a signed-in account can no longer read its pass';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.agent_passes', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.agent_passes', 'INSERT') THEN
    RAISE EXCEPTION 'self-check: the server can no longer write passes';
  END IF;
END $$;