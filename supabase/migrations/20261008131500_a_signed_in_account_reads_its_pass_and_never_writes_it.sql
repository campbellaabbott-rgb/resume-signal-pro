-- A SIGNED-IN ACCOUNT READS ITS PASS AND NEVER WRITES IT.
--
-- WHAT WAS WRONG (found by Lovable's staged run of 20261008132000, 2026-10-10).
-- 20260917100000 took every privilege on agent_passes away from the public and
-- the anonymous role, granted the signed-in role read access, and meant "a
-- signed-in account may only read its own pass". It never took anything away
-- from the signed-in role itself. Supabase
-- grants ALL on every table created in public to anon, authenticated and
-- service_role by default, and a GRANT never takes anything away: the
-- authenticated role kept INSERT, UPDATE, DELETE and TRUNCATE on the whole
-- table, every column included. Row-level security has only the owner-read
-- policy, so no client write has reached a row through PostgREST; the
-- privilege was still there, and 20261008132000's self-check refuses to finish
-- while a signed-in account can write agent_passes.settled_at (the stamp that
-- says a closed pass already gave its unsent applications back). Lovable's
-- runner rolled it back twice.
--
-- The tests passed because the pglite stand-ins never had Supabase's default
-- grants; helpers/agent-db.ts now starts from them.
--
-- NOW: every privilege a client role holds on agent_passes is taken away
-- (table and column level), and the signed-in role gets back only SELECT,
-- still narrowed to its own rows by agent_passes_owner_read. Every write to a
-- pass is the server's: the checkout, the status reader, agent-access and
-- agent-mcp all write through the service role, and no client code writes
-- the table. Self-verifying and safe to re-run.

REVOKE ALL ON public.agent_passes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.agent_passes TO authenticated;
GRANT ALL ON public.agent_passes TO service_role;

-- ── self-check ───────────────────────────────────────────────────────────────
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
