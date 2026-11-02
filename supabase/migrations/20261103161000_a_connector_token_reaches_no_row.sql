-- A CONNECTOR TOKEN REACHES NO ROW (S9-001, the second layer, 2026-11-03).
--
-- 20261103160000 gives a token minted for an OAuth client the role
-- mcp_client, which the API cannot switch to. That holds only while the
-- access-token hook is enabled. Were the OAuth server switched on without
-- the hook, or the hook switched off later, a connector token would reach
-- the database as role 'authenticated' with auth.uid() set to the person,
-- and every signed-in policy would let it read and write their rows: the
-- agent mandate (resume text, phone, apply settings), the queue, the
-- submissions, the saved resume in the 'resumes' bucket.
--
-- So every table in public with row level security on, and storage.objects,
-- gets one RESTRICTIVE policy for the signed-in role: a request whose JWT
-- carries a non-empty client_id matches no row, for reading and for writing.
-- A restrictive policy only ever narrows what the permissive policies
-- allow, and a website session never carries client_id (an empty one is
-- read as absent, as the hook reads it), so nothing a signed-in visitor can
-- do today changes. The claim is read once per statement, (SELECT
-- auth.jwt() ...), not once per row. The service role bypasses row level
-- security and is unaffected; anon is not named.
--
-- The tables are read from the catalogue, never listed by hand. A table that
-- turns on row level security later does not get the policy by itself: the
-- hook is the layer that covers everything.
--
-- WHAT THIS LAYER DOES NOT COVER (the audit-rest fixer's review): a SECURITY
-- DEFINER function the signed-in role may execute (agent_cancel_pending,
-- get_application_lifecycle, agent_sent_today and the rest) reads its tables
-- as its owner, and a view owned by a privileged role reads as that owner, so
-- neither runs this policy. With the hook off, a connector token can still
-- call them as the person. Nor does it touch Supabase Auth's /auth/v1/user
-- (see 20261103160000). It narrows tables; it is not a second hook.
--
-- Safe to re-run: a policy is created only where it is missing, and the
-- self-check only reads (its claims probe runs in a block that rolls back).

DO $$
DECLARE
  r record;
  v_qual constant text := '(coalesce((SELECT auth.jwt() ->> ''client_id''), '''') = '''')';
  v_skipped text[] := '{}';
BEGIN
  FOR r IN
    SELECT c.oid, format('%I.%I', n.nspname, c.relname) AS tbl
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
       AND c.relrowsecurity
       AND (n.nspname = 'public' OR (n.nspname = 'storage' AND c.relname = 'objects'))
       AND NOT EXISTS (SELECT 1 FROM pg_policy p
                        WHERE p.polrelid = c.oid AND p.polname = 'a_connector_token_reaches_no_row')
     ORDER BY 2
  LOOP
    BEGIN
      EXECUTE format(
        'CREATE POLICY a_connector_token_reaches_no_row ON %s AS RESTRICTIVE FOR ALL TO %I USING %s WITH CHECK %s',
        r.tbl, 'authenticated', v_qual, v_qual);
    EXCEPTION WHEN insufficient_privilege THEN
      v_skipped := v_skipped || r.tbl;
    END;
  END LOOP;
  IF cardinality(v_skipped) > 0 THEN
    RAISE NOTICE 'a_connector_token_reaches_no_row: not owner of %, left to the hook', v_skipped;
  END IF;
END $$;

-- Self-verifying: every table the loop reads (the agent's three tables and
-- storage.objects without exception) carries the policy, restrictive, for
-- the signed-in role, for every command, with the same expression for
-- reading and writing; and that expression is true for a website session's
-- claims, for no claims at all and for an empty client_id, and false for a
-- connector's.
DO $$
DECLARE
  v_missing text[];
  v_bad text[];
  v_site boolean;
  v_none boolean;
  v_empty boolean;
  v_app boolean;
  v_expr text;
BEGIN
  SELECT array_agg(format('%I.%I', n.nspname, c.relname) ORDER BY 1) INTO v_missing
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p') AND c.relrowsecurity
     AND (n.nspname = 'public' OR (n.nspname = 'storage' AND c.relname = 'objects'))
     AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'a_connector_token_reaches_no_row');
  IF EXISTS (SELECT 1 FROM unnest(coalesce(v_missing, '{}')) t
              WHERE t IN ('public.agent_mandates', 'public.agent_queue', 'public.agent_submissions', 'storage.objects')) THEN
    RAISE EXCEPTION 'self-check: a person''s own tables lack the connector policy: %', v_missing;
  END IF;
  IF cardinality(coalesce(v_missing, '{}')) > 0 THEN
    RAISE NOTICE 'self-check: % table(s) without the connector policy (not owner), left to the hook: %', cardinality(v_missing), v_missing;
  END IF;
  FOREACH v_expr IN ARRAY ARRAY['public.agent_mandates', 'public.agent_queue', 'public.agent_submissions', 'storage.objects'] LOOP
    IF to_regclass(v_expr) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass(v_expr) AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'self-check: % has row level security off', v_expr;
    END IF;
  END LOOP;

  SELECT array_agg(format('%s', p.polrelid::regclass) ORDER BY 1) INTO v_bad
    FROM pg_policy p
   WHERE p.polname = 'a_connector_token_reaches_no_row'
     AND (p.polpermissive OR p.polcmd <> '*'
          OR p.polroles IS DISTINCT FROM ARRAY[to_regrole('authenticated')::oid]
          OR pg_get_expr(p.polqual, p.polrelid) IS DISTINCT FROM pg_get_expr(p.polwithcheck, p.polrelid)
          OR pg_get_expr(p.polqual, p.polrelid) NOT LIKE '%client_id%');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'self-check: the connector policy is not restrictive, for every command and the signed-in role alone on %', v_bad;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aud":"authenticated"}', true);
    v_site := coalesce((SELECT auth.jwt() ->> 'client_id'), '') = '';
    PERFORM set_config('request.jwt.claims', '', true);
    v_none := coalesce((SELECT auth.jwt() ->> 'client_id'), '') = '';
    PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","client_id":""}', true);
    v_empty := coalesce((SELECT auth.jwt() ->> 'client_id'), '') = '';
    PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","client_id":"9a8b7c6d-5e4f-4a2b-8c0d-9e8f7a6b5c4d"}', true);
    v_app := coalesce((SELECT auth.jwt() ->> 'client_id'), '') = '';
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'self-check-rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'self-check-rollback' THEN RAISE; END IF;
  END;
  IF NOT (v_site AND v_none AND v_empty) THEN
    RAISE EXCEPTION 'self-check: the connector policy would refuse a website session (site %, none %, empty %)', v_site, v_none, v_empty;
  END IF;
  IF v_app THEN
    RAISE EXCEPTION 'self-check: the connector policy lets a connector token through';
  END IF;
END $$;
