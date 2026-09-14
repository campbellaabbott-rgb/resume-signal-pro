-- THE NEIGHBOURS ARE EXACT AND THE READER IS NOT PUBLIC.
--
-- category_knn(q, k): the k anchors of job_board_category_anchors nearest to
-- q by cosine, as (id, field, title, sim). It is the one read path of the
-- embed basis (embed-classify.ts resolveEmbed scores what this returns), and
-- everything about it is chosen so the audited figures are the figures it
-- computes:
--
--   EXACT. A sequential scan over the stamped version's ~2,272 rows with
--   pgvector's `<=>` (cosine distance), no index -- 20260909224500 refuses an
--   index on the vector column. sim = 1 - distance. The pglite harness
--   (scripts/verify-migration-20260909224500.mjs) proves the answers equal a
--   plain JavaScript dot product over the same vectors, row for row, and that
--   the leave-one-out agreement computed THROUGH this function on the real
--   anchor vectors reproduces 1,959 / 2,272.
--
--   ONE VERSION. Only rows whose version is the one stamped in
--   job_board_meta.category_anchor_version are scanned; while a chunked
--   reload of a new version is in flight the previous stamped set keeps
--   answering, and with no stamp at all the function RAISES rather than
--   returning zero rows -- an empty neighbourhood would read as "nothing
--   matched" and the row would silently stay wherever it was.
--
--   NOT PUBLIC. SECURITY DEFINER (the table is RLS-on, service-role only),
--   with EXECUTE revoked from anon and authenticated BY NAME (definer-revoke-
--   pattern.test.ts; the 107-of-121 incident). The board never calls this
--   from a browser: the only caller is the maintenance hop a later phase
--   wires, under the service key.
--
--   BOUNDED. k in [1, 100]; q must be 384-dimensional; statement_timeout 5s.
--   The gate is audited at k = 15 (EMBED_K); the caller passes it.
--
-- RETURNS TABLE names its columns id, field, title, sim; every reference in
-- the body is alias-qualified (a.id, a.field ...) because an unqualified
-- column name that matches an OUT parameter is "column reference is
-- ambiguous" (42702) at CALL time, not at CREATE time -- the trap that 503'd
-- every authenticated /v1 call twice. The pglite harness executes the body.
--
-- Nothing here writes. Apply after 20260909224500.

DO $$
DECLARE
  keep CONSTANT text := 'q extensions.vector, k integer';
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname = 'category_knn'
       AND pg_get_function_identity_arguments(p.oid) IS DISTINCT FROM keep
  LOOP
    RAISE NOTICE 'dropping stray overload %', r.sig;
    EXECUTE 'DROP FUNCTION ' || r.sig::text;
  END LOOP;
END $$;

-- q is declared without a typmod: Postgres discards (384) on a parameter
-- anyway (the catalog identity is `extensions.vector`, which the catalog drop,
-- the REVOKE and the GRANT below all name), and the body checks vector_dims(q)
-- itself.
CREATE OR REPLACE FUNCTION public.category_knn(
  q extensions.vector,
  k integer DEFAULT 15
)
RETURNS TABLE (id text, field text, title text, sim real)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET statement_timeout = '5s'
AS $$
DECLARE
  c_dim     constant integer := 384;
  c_k_max   constant integer := 100;
  v_k       integer := COALESCE(k, 15);
  v_version text;
BEGIN
  IF q IS NULL THEN
    RAISE EXCEPTION 'category_knn refused: q is required';
  END IF;
  IF extensions.vector_dims(q) <> c_dim THEN
    RAISE EXCEPTION 'category_knn refused: q has % dims, the anchors have %', extensions.vector_dims(q), c_dim;
  END IF;
  IF v_k < 1 OR v_k > c_k_max THEN
    RAISE EXCEPTION 'category_knn refused: k must be between 1 and %, got %', c_k_max, v_k;
  END IF;
  SELECT m.v ->> 'version' INTO v_version
    FROM public.job_board_meta m
   WHERE m.k = 'category_anchor_version';
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'category_knn refused: no anchor set is stamped -- load_category_anchors has not completed';
  END IF;
  RETURN QUERY
    SELECT a.id, a.field, a.title, (1 - (a.embedding <=> q))::real
      FROM public.job_board_category_anchors a
     WHERE a.version = v_version
     ORDER BY a.embedding <=> q, a.id
     LIMIT v_k;
END;
$$;

REVOKE ALL ON FUNCTION public.category_knn(extensions.vector, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.category_knn(extensions.vector, integer) TO service_role;

COMMENT ON FUNCTION public.category_knn(extensions.vector, integer) IS
  'The embed basis'' one read path: the k (1..100, audited at 15) anchors of '
  'the STAMPED version of job_board_category_anchors nearest to q by exact '
  'cosine (sequential scan, no vector index), as (id, field, title, sim = 1 - '
  'distance). Raises with no stamp rather than answering empty. Reads nothing '
  'else; writes nothing. embed-classify.ts resolveEmbed applies the F2 gate to '
  'these rows and still refuses unless the stamp''s LOO passed. Service-role '
  'only: SECURITY DEFINER over an RLS-on table, EXECUTE revoked from anon and '
  'authenticated by name.';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'category_knn';
  IF n <> 1 THEN
    RAISE EXCEPTION 'category_knn: expected exactly one signature, found %', n;
  END IF;
END $$;
