-- ONE STATEMENT PUTS THE ROW BACK.
--
-- The mirror of promote_category (20260909225500). A promotion is a bet on a
-- key -- one rule term, one employer token, one anchor version -- and when a
-- later draw says the bet was wrong, every row that key moved comes back with
-- ONE UPDATE, scoped by the same two columns the promotion was scoped by.
-- This file is that UPDATE with two guards around it; the statement itself is
-- also spelled out in promote_category's COMMENT so it can be run by hand from
-- a SQL console if the function is ever the thing that is broken.
--
-- WHAT IT DOES
--   category           -> 'other'   for rows this key moved (category equals
--                                    the proposal) and rows it only proposed
--                                    (category still 'other')
--   category_proposed  -> NULL      the proposal is withdrawn, so the shadow
--   category_proposed_at -> NULL     count no longer shows it and a fresh pass
--                                    may propose again under a re-audited key
-- WHAT IT KEEPS -- the audit trail
--   category_basis, category_key, category_confidence, category_proposed_v
--   stay: they say which mechanism and which key once claimed the row, at what
--   confidence, under which version. A revert that erased them would erase
--   the only evidence of what was reverted.
-- ONE TARGET, OR ALL OF THE KEY'S. p_target (optional, NULL = every target)
-- narrows the revert to rows proposed into one field. A rule term and an
-- employer token propose one field each, so the two-argument call is the
-- whole revert for them; the EMBED key is the anchor version, shared by every
-- field it files into, and an embed audit is per target field (30 judged per
-- target) -- so when one target fails a re-audit, revert_category('embed',
-- 'embed_knn_v1', 'finance') puts back finance alone. The de-list guard is
-- scoped the same way: with a target, only that target's entry must be gone.
--
-- WHAT IT REFUSES TO TOUCH
--   a row whose category is neither 'other' nor its own proposal: the v9
--   chain filed it directly under some field and the shadow stamp on it was
--   never taken up, so this key has no claim to undo there. That is the
--   `(category = 'other' OR category IS NOT DISTINCT FROM category_proposed)`
--   arm, and the harness proves it with a row filed 'engineering' that carries
--   a hospitality_retail proposal under the reverted key.
--
-- DE-LIST FIRST. A revert while the (basis, key, *) triple is still listed in
-- job_board_meta.category_promotions is a revert the next promote_category
-- call undoes, silently, in a maintenance tick. So the function refuses while
-- any entry for (p_basis, p_key) is listed: remove the entry by hand -- the
-- list is the human's -- and call again. The refusal names the entry.
--
-- Returns the number of rows the UPDATE touched (moved back plus proposals
-- withdrawn), and appends {basis, key, reverted, at} to the same
-- category_promotion_log promote_category writes, so the ledger of moves and
-- un-moves is one list.
--
-- A DELIBERATE SEQUENTIAL SCAN. The partial index from 20260909224000 covers
-- (category_basis, category_proposed) WHERE category = 'other' -- the
-- promoter's probe. The revert's rows are the ones a promotion moved OUT of
-- 'other', which that predicate excludes, so the UPDATE below reads the
-- ~940k-row table once (seconds, under a 120 s statement_timeout). A revert
-- is a rare hand operation; a second CONCURRENTLY index for it is not worth a
-- build on the hot table. If reverts ever become routine, add
-- (category_basis, category_key) WHERE category_basis IS NOT NULL through the
-- same cron oneshot pair.
--
-- SECURITY DEFINER, service_role only, REVOKE by name from anon and
-- authenticated; catalog drop of stray overloads ahead of CREATE; one
-- signature asserted after. No RETURNS TABLE, parameters p_-prefixed, locals
-- v_-prefixed, columns alias-qualified (42702).

