-- A FEEDBACK VOTE THE BUDGET SKIPPED IS NEVER THANKED (register S13-057).
--
-- WHAT WAS WRONG. record_scan_feedback (last defined in 20261004110000)
-- RETURNS VOID. Once client_write_allowed('scan-feedback', 10, 300, 60)
-- refuses (ten votes an hour from one address, or 300 an hour from everyone)
-- it returns without inserting, and the caller receives exactly what a stored
-- vote receives: no data, no error. So the free report's "Was this analysis
-- helpful?" said "Thanks for the feedback!" for votes it never kept.
-- record_scan_outcome already returns a boolean (false on a refusal); its
-- page half is fixed in src/components/ScanOutcomeAsk.tsx.
--
-- WHAT THIS FILE DOES. It gives record_scan_feedback the same answer: true
-- when the vote was stored, false when it was not (no rating, or the budget
-- refused). The body, the budget, the bounds and the grants are otherwise
-- 20261004110000's, unchanged: the same seven arguments with the same
-- defaults, SECURITY DEFINER, search_path public, EXECUTE for anon,
-- authenticated and service_role (the page calls it signed out), nothing for
-- PUBLIC. A return type cannot change in place, so the void definition is
-- dropped first. It is found in the catalogue (public.record_scan_feedback
-- returning void), never by a signature typed here; the grants are applied
-- the same way, to every definition the catalogue lists.
--
-- THE PAGE. src/components/ScanFeedback.tsx thanks only for true; false or an
-- error says "Couldn't save that". Until this file applies the function still
-- answers no data, which the page treats as before (stored), so nothing gets
-- worse in the window between the frontend publish and this migration.
--
-- ORDER: none required. Builder B's range of the free-scan wave
-- (20261101150000-20261101199999); no function deploys with it.
--
-- RE-RUNNABLE: the drop matches only a void definition, so a second run finds
-- none and CREATE OR REPLACE rewrites the boolean one in place; the grants
-- and the self-check only read and re-apply.
--
-- MEASURE: the self-check below (one definition, boolean, definer, the
-- search_path, anon and authenticated may execute, PUBLIC may not).
--
-- ROLLBACK: drop the boolean definition the same way and re-create
-- 20261004110000's void one. The page reads no data as stored.

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '2min';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'record_scan_feedback'
      AND p.prorettype = 'void'::regtype
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.record_scan_feedback(
  p_visitor_id        TEXT DEFAULT NULL,
  p_rating            BOOLEAN DEFAULT true,
  p_industry          TEXT DEFAULT NULL,
  p_ats_score         INTEGER DEFAULT NULL,
  p_had_job_description BOOLEAN DEFAULT false,
  p_resume_word_count INTEGER DEFAULT NULL,
  p_feedback_text     TEXT DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_rating IS NULL THEN
    RETURN false;
  END IF;
  IF NOT public.client_write_allowed('scan-feedback', 10, 300, 60) THEN
    RETURN false;
  END IF;
  INSERT INTO scan_feedback (
    visitor_id, rating, industry, ats_score,
    had_job_description, resume_word_count, feedback_text
  ) VALUES (
    left(p_visitor_id, 64), p_rating, left(p_industry, 60),
    CASE WHEN p_ats_score BETWEEN 0 AND 100 THEN p_ats_score END,
    p_had_job_description,
    CASE WHEN p_resume_word_count BETWEEN 0 AND 100000 THEN p_resume_word_count END,
    left(p_feedback_text, 1000)
  );
  RETURN true;
END;
$$;

-- The grants, to every definition the catalogue lists (one, after the above).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'record_scan_feedback'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role', r.sig);
  END LOOP;
END
$$;

-- SELF-CHECK: refuse the transaction unless the one definition is what the
-- page reads, with the access it had.
DO $$
DECLARE
  v_count int;
  v_oid oid;
  v_ret regtype;
  v_definer boolean;
  v_config text[];
  v_nargs int;
  v_ndefaults int;
  v_acl aclitem[];
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'record_scan_feedback';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'record_scan_feedback: expected one definition, found %', v_count;
  END IF;

  SELECT p.oid, p.prorettype::regtype, p.prosecdef, p.proconfig, p.pronargs, p.pronargdefaults, p.proacl
  INTO v_oid, v_ret, v_definer, v_config, v_nargs, v_ndefaults, v_acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'record_scan_feedback';

  IF v_ret <> 'boolean'::regtype THEN
    RAISE EXCEPTION 'record_scan_feedback returns %, not boolean', v_ret;
  END IF;
  IF NOT v_definer THEN
    RAISE EXCEPTION 'record_scan_feedback is not SECURITY DEFINER';
  END IF;
  IF v_config IS NULL OR NOT ('search_path=public' = ANY (v_config)) THEN
    RAISE EXCEPTION 'record_scan_feedback search_path is %, not public', v_config;
  END IF;
  -- The page calls it with all seven named arguments; every one keeps its default.
  IF v_nargs <> 7 OR v_ndefaults <> 7 THEN
    RAISE EXCEPTION 'record_scan_feedback takes % arguments with % defaults, not 7 and 7', v_nargs, v_ndefaults;
  END IF;
  IF NOT has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'record_scan_feedback lost EXECUTE for anon, authenticated or service_role';
  END IF;
  -- A NULL acl is the default, which grants PUBLIC; grantee 0 is PUBLIC.
  IF v_acl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(v_acl) a WHERE a.grantee = 0) THEN
    RAISE EXCEPTION 'record_scan_feedback is executable by PUBLIC';
  END IF;
END
$$;
