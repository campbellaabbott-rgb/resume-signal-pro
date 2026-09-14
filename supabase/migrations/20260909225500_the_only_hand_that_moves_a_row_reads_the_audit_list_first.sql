-- THE ONLY HAND THAT MOVES A ROW READS THE AUDIT LIST FIRST.
--
-- 20260909224000 gave every posting a shadow: what a classifier PROPOSES, on
-- what basis, under which key. This file is the one and only writer that turns
-- a proposal into a `category`. It moves rows for exactly one (basis, key,
-- target) triple per call, and it refuses unless that triple is listed -- by
-- hand, after a written audit -- in job_board_meta.category_promotions.
--
-- WHY A LIST IN A META ROW AND NOT AN ARGUMENT. The gate the plan wrote down
-- is a HUMAN one: 8 fresh drawn rows per rule term or employer default, 30 per
-- embed target (60 for hospitality_retail and healthcare), judged right/wrong/
-- ambiguous in a file under scratchpad/other-bucket/audit/<basis>-<key>.md,
-- promoted only at 0 wrong (rule, employer) or <= 1 wrong in 30 (embed). A
-- function cannot read a file, so it reads the list a person writes AFTER the
-- file exists, and it re-checks the two numbers the entry must carry against
-- the same constants:
--
--   c_min_judged_rule  = 8    PROMOTE_MIN_JUDGED_PER_KEY (rule, employer):
--                             the v9 bar, 8/8 hand-judged matches per term
--                             (journal wf_ae544b66-955, guards #4, #8)
--   c_max_wrong_rule   = 0    PROMOTE_MAX_WRONG (rule, employer)
--   c_min_judged_embed = 30   per embed target field (guards #8)
--   c_max_wrong_embed  = 1    <= 1/30 per embed target: F2 measured 141R/5W/
--                             14A on 160 judged = 3.1% wrong, so a target is
--                             held to a third of that
--
-- An entry that lacks `audit`, `judged` or `wrong`, or whose numbers miss the
-- bar, is refused with the same message as an unlisted triple: the list is
-- not a switch, it is the audit's receipt.
--
-- THE TARGET MUST BE A SERVED FIELD. category_proposed may carry a shadow-only
-- candidate slug (media_entertainment, say) so the bucket can be COUNTED per
-- candidate vertical before a tile exists (20260909224000); `category` may
-- not, because job_board_postings.category carries no CHECK and a row moved
-- into a slug visibleCategories() never serves leaves the bucket tile and
-- appears under no tile at all. c_targets is JOB_CATEGORIES minus 'other'
-- (supabase/functions/_shared/board-domains.ts); a guard pins the two equal.
--
-- WHAT THE MOVE DOES, AND DOES NOT DO.
--   sets `category` = p_target, for rows that are still 'other' AND whose
--   (category_basis, category_key, category_proposed) equal the triple --
--   never a row another mechanism claimed, never a conflict row (a conflict
--   row has no proposal, and 'conflict' is refused as a key outright), never a
--   row the v9 chain already filed;
--   leaves category_proposed, category_basis, category_key,
--   category_confidence, category_proposed_at, category_proposed_v EXACTLY as
--   they were. Basis is permanent: it is how Explore counts inferred rows
--   apart from rule-filed ones, how the facet shows them, and how the revert
--   finds them again;
--   moves at most p_limit rows per call (default 2,000, cap 5,000) and returns
--   the number moved, so a caller loops until 0 and Domino's ~15,000 rows
--   never sit under one lock; the partial index from 224000 serves the probe;
--   appends {basis, key, target, moved, at} to job_board_meta
--   k = 'category_promotion_log' (last 500 entries kept), so the only number
--   anyone publishes about a promotion is the one the UPDATE returned;
--   never writes category_promotions. The list is the human's; the log is
--   the function's.
--
-- THE REVERT IS ONE STATEMENT, and it is the mirror function in
-- 20260909226000. Spelled out, because a comment that says "revert" and does
-- not say how is a runbook entry nobody can execute at 3 a.m.:
--   UPDATE public.job_board_postings
--      SET category = 'other', category_proposed = NULL, category_proposed_at = NULL
--    WHERE category_basis = $1 AND category_key = $2
--      AND ($3 IS NULL OR category_proposed = $3)   -- one target, or all of the key's
--      AND (category = 'other' OR category IS NOT DISTINCT FROM category_proposed)
--      AND (category <> 'other' OR category_proposed IS NOT NULL);
-- category_basis and category_key are KEPT by the revert: they are the audit
-- trail that says which key once claimed the row. $3 matters for the embed
-- basis, whose key (the anchor version) spans every target field: an embed
-- audit is per target, so its revert must be too.
--
-- EMBED PROMOTIONS EXPIRE WITH THEIR ANCHORS BY CONSTRUCTION. An embed row's
-- key is the anchor version (embed_knn_v1). Any anchor change bumps the
-- version, the next shadow pass writes the new key, and every listed embed
-- triple under the old key matches nothing: unpromoted without a DELETE.
--
-- SECURITY DEFINER, service_role only. job_board_postings has been closed to
-- anon since 20260827130000, and this function WRITES it. REVOKE names anon and
-- authenticated (revoking from PUBLIC alone left 107 of 121 definer functions
-- anon-callable; src/test/definer-revoke-pattern.test.ts). The catalog drop
-- ahead of CREATE removes any overload the live database might hold under this
-- name -- the live DB has functions the migrations don't (schema drift), and a
-- second signature is PGRST203 on every call.
--
-- 42702: no RETURNS TABLE, so no OUT names; parameters are p_-prefixed, locals
-- v_-prefixed, and every column reference is alias-qualified anyway.

DO $$
DECLARE
  keep CONSTANT text := 'p_basis text, p_key text, p_target text, p_limit integer';
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname = 'promote_category'
       AND pg_get_function_identity_arguments(p.oid) IS DISTINCT FROM keep
  LOOP
    RAISE NOTICE 'dropping stray overload %', r.sig;
    EXECUTE 'DROP FUNCTION ' || r.sig::text;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.promote_category(
  p_basis  text,
  p_key    text,
  p_target text,
  p_limit  integer DEFAULT 2000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '60s'
AS $$
DECLARE
  -- The promotion bar, as constants (provenance in the file header).
  c_min_judged_rule  constant integer := 8;
  c_max_wrong_rule   constant integer := 0;
  c_min_judged_embed constant integer := 30;
  c_max_wrong_embed  constant integer := 1;
  c_limit_cap        constant integer := 5000;
  c_log_keep         constant integer := 500;
  -- The served fields (JOB_CATEGORIES minus 'other'), in catalog order.
  c_targets          constant text[] := ARRAY['engineering', 'data_ai', 'design', 'product', 'marketing', 'sales', 'customer', 'finance', 'legal', 'people_hr', 'operations', 'healthcare', 'science', 'education', 'hospitality_retail', 'security', 'admin'];
  v_limit      integer := LEAST(GREATEST(COALESCE(p_limit, 2000), 1), c_limit_cap);
  v_list       jsonb;
  v_entry      jsonb;
  v_min_judged integer;
  v_max_wrong  integer;
  v_moved      integer := 0;
  v_log        jsonb;
  v_hint       text;
BEGIN
  v_hint := format('write scratchpad/other-bucket/audit/%s-%s.md (TEMPLATE.md there), then list {"basis","key","target","audit","judged","wrong"} by hand in job_board_meta.category_promotions', COALESCE(p_basis, '?'), COALESCE(p_key, '?'));

  IF p_basis IS NULL OR p_key IS NULL OR p_target IS NULL THEN
    RAISE EXCEPTION 'promote_category refused: basis, key and target are all required' USING HINT = v_hint;
  END IF;
  IF p_basis NOT IN ('rule', 'employer', 'embed') THEN
    RAISE EXCEPTION 'promote_category refused: basis % is not rule, employer or embed', p_basis USING HINT = v_hint;
  END IF;
  IF p_key = 'conflict' THEN
    RAISE EXCEPTION 'promote_category refused: a conflict row is never promotable' USING HINT = 'two mechanisms disagreed on these rows; decide the convention in categories.ts, re-run the sweep, and promote under the mechanism''s own key';
  END IF;
  IF p_target = 'other' THEN
    RAISE EXCEPTION 'promote_category refused: a move to other is a revert; call revert_category(basis, key)';
  END IF;
  IF p_target <> ALL (c_targets) THEN
    RAISE EXCEPTION 'promote_category refused: target % is not a served field (a shadow-only candidate slug may be proposed and counted, never promoted)', p_target
      USING HINT = 'served: ' || array_to_string(c_targets, ', ');
  END IF;

  -- The list a person wrote: a bare array (the canonical shape, the one
  -- shadow.ts's readPromotions also reads); a wrapped {"list"} or
  -- {"promotions"} is tolerated here.
  SELECT m.v INTO v_list FROM public.job_board_meta m WHERE m.k = 'category_promotions';
  v_list := CASE jsonb_typeof(v_list) WHEN 'array' THEN v_list ELSE COALESCE(v_list -> 'list', v_list -> 'promotions', '[]'::jsonb) END;
  SELECT e INTO v_entry
    FROM jsonb_array_elements(v_list) AS e
   WHERE e ->> 'basis' = p_basis AND e ->> 'key' = p_key AND e ->> 'target' = p_target
   LIMIT 1;
  IF v_entry IS NULL THEN
    RAISE EXCEPTION 'promote_category refused: (%, %, %) is not listed in job_board_meta.category_promotions', p_basis, p_key, p_target USING HINT = v_hint;
  END IF;

  -- The receipt the entry must carry, re-checked against the bar.
  IF p_basis = 'embed' THEN
    v_min_judged := c_min_judged_embed; v_max_wrong := c_max_wrong_embed;
  ELSE
    v_min_judged := c_min_judged_rule;  v_max_wrong := c_max_wrong_rule;
  END IF;
  IF COALESCE(v_entry ->> 'audit', '') = '' THEN
    RAISE EXCEPTION 'promote_category refused: the listing for (%, %, %) names no audit file', p_basis, p_key, p_target USING HINT = v_hint;
  END IF;
  -- COALESCE, because a MISSING key makes `!~` NULL, and IF NULL is not taken:
  -- an entry with no counts at all would otherwise walk straight through.
  IF COALESCE(v_entry ->> 'judged', '') !~ '^[0-9]+$' OR COALESCE(v_entry ->> 'wrong', '') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'promote_category refused: the listing for (%, %, %) carries no judged/wrong counts', p_basis, p_key, p_target USING HINT = v_hint;
  END IF;
  IF (v_entry ->> 'judged')::integer < v_min_judged OR (v_entry ->> 'wrong')::integer > v_max_wrong THEN
    RAISE EXCEPTION 'promote_category refused: (%, %, %) judged %/wrong % misses the bar (judged >= %, wrong <= %)',
      p_basis, p_key, p_target, v_entry ->> 'judged', v_entry ->> 'wrong', v_min_judged, v_max_wrong USING HINT = v_hint;
  END IF;

  -- The move. Only rows still in the bucket, only this triple, at most v_limit.
  WITH picked AS (
    SELECT p.id
      FROM public.job_board_postings p
     WHERE p.category = 'other'
       AND p.category_basis = p_basis
       AND p.category_key = p_key
       AND p.category_proposed = p_target
     LIMIT v_limit
  ),
  moved AS (
    UPDATE public.job_board_postings p
       SET category = p_target
      FROM picked
     WHERE p.id = picked.id
    RETURNING p.id
  )
  SELECT count(*)::integer INTO v_moved FROM moved;

  -- The receipt of the move: the only number about this promotion anyone may
  -- quote is the one the UPDATE returned.
  SELECT COALESCE(m.v -> 'entries', '[]'::jsonb) INTO v_log
    FROM public.job_board_meta m WHERE m.k = 'category_promotion_log';
  v_log := COALESCE(v_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'basis', p_basis, 'key', p_key, 'target', p_target,
    'moved', v_moved, 'limit', v_limit, 'audit', v_entry ->> 'audit', 'at', now()));
  IF jsonb_array_length(v_log) > c_log_keep THEN
    SELECT jsonb_agg(t.e ORDER BY t.i) INTO v_log
      FROM jsonb_array_elements(v_log) WITH ORDINALITY AS t(e, i)
     WHERE t.i > jsonb_array_length(v_log) - c_log_keep;
  END IF;
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('category_promotion_log', jsonb_build_object('entries', v_log), now())
  ON CONFLICT (k) DO UPDATE SET v = jsonb_build_object('entries', v_log), updated_at = now();

  RETURN v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_category(text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_category(text, text, text, integer) TO service_role;

COMMENT ON FUNCTION public.promote_category(text, text, text, integer) IS
  'THE ONLY WRITER OF job_board_postings.category from the shadow columns. '
  'Moves at most p_limit rows whose category is still other and whose '
  '(category_basis, category_key, category_proposed) equal (p_basis, p_key, '
  'p_target); refuses unless that triple is listed in job_board_meta.'
  'category_promotions with an audit file name and judged/wrong counts that '
  'clear the bar (rule/employer: judged >= 8, wrong = 0; embed: judged >= 30, '
  'wrong <= 1); refuses a target that is not a served field. Leaves every '
  'shadow column as it was. Returns rows moved; appends the count to '
  'job_board_meta.category_promotion_log. REVERT IS ONE STATEMENT: UPDATE '
  'public.job_board_postings SET category = ''other'', category_proposed = '
  'NULL, category_proposed_at = NULL WHERE category_basis = $1 AND '
  'category_key = $2 AND ($3 IS NULL OR category_proposed = $3) AND (category '
  '= ''other'' OR category IS NOT DISTINCT FROM category_proposed) AND '
  '(category <> ''other'' OR category_proposed IS NOT NULL) -- '
  'revert_category(basis, key[, target]) is that statement with its guards. '
  'Service-role only.';

-- Self-verifying: exactly one promote_category must exist after this file.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'promote_category';
  IF n <> 1 THEN
    RAISE EXCEPTION 'promote_category: expected exactly one signature, found %', n;
  END IF;
END $$;
