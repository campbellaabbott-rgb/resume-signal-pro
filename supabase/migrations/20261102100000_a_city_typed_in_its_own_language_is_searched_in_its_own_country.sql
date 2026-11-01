-- A CITY TYPED IN ITS OWN LANGUAGE IS SEARCHED IN ITS OWN COUNTRY (S13-006).
--
-- "Wien" expands to Vienna and Wien (location-terms.ts METRO_ALIASES), and
-- the English name matched Vienna, Virginia, Vienna, West Virginia and Vienna,
-- Georgia: live on job-board.2026-09-09.96, location "Wien" with q "nurse"
-- served 9 rows, 7 of them in the US. The same for Firenze (41 of 50 rows in
-- Florence, SC/KY/AL), Geneve (20 of 50 in Geneva, IL/NY) and Warszawa.
--
-- The board now sends a name added for a city typed in its own language as
-- "Vienna@Austria" (the typed form stays a plain substring). This teaches the
-- three search functions that one arm: the name, on a row NOT placed in the
-- US, or on a US-placed row whose location names the country. Not "placed in
-- Austria": one country column cannot hold a multi-city posting ("Zurich,
-- Switzerland; Amsterdam; London" is placed GB), and every homonym measured
-- was a US town. Every other alias is matched as before.
--
-- PATCHED FROM THE CATALOG, NOT RETYPED. Each function's live definition is
-- read with pg_get_functiondef and the one plain-alias line is replaced, so
-- whatever else the live body holds is kept byte for byte. Safe to re-run: a
-- body that already carries the arm is left alone. A body that does not hold
-- the line exactly once is refused, and nothing is changed.
--
-- Deploy order: before job-board (a board that sends "Vienna@Austria" to an
-- unpatched function only loses the English-name rows until this applies).
DO $$
DECLARE
  f text;
  v_oid oid;
  v_n integer;
  v_def text;
  v_old CONSTANT text := 'v_loc := v_loc || (''p.location ILIKE '' || quote_literal(''%'' || v_alias || ''%''));';
  v_new CONSTANT text := 'IF v_alias ~ ''^[^@]+@[A-Za-z]+$'' THEN v_loc := v_loc || (''(p.location ILIKE '' || quote_literal(''%'' || split_part(v_alias, ''@'', 1) || ''%'') || '' AND (p.country IS DISTINCT FROM ''''US'''' OR p.location ILIKE '' || quote_literal(''%'' || split_part(v_alias, ''@'', 2) || ''%'') || ''))''); ELSE '
    || 'v_loc := v_loc || (''p.location ILIKE '' || quote_literal(''%'' || v_alias || ''%'')); END IF;';
BEGIN
  FOREACH f IN ARRAY ARRAY['search_jobs', 'count_jobs_capped', 'fuzzy_title_search'] LOOP
    SELECT count(*), max(pr.oid) INTO v_n, v_oid
    FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
    WHERE ns.nspname = 'public' AND pr.proname = f;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '% has % signatures in pg_proc; refusing to patch', f, v_n;
    END IF;
    v_def := pg_get_functiondef(v_oid);
    IF strpos(v_def, 'split_part(v_alias, ''@'', 2)') > 0 THEN
      CONTINUE;
    END IF;
    IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
      RAISE EXCEPTION '% does not hold the plain alias arm exactly once; refusing to patch', f;
    END IF;
    EXECUTE replace(v_def, v_old, v_new);
  END LOOP;
END $$;

-- Self-verifying: each body carries the anchored arm once, no client role can
-- execute any of them, and each runs with an anchored and a plain alias.
DO $$
DECLARE
  f text;
  v_src text;
  v_rows bigint;
BEGIN
  FOREACH f IN ARRAY ARRAY['search_jobs', 'count_jobs_capped', 'fuzzy_title_search'] LOOP
    SELECT max(pr.prosrc) INTO v_src
    FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
    WHERE ns.nspname = 'public' AND pr.proname = f;
    IF v_src IS NULL OR strpos(v_src, 'split_part(v_alias, ''@'', 2)') = 0 THEN
      RAISE EXCEPTION '% does not bind an anchored alias to its country', f;
    END IF;
    IF strpos(v_src, 'quote_literal(''^'' || v_code') = 0 THEN
      RAISE EXCEPTION '% lost its state-code arms', f;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
      WHERE ns.nspname = 'public' AND pr.proname = f
        AND (has_function_privilege('anon', pr.oid, 'EXECUTE') OR has_function_privilege('authenticated', pr.oid, 'EXECUTE'))
    ) THEN
      RAISE EXCEPTION '% is executable by a client role', f;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_rows FROM public.search_jobs('zqxjvkw', now(), p_location => 'Vienna@Austria|Wien|, TX', p_limit => 1);
  SELECT count(*) INTO v_rows FROM public.search_jobs('zqxjvkw', now(), p_location => 'Vienna@Austria|Wien', p_limit => 1, p_title_only => true);
  SELECT count(*) INTO v_rows FROM public.count_jobs_capped(now(), 'zqxjvkw', p_location => 'Vienna@Austria|Wien');
  SELECT count(*) INTO v_rows FROM public.fuzzy_title_search('zqxjvkw', now(), 1, p_location => 'Vienna@Austria|Wien');
END $$;

NOTIFY pgrst, 'reload schema';
