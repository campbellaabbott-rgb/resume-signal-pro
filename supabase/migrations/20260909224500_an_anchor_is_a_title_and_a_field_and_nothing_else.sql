-- AN ANCHOR IS A TITLE AND A FIELD AND NOTHING ELSE.
--
-- The third classifier of the Other bucket (the embed basis) is a k-nearest-
-- neighbour vote over a FROZEN list of hand-labelled titles: for a bucket
-- row, embed its title, find the 15 nearest anchor titles by cosine, and let
-- the anchors' fields vote. The list is data/category-anchors.json in the
-- job-board bundle: the 3,060 labelled rows of scratchpad/other-bucket/
-- labelled-basis.jsonl MINUS the 410 whose category was decided by the
-- department rather than the title (they would teach the vote that "Cashier"
-- is customer and "Software Engineer" is science), deduped on (lower(title),
-- field) so cloned postings cannot stack votes: 2,272 anchors across the 17
-- fields, sha256 e1773494f9b12ffb... (EMBED_ANCHORS_SHA256, embed-classify.ts).
-- Measured on that set (other-bucket/mechA, 2026-09-10): leave-one-out kNN
-- agreement 1,959 / 2,272 = 86.2%; at the shipping gate F2 (share >= 0.60,
-- nn1 >= 0.85, centroid agrees, four barred targets) 141 right / 5 wrong /
-- 14 ambiguous of 160 hand-judged draws, 3.1% wrong.
--
-- THIS TABLE HOLDS THE ANCHORS WITH THEIR VECTORS. The vectors are NOT in the
-- JSON: they are produced IN the edge runtime by the same gte-small session
-- index.ts embedText already holds (mean_pool: true, normalize: true, 384
-- dims), because a vector produced anywhere else may not be the vector the
-- runtime produces for the same title (the Xenova build and the Supabase.ai
-- build are different builds of one model). The audited figures transfer to
-- the runtime's vectors only if the runtime reproduces the leave-one-out
-- agreement on them: the loader takes that figure as its p_loo stamp, stores
-- it beside the version, and embed-classify.ts's resolveEmbed THROWS unless
-- the stored stamp is present, at k = 15, over all 2,272 anchors, and within
-- 0.02 of 0.862. Nothing scores against an unproven set.
--
-- TITLE-ONLY BY CONSTRUCTION. The table has no company, no department, no
-- posting id; an anchor's id is a content hash of (lower(title), field). The
-- company name never reaches the basis, so the employer can never leak into
-- an "embed" verdict -- that is what separates this mechanism from the
-- employer default and lets the two disagree (category_key = 'conflict').
--
-- SERVICE-ROLE ONLY. RLS on with NO policies: PostgREST's anon and
-- authenticated roles see nothing and can write nothing; service_role
-- bypasses RLS. The grants say the same thing at the ACL layer. The reader
-- (category_knn, 20260909225000) and this loader are SECURITY DEFINER with
-- EXECUTE revoked from anon and authenticated BY NAME (definer-revoke-
-- pattern.test.ts: revoking from PUBLIC alone left 107 of 121 definer
-- functions anon-callable).
--
-- NO INDEX ON THE VECTOR. 2,272 rows x 384 dims is an exact scan in ~1-2 ms;
-- an HNSW/IVF index would make the neighbours approximate and the audited
-- share figures would no longer be the figures computed ("the ANN was never
-- bounded", 20260827160000). A DO block below refuses the migration if one
-- exists, and the pglite harness proves the RPC's answers equal a plain
-- JavaScript cosine over the same vectors.
--
-- THE LOADER. load_category_anchors(p_version, p_rows, p_loo, p_anchors_sha256,
-- p_final) upserts one chunk of anchors under p_version (id, field, title,
-- embedding[384]); when p_final is true it deletes every anchor of another
-- version, requires the stamp's n to equal the rows now present, writes
-- job_board_meta.category_anchor_version = {version, n, anchors_sha256, loo,
-- loaded_at, previous_version}, and -- when the version CHANGED -- removes
-- every embed-basis entry from job_board_meta.category_promotions whose key
-- is not the new version, logging them to category_promotion_log. A new
-- anchor set carries no audit; a promotion made under the old neighbourhood
-- is not a promotion under this one (the key mismatch already makes
-- promote_category move nothing, 20260909225500; the de-list makes the
-- reset visible in the list itself). Chunks: the full set is ~8 MB as jsonb
-- (2,272 x 384 floats); a caller may send it in parts with p_final false and
-- stamp with the last part. Until the final call, category_knn keeps serving
-- the previously stamped version -- which is only true because the table's
-- identity is (version, id): an anchor id is a content hash of (lower(title),
-- field) with no version in it, so a re-labelled set shares most ids with its
-- predecessor, and a PRIMARY KEY on id alone would re-home those rows out of
-- the stamped version on every non-final chunk (measured in pglite: 20 v1
-- rows stamped, a 12-row v2 chunk, category_knn down to 8 rows with the
-- stamp still saying n = 20). Two versions of one title coexist until the
-- final call's DELETE.
--
-- THIS MIGRATION WRITES NO ANCHOR AND NO STAMP: the table is empty after it,
-- job_board_meta.category_anchor_version does not exist, category_knn raises
-- until a loader run completes, and the loader is called by a chainKey-gated
-- maintenance action that a later phase wires. Nothing here reads or writes
-- job_board_postings.
--
-- Apply after 20260909224000 (job_board_meta.category_promotions is seeded
-- there) and before 20260909225000 (category_knn reads this table).

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.job_board_category_anchors (
  id         text NOT NULL,
  version    text NOT NULL,
  field      text NOT NULL CHECK (field <> 'other' AND btrim(field) <> ''),
  title      text NOT NULL CHECK (btrim(title) <> ''),
  embedding  extensions.vector(384) NOT NULL,
  loaded_at  timestamptz NOT NULL DEFAULT now(),
  -- (version, id): an in-flight reload under a new version never depletes
  -- the version category_knn is serving (header). The key's leading column
  -- also serves the `WHERE a.version = v_version` scan, so no separate
  -- version index is needed.
  PRIMARY KEY (version, id)
);

-- Exactness is the contract: refuse to proceed if anything has indexed the
-- vector column (a hand-built ANN on the live DB would be schema drift that
-- silently changed every answer).
DO $$
DECLARE v_idx text;
BEGIN
  SELECT c.relname INTO v_idx
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (i.indkey)
   WHERE n.nspname = 'public' AND t.relname = 'job_board_category_anchors' AND a.attname = 'embedding'
   LIMIT 1;
  IF v_idx IS NOT NULL THEN
    RAISE EXCEPTION 'job_board_category_anchors.embedding is indexed by % -- category_knn is audited as an EXACT scan; drop the index', v_idx;
  END IF;
END $$;

ALTER TABLE public.job_board_category_anchors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_board_category_anchors FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.job_board_category_anchors TO service_role;

COMMENT ON TABLE public.job_board_category_anchors IS
  'The embed basis'' frozen anchor set: (title, field) pairs from the hand-'
  'labelled rows (minus department-decided ones, deduped), with the vector the '
  'EDGE RUNTIME produced for the title (gte-small, mean_pool, normalize, 384). '
  'No company, department or posting id: title-only by construction. Written '
  'only by load_category_anchors; read only by category_knn (exact cosine, no '
  'vector index -- ever). version = EMBED_ANCHOR_VERSION of the list loaded; '
  'job_board_meta.category_anchor_version carries the stamp (n, sha256, LOO) '
  'the classifier refuses to score without. Service-role only; RLS on, no '
  'policies.';
COMMENT ON COLUMN public.job_board_category_anchors.id IS
  'sha1(lower(title) || ''|'' || field)[0:16] from build-category-anchors.mjs -- a content hash, never a posting id.';
COMMENT ON COLUMN public.job_board_category_anchors.embedding IS
  'The runtime''s own vector for title (index.ts embedText). Not the job_board_embeddings vector: those embed title + company + description and were never audited.';

-- Drop any overload the live database might hold under this name: the live DB
-- has functions the migrations do not (schema drift), and a second signature
-- is PGRST203 on every call.
DO $$
DECLARE
  keep CONSTANT text := 'p_version text, p_rows jsonb, p_loo jsonb, p_anchors_sha256 text, p_final boolean';
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname = 'load_category_anchors'
       AND pg_get_function_identity_arguments(p.oid) IS DISTINCT FROM keep
  LOOP
    RAISE NOTICE 'dropping stray overload %', r.sig;
    EXECUTE 'DROP FUNCTION ' || r.sig::text;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.load_category_anchors(
  p_version        text,
  p_rows           jsonb,
  p_loo            jsonb   DEFAULT NULL,
  p_anchors_sha256 text    DEFAULT NULL,
  p_final          boolean DEFAULT true
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET statement_timeout = '120s'
AS $$
DECLARE
  c_dim        constant integer := 384;
  c_log_keep   constant integer := 500;
  v_bad_id     text;
  v_bad_why    text;
  v_n          integer := 0;
  v_old        jsonb;
  v_old_ver    text;
  v_list_raw   jsonb;
  v_list       jsonb;
  v_wrap       text;
  v_kept       jsonb;
  v_dropped    jsonb;
  v_log        jsonb;
BEGIN
  IF p_version IS NULL OR p_version !~ '^[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'load_category_anchors refused: p_version must be a lower-case identifier (EMBED_ANCHOR_VERSION), got %', COALESCE(p_version, 'NULL');
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'load_category_anchors refused: p_rows must be a JSON array of {id, field, title, embedding}';
  END IF;
  IF p_final AND p_loo IS NOT NULL AND jsonb_typeof(p_loo) <> 'object' THEN
    RAISE EXCEPTION 'load_category_anchors refused: p_loo must be the object computeLooStamp returns, or NULL';
  END IF;

  -- one loader at a time: two chunked loads interleaving would stamp a set
  -- neither of them sent.
  PERFORM pg_advisory_xact_lock(hashtext('job_board_category_anchors'));

  -- Every row well-formed BEFORE any write: a title-only anchor with a field
  -- that is not 'other' and exactly 384 finite numbers.
  SELECT e ->> 'id',
         CASE
           WHEN COALESCE(e ->> 'id', '') = ''                             THEN 'missing id'
           WHEN COALESCE(btrim(e ->> 'field'), '') = ''                   THEN 'missing field'
           WHEN e ->> 'field' = 'other'                                    THEN 'field other is never an anchor'
           WHEN COALESCE(btrim(e ->> 'title'), '') = ''                   THEN 'missing title'
           WHEN jsonb_typeof(e -> 'embedding') IS DISTINCT FROM 'array'   THEN 'embedding is not an array'
           WHEN jsonb_array_length(e -> 'embedding') <> c_dim             THEN 'embedding is not ' || c_dim || ' dims'
           WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(e -> 'embedding') x WHERE jsonb_typeof(x) <> 'number') THEN 'embedding holds a non-number'
           WHEN e ? 'company' OR e ? 'company_token' OR e ? 'department'  THEN 'an anchor carries no company or department'
         END
    INTO v_bad_id, v_bad_why
    FROM jsonb_array_elements(p_rows) e
   WHERE COALESCE(e ->> 'id', '') = ''
      OR COALESCE(btrim(e ->> 'field'), '') = ''
      OR e ->> 'field' = 'other'
      OR COALESCE(btrim(e ->> 'title'), '') = ''
      OR jsonb_typeof(e -> 'embedding') IS DISTINCT FROM 'array'
      OR jsonb_array_length(e -> 'embedding') <> c_dim
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(e -> 'embedding') x WHERE jsonb_typeof(x) <> 'number')
      OR e ? 'company' OR e ? 'company_token' OR e ? 'department'
   LIMIT 1;
  IF v_bad_why IS NOT NULL THEN
    RAISE EXCEPTION 'load_category_anchors refused: row % -- %', COALESCE(v_bad_id, '?'), v_bad_why;
  END IF;

  INSERT INTO public.job_board_category_anchors AS a (id, version, field, title, embedding, loaded_at)
  SELECT e ->> 'id', p_version, btrim(e ->> 'field'), btrim(e ->> 'title'),
         ((e -> 'embedding')::text)::extensions.vector(384), now()
    FROM jsonb_array_elements(p_rows) e
  ON CONFLICT (version, id) DO UPDATE
     SET field = EXCLUDED.field, title = EXCLUDED.title,
         embedding = EXCLUDED.embedding, loaded_at = EXCLUDED.loaded_at;

  SELECT count(*)::integer INTO v_n
    FROM public.job_board_category_anchors a
   WHERE a.version = p_version;

  IF NOT p_final THEN
    RETURN v_n;
  END IF;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'load_category_anchors refused: no anchors under version % -- nothing to stamp', p_version;
  END IF;
  IF p_loo IS NOT NULL THEN
    IF jsonb_typeof(p_loo -> 'agreement') IS DISTINCT FROM 'number'
       OR jsonb_typeof(p_loo -> 'n') IS DISTINCT FROM 'number'
       OR jsonb_typeof(p_loo -> 'k') IS DISTINCT FROM 'number'
       OR jsonb_typeof(p_loo -> 'passed') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'load_category_anchors refused: p_loo needs numeric agreement, n, k and boolean passed (computeLooStamp)';
    END IF;
    IF (p_loo ->> 'n')::integer <> v_n THEN
      RAISE EXCEPTION 'load_category_anchors refused: the LOO stamp covers % anchors but % are loaded under % -- it was computed over a different set', p_loo ->> 'n', v_n, p_version;
    END IF;
  END IF;

  DELETE FROM public.job_board_category_anchors a WHERE a.version <> p_version;

  SELECT m.v INTO v_old FROM public.job_board_meta m WHERE m.k = 'category_anchor_version';
  v_old_ver := v_old ->> 'version';

  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('category_anchor_version',
          jsonb_build_object(
            'version', p_version, 'n', v_n, 'anchors_sha256', p_anchors_sha256,
            'loo', p_loo, 'loaded_at', now(), 'previous_version', v_old_ver),
          now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now();

  -- A new anchor set: every embed promotion listed under another key is a
  -- promotion made under a neighbourhood that no longer exists. De-list it
  -- (the log keeps what was removed); rule and employer entries are untouched.
  IF v_old_ver IS DISTINCT FROM p_version THEN
    -- The list a person wrote: a bare array (canonical, 20260909224000); a
    -- wrapped {"list"} or {"promotions"} is tolerated -- the SAME expression
    -- promote_category and revert_category read with (a guard pins the
    -- three identical), and the write-back below keeps whichever wrapper.
    SELECT m.v INTO v_list_raw FROM public.job_board_meta m WHERE m.k = 'category_promotions';
    v_list := CASE jsonb_typeof(v_list_raw) WHEN 'array' THEN v_list_raw ELSE COALESCE(v_list_raw -> 'list', v_list_raw -> 'promotions', '[]'::jsonb) END;
    v_wrap := CASE WHEN jsonb_typeof(v_list_raw) = 'array' THEN NULL WHEN v_list_raw ? 'list' THEN 'list' WHEN v_list_raw ? 'promotions' THEN 'promotions' END;
    SELECT COALESCE(jsonb_agg(t.e ORDER BY t.i) FILTER (WHERE NOT (t.e ->> 'basis' = 'embed' AND t.e ->> 'key' IS DISTINCT FROM p_version)), '[]'::jsonb),
           COALESCE(jsonb_agg(t.e ORDER BY t.i) FILTER (WHERE      t.e ->> 'basis' = 'embed' AND t.e ->> 'key' IS DISTINCT FROM p_version), '[]'::jsonb)
      INTO v_kept, v_dropped
      FROM jsonb_array_elements(v_list) WITH ORDINALITY AS t(e, i);
    IF jsonb_array_length(v_dropped) > 0 THEN
      UPDATE public.job_board_meta m
         SET v = CASE WHEN v_wrap IS NULL THEN v_kept ELSE v_list_raw || jsonb_build_object(v_wrap, v_kept) END,
             updated_at = now()
       WHERE m.k = 'category_promotions';
      SELECT COALESCE(m.v -> 'entries', '[]'::jsonb) INTO v_log
        FROM public.job_board_meta m WHERE m.k = 'category_promotion_log';
      v_log := COALESCE(v_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'event', 'anchor_reload', 'from', v_old_ver, 'to', p_version, 'delisted', v_dropped, 'at', now()));
      IF jsonb_array_length(v_log) > c_log_keep THEN
        SELECT jsonb_agg(t.e ORDER BY t.i) INTO v_log
          FROM jsonb_array_elements(v_log) WITH ORDINALITY AS t(e, i)
         WHERE t.i > jsonb_array_length(v_log) - c_log_keep;
      END IF;
      INSERT INTO public.job_board_meta (k, v, updated_at)
      VALUES ('category_promotion_log', jsonb_build_object('entries', v_log), now())
      ON CONFLICT (k) DO UPDATE SET v = jsonb_build_object('entries', v_log), updated_at = now();
    END IF;
  END IF;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.load_category_anchors(text, jsonb, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.load_category_anchors(text, jsonb, jsonb, text, boolean) TO service_role;

COMMENT ON FUNCTION public.load_category_anchors(text, jsonb, jsonb, text, boolean) IS
  'The only writer of job_board_category_anchors. Upserts one chunk of '
  '{id, field, title, embedding[384]} rows under p_version (title-only: a row '
  'carrying company/company_token/department is refused, as is field other); '
  'with p_final true it drops every other version, requires p_loo.n to equal '
  'the rows loaded, stamps job_board_meta.category_anchor_version = {version, '
  'n, anchors_sha256, loo, loaded_at, previous_version}, and on a version '
  'change de-lists every embed-basis entry of category_promotions whose key '
  'is not the new version (logged to category_promotion_log as anchor_reload). '
  'p_loo is the object embed-classify.ts computeLooStamp returns from the '
  'runtime''s OWN vectors; resolveEmbed refuses to score unless it is present, '
  'passed, at k = 15, over 2,272 anchors and within 0.02 of 0.862. Returns the '
  'rows now held under p_version. Touches no posting. Service-role only.';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'load_category_anchors';
  IF n <> 1 THEN
    RAISE EXCEPTION 'load_category_anchors: expected exactly one signature, found %', n;
  END IF;
END $$;