DO $$
DECLARE
  keep CONSTANT text := 'p_basis text, p_key text, p_target text';
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname = 'revert_category'
       AND pg_get_function_identity_arguments(p.oid) IS DISTINCT FROM keep
  LOOP
    RAISE NOTICE 'dropping stray overload %', r.sig;
    EXECUTE 'DROP FUNCTION ' || r.sig::text;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.revert_category(
  p_basis  text,
  p_key    text,
  p_target text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '120s'
AS $$
DECLARE
  c_log_keep constant integer := 500;
  v_list     jsonb;
  v_listed   jsonb;
  v_reverted integer := 0;
  v_log      jsonb;
BEGIN
  IF p_basis IS NULL OR p_key IS NULL THEN
    RAISE EXCEPTION 'revert_category refused: basis and key are both required';
  END IF;
  IF p_basis NOT IN ('rule', 'employer', 'embed') THEN
    RAISE EXCEPTION 'revert_category refused: basis % is not rule, employer or embed', p_basis;
  END IF;
  IF p_target = 'other' THEN
    RAISE EXCEPTION 'revert_category refused: other is where a revert goes, not what it targets';
  END IF;

  -- De-list first, or the next promote_category call re-moves the rows.
  -- The same list expression promote_category and the anchor loader read.
  SELECT m.v INTO v_list FROM public.job_board_meta m WHERE m.k = 'category_promotions';
  v_list := CASE jsonb_typeof(v_list) WHEN 'array' THEN v_list ELSE COALESCE(v_list -> 'list', v_list -> 'promotions', '[]'::jsonb) END;
  SELECT e INTO v_listed
    FROM jsonb_array_elements(v_list) AS e
   WHERE e ->> 'basis' = p_basis AND e ->> 'key' = p_key
     AND (p_target IS NULL OR e ->> 'target' = p_target)
   LIMIT 1;
  IF v_listed IS NOT NULL THEN
    RAISE EXCEPTION 'revert_category refused: (%, %) is still listed in job_board_meta.category_promotions as %; remove the entry by hand first, or the next promotion tick re-moves these rows', p_basis, p_key, v_listed::text;
  END IF;

  -- The one statement.
  WITH reverted AS (
    UPDATE public.job_board_postings p
       SET category = 'other',
           category_proposed = NULL,
           category_proposed_at = NULL
     WHERE p.category_basis = p_basis
       AND p.category_key = p_key
       AND (p_target IS NULL OR p.category_proposed = p_target)
       AND (p.category = 'other' OR p.category IS NOT DISTINCT FROM p.category_proposed)
       -- and only where there is something to revert: a second call reports
       -- 0, not the six rows it would otherwise re-touch unchanged.
       AND (p.category <> 'other' OR p.category_proposed IS NOT NULL)
    RETURNING p.id
  )
  SELECT count(*)::integer INTO v_reverted FROM reverted;

  SELECT COALESCE(m.v -> 'entries', '[]'::jsonb) INTO v_log
    FROM public.job_board_meta m WHERE m.k = 'category_promotion_log';
  v_log := COALESCE(v_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'basis', p_basis, 'key', p_key, 'target', p_target, 'reverted', v_reverted, 'at', now()));
  IF jsonb_array_length(v_log) > c_log_keep THEN
    SELECT jsonb_agg(t.e ORDER BY t.i) INTO v_log
      FROM jsonb_array_elements(v_log) WITH ORDINALITY AS t(e, i)
     WHERE t.i > jsonb_array_length(v_log) - c_log_keep;
  END IF;
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('category_promotion_log', jsonb_build_object('entries', v_log), now())
  ON CONFLICT (k) DO UPDATE SET v = jsonb_build_object('entries', v_log), updated_at = now();

  RETURN v_reverted;
END;
$$;

REVOKE ALL ON FUNCTION public.revert_category(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revert_category(text, text, text) TO service_role;

COMMENT ON FUNCTION public.revert_category(text, text, text) IS
  'The mirror of promote_category: one UPDATE that sets category back to '
  'other and withdraws the proposal (category_proposed, category_proposed_at '
  '-> NULL) for every row whose (category_basis, category_key) equal (p_basis, '
  'p_key) -- narrowed to category_proposed = p_target when one is given (an '
  'embed key spans every target; its audit and revert are per target) -- and '
  'whose category is other or its own proposal. KEEPS '
  'category_basis, category_key, category_confidence and category_proposed_v '
  'as the audit trail. Refuses while any (p_basis, p_key) entry is still '
  'listed in job_board_meta.category_promotions -- de-list first. Returns rows '
  'touched; logs to category_promotion_log. Service-role only.';

-- Self-verifying: exactly one revert_category must exist after this file.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'revert_category';
  IF n <> 1 THEN
    RAISE EXCEPTION 'revert_category: expected exactly one signature, found %', n;
  END IF;
END $$;
