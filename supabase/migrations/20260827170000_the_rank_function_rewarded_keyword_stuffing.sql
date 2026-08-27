-- The ranking function rewarded keyword repetition and department stuffing.
--
-- `title_tsv` is not a title vector. It is
--   setweight(title,'A') || setweight(company,'B') || setweight(department,'C')
-- (20260718200435:5-11), and every ORDER BY called `ts_rank_cd(p.title_tsv, $1)`
-- with NO weights array and NO normalization. The default weights are
-- {D 0.1, C 0.2, B 0.4, A 1.0}, so company and department scored; and with no
-- normalization the score is essentially the weighted COUNT of occurrences. On
-- a 3-8 word title that is not a weak signal, it is an inverted one: the more
-- times a term appears anywhere across those three fields, the higher the rank.
--
-- MEASURED LIVE on the deployed RPC, q="nurse", p_limit=200:
--   186 of the top 200 titles contain a nurs* token TWICE or more
--   the top row is "LPN - Nurse Navigator Licensed Practical Nurse -
--                   Population Health Nurse Triage"
--   median title length in that window is 62.5 chars (control q="welder": 14.5)
--   the 11 rows with only ONE occurrence are all one employer, whose department
--   field is a comma-joined keyword list repeating the term 5-9 times at weight C
--
-- And the sharpest statement of it: q="registered nurse" reports 7,647 title
-- matches, and ZERO of the returned top 200 are titled exactly "Registered
-- Nurse". The re-ranker's exact-match bonus cannot fire, because no exact row is
-- in the window it is handed.
--
-- Deep pages are served in this order raw — the re-ranker is off past the
-- window — so offset 400 on q="nurse" returns 20 rows from TWO companies
-- (16 + 4), every one of them there on department weight.
--
-- THE FIX IS THE WEIGHTS ARRAY, AND DELIBERATELY NOT LENGTH NORMALIZATION.
--
--   ARRAY[0,0,0,1]  zeroes the D/C/B contribution, so ONLY the title's weight-A
--                   lexemes score. Company and department stop contributing
--                   entirely — the stuffing is deleted at the root rather than
--                   diluted. Written as ARRAY[...] rather than the usual
--                   '{0,0,0,1}' literal because all three ORDER BY sites live
--                   INSIDE plpgsql dynamic-SQL strings, where the quotes would
--                   terminate the literal; the first cut failed to parse for
--                   exactly that reason. Both forms score identically.
--
-- NORMALIZATION 2 WAS PROPOSED, MEASURED, AND REJECTED. It divides by the length
-- of the WHOLE tsvector — which still contains the company and department
-- lexemes even when their weight is zero. So it penalises an employer for having
-- a long NAME. Measured on a fixture of the real shapes, q="nurse":
--
--   weights + norm 2:  Registered Nurse [Mercy]                    0.3333
--                      Registered Nurse [St Lukes University ...]  0.1250
--
-- Two IDENTICAL titles, 2.7x apart, because one hospital network has a longer
-- name. That is a new systematic unfairness against exactly the large health
-- systems this board carries most of, and it is worse than the defect it fixes.
-- With weights alone both score 1.0000, as they must.
--
-- WHAT WEIGHTS ALONE DOES NOT FIX: repetition WITHIN a title. "LPN - Nurse
-- Navigator Licensed Practical Nurse - Population Health Nurse Triage" still
-- scores 3.0 on q="nurse". That is left to rerankWindow, which scores the window
-- with an exact-match bonus and now receives a candidate set chosen on title
-- relevance instead of on whose ATS repeats the term in a metadata field —
-- which was the whole point of the finding. Deep pages past the window are
-- served in this order raw and will still favour repetitive titles; the durable
-- fix for that is a title-only tsvector column, which is NOT taken here because
-- adding a STORED generated column rewrites all 708k rows under an ACCESS
-- EXCLUSIVE lock. That is an outage window, and it is a separate decision.
--
-- NO PLAN CHANGE AND NO NEW INDEX. Same stored column, same GIN for the WHERE,
-- same top-N sort — only the expression that orders the rows differs.
--
-- The head-term ring (index.ts) exists partly to compensate for this defect. It
-- is deliberately NOT removed in the same change: two ranking changes at once
-- cannot be told apart if the result is worse.
--
-- CARRIED FORWARD, because re-issuing a function moves the newest-definition
-- guards onto THIS file. These did not change and must not read as dropped:
--   * p_location is pipe-DELIMITED (metro aliases match any of their names).
--     A single-name location splits into a one-element array and behaves EXACTLY as before.
--   * the rescue tiers carry `missing_since IS NULL`, so no tier can serve a
--     posting the employer has already withdrawn.
--   * the fuzzy rescue returns `country text` among its columns.
--   * p_work_mode is a comma-joined LIST validated against {remote,hybrid,onsite}.
--
-- DROP + CREATE with IDENTICAL signatures, and all three re-issued together, for
-- the standing reason: an old overload left in ANY database makes PostgREST
-- answer PGRST203 to every call. Bodies were extracted programmatically from
-- 20260827161000 and patched at the three rank sites only, never retyped.

DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer);
DROP FUNCTION IF EXISTS public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer, text[], boolean, boolean);
DROP FUNCTION IF EXISTS public.count_jobs_capped(timestamptz, text, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, text[], boolean, boolean);
DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, text[], boolean, boolean);


CREATE FUNCTION public.search_jobs(
  p_q text,
  p_fresh_cutoff timestamptz,
  p_location text DEFAULT NULL,
  p_remote boolean DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_experience text[] DEFAULT NULL,
  p_salary_floor numeric DEFAULT NULL,
  p_companies text[] DEFAULT NULL,
  p_posted_after timestamptz DEFAULT NULL,
  p_max_age_days integer DEFAULT NULL,
  p_work_mode text DEFAULT NULL,
  p_limit integer DEFAULT 60,
  p_offset integer DEFAULT 0,
  p_sources text[] DEFAULT NULL
,
  p_pay_stated boolean DEFAULT NULL,
  p_include_unstated boolean DEFAULT false
)
RETURNS TABLE (
  id text, source text, company_token text, company text, title text,
  location text, country text, remote boolean, work_mode text, department text, category text,
  posted_at timestamptz, apply_url text, salary text,
  salary_min_annual numeric, salary_max_annual numeric,
  salary_period text, salary_currency text,
  experience_band text,
  min_years integer, last_seen timestamptz, total_rows bigint,
  related_rows bigint, title_match boolean, snippet text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_modes text[];
  q tsquery := websearch_to_tsquery('english', p_q);
  filters text := ' AND p.effective_posted >= $2 AND p.missing_since IS NULL';
  title_total bigint;
  total bigint;
  related bigint;
  tsv_col text := 'p.title_tsv';
  snippet_sql text := 'NULL::text';
  cols text :=
    'p.id, p.source, p.company_token, p.company, p.title, p.location, p.country, p.remote, '
    || 'p.work_mode, p.department, p.category, p.posted_at, p.apply_url, p.salary, '
    || 'p.salary_min_annual, p.salary_max_annual, p.salary_period, p.salary_currency, '
    || 'p.experience_band, p.min_years::integer, p.last_seen, ';
BEGIN
  IF p_location IS NOT NULL THEN filters := filters || ' AND EXISTS (SELECT 1 FROM unnest(string_to_array($3, ''|'')) AS alias(x) WHERE p.location ILIKE ''%'' || alias.x || ''%'')'; END IF;
  IF p_remote IS TRUE THEN filters := filters || ' AND p.remote'; END IF;
  IF p_country IS NOT NULL THEN filters := filters || ' AND p.country = ANY(string_to_array($4, '','')) '; END IF;
  IF p_category IS NOT NULL THEN filters := filters || ' AND p.category = ANY(string_to_array($5, '','')) '; END IF;
  IF p_experience IS NOT NULL THEN filters := filters || ' AND p.experience_band = ANY($6)'; END IF;
  IF p_salary_floor IS NOT NULL THEN
    filters := filters || CASE WHEN p_include_unstated
      THEN ' AND (p.salary_rank_usd >= $7 OR p.salary_rank_usd IS NULL)'
      ELSE ' AND p.salary_rank_usd >= $7' END;
  END IF;
  IF p_pay_stated IS TRUE THEN filters := filters || ' AND p.salary_min_annual IS NOT NULL'; END IF;
  IF p_companies IS NOT NULL THEN filters := filters || ' AND p.company_token = ANY($8)'; END IF;
  IF p_posted_after IS NOT NULL THEN filters := filters || ' AND p.posted_at > $9'; END IF;
  IF p_max_age_days IS NOT NULL THEN filters := filters || ' AND p.posted_at >= now() - make_interval(days => $10)'; END IF;
  IF p_sources IS NOT NULL THEN filters := filters || ' AND p.source = ANY($11)'; END IF;
  -- WORK MODE IS A LIST NOW, not a single literal. Elements are validated
  -- against the closed domain and anything else is dropped, so the value that
  -- reaches SQL can only ever be a subset of {remote,hybrid,onsite} — the same
  -- contract p_category already has in this function. A caller sending one mode
  -- gets a one-element list and byte-identical behaviour.
  v_modes := ARRAY(
    SELECT DISTINCT btrim(m)
    FROM unnest(string_to_array(coalesce(p_work_mode, ''), ',')) AS m
    WHERE btrim(m) IN ('remote', 'hybrid', 'onsite')
  );
  IF array_length(v_modes, 1) IS NOT NULL THEN
    filters := filters || ' AND p.work_mode = ANY(string_to_array('
                       || quote_literal(array_to_string(v_modes, ',')) || ', '',''))';
  END IF;

  EXECUTE 'SELECT count(*) FROM (SELECT 1 FROM public.job_board_postings p WHERE p.title_tsv @@ $1' || filters || ' LIMIT 10000) c'
    INTO title_total
    USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days, p_sources;

  total := title_total;

  IF title_total < 200 THEN
    tsv_col := 'p.search_tsv';
    snippet_sql := 'ts_headline(''english'', left(coalesce(p.description, ''''), 4000), $1, ''StartSel=[[, StopSel=]], MaxWords=18, MinWords=8, MaxFragments=1'')';
    EXECUTE 'SELECT count(*) FROM (SELECT 1 FROM public.job_board_postings p WHERE p.search_tsv @@ $1' || filters || ' LIMIT 3000) c'
      INTO related
      USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days, p_sources;
    related := GREATEST(coalesce(related, 0) - title_total, 0);
  END IF;

  IF tsv_col = 'p.search_tsv' THEN
    RETURN QUERY EXECUTE
      'WITH title_hits AS ('
      || '  SELECT p.id AS sid FROM public.job_board_postings p WHERE p.title_tsv @@ $1' || filters
      || '  LIMIT 500'
      || '), desc_hits AS ('
      || '  SELECT p.id AS sid FROM public.job_board_postings p WHERE p.search_tsv @@ $1' || filters
      || '  ORDER BY p.effective_posted DESC'
      || '  LIMIT 3000'
      || '), sample AS ('
      || '  SELECT sid FROM title_hits UNION SELECT sid FROM desc_hits'
      || '), page AS MATERIALIZED ('
      || '  SELECT p.id AS pid FROM sample JOIN public.job_board_postings p ON p.id = sample.sid'
      || '  ORDER BY ts_rank_cd(ARRAY[0,0,0,1]::float4[], p.title_tsv, $1) DESC, p.effective_posted DESC, p.id ASC'
      || '  LIMIT GREATEST(LEAST($13, 200), 1) OFFSET GREATEST($14, 0)'
      || ') SELECT ' || cols || '$12::bigint AS total_rows, $15::bigint AS related_rows, (p.title_tsv @@ $1) AS title_match, ' || snippet_sql || ' AS snippet '
      || 'FROM page JOIN public.job_board_postings p ON p.id = page.pid '
      || 'ORDER BY ts_rank_cd(ARRAY[0,0,0,1]::float4[], p.title_tsv, $1) DESC, p.effective_posted DESC, p.id ASC'
      USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days, p_sources, total, p_limit, p_offset, related;
  ELSE
    RETURN QUERY EXECUTE
      'SELECT ' || cols || '$12::bigint AS total_rows, $15::bigint AS related_rows, TRUE AS title_match, NULL::text AS snippet '
      || 'FROM public.job_board_postings p WHERE p.title_tsv @@ $1' || filters
      || ' ORDER BY ts_rank_cd(ARRAY[0,0,0,1]::float4[], p.title_tsv, $1) DESC, p.effective_posted DESC, p.id ASC'
      || ' LIMIT GREATEST(LEAST($13, 200), 1) OFFSET GREATEST($14, 0)'
      USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days, p_sources, total, p_limit, p_offset, related;
  END IF;
END;
$$;

CREATE FUNCTION public.count_jobs_capped(
  p_fresh_cutoff timestamptz,
  p_q text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_remote boolean DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_experience text[] DEFAULT NULL,
  p_salary_floor numeric DEFAULT NULL,
  p_companies text[] DEFAULT NULL,
  p_posted_after timestamptz DEFAULT NULL,
  p_max_age_days integer DEFAULT NULL,
  p_work_mode text DEFAULT NULL,
  p_cap integer DEFAULT 10000,
  p_sources text[] DEFAULT NULL
,
  p_pay_stated boolean DEFAULT NULL,
  p_include_unstated boolean DEFAULT false
)
RETURNS TABLE (n bigint, capped boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_modes text[];
  filters text := ' WHERE p.effective_posted >= $1 AND p.missing_since IS NULL';
  cap integer := GREATEST(LEAST(p_cap, 100000), 100);
  hits bigint;
BEGIN
  IF p_location IS NOT NULL THEN filters := filters || ' AND EXISTS (SELECT 1 FROM unnest(string_to_array($2, ''|'')) AS alias(x) WHERE p.location ILIKE ''%'' || alias.x || ''%'')'; END IF;
  IF p_remote IS TRUE THEN filters := filters || ' AND p.remote'; END IF;
  IF p_country IS NOT NULL THEN filters := filters || ' AND p.country = ANY(string_to_array($3, '','')) '; END IF;
  IF p_category IS NOT NULL THEN filters := filters || ' AND p.category = ANY(string_to_array($4, '','')) '; END IF;
  IF p_experience IS NOT NULL THEN filters := filters || ' AND p.experience_band = ANY($5)'; END IF;
  IF p_salary_floor IS NOT NULL THEN
    filters := filters || CASE WHEN p_include_unstated
      THEN ' AND (p.salary_rank_usd >= $6 OR p.salary_rank_usd IS NULL)'
      ELSE ' AND p.salary_rank_usd >= $6' END;
  END IF;
  IF p_pay_stated IS TRUE THEN filters := filters || ' AND p.salary_min_annual IS NOT NULL'; END IF;
  IF p_companies IS NOT NULL THEN filters := filters || ' AND p.company_token = ANY($7)'; END IF;
  IF p_posted_after IS NOT NULL THEN filters := filters || ' AND p.posted_at > $8'; END IF;
  IF p_max_age_days IS NOT NULL THEN filters := filters || ' AND p.posted_at >= now() - make_interval(days => $9)'; END IF;
  IF p_sources IS NOT NULL THEN filters := filters || ' AND p.source = ANY($11)'; END IF;
  -- WORK MODE IS A LIST NOW, not a single literal. Elements are validated
  -- against the closed domain and anything else is dropped, so the value that
  -- reaches SQL can only ever be a subset of {remote,hybrid,onsite} — the same
  -- contract p_category already has in this function. A caller sending one mode
  -- gets a one-element list and byte-identical behaviour.
  v_modes := ARRAY(
    SELECT DISTINCT btrim(m)
    FROM unnest(string_to_array(coalesce(p_work_mode, ''), ',')) AS m
    WHERE btrim(m) IN ('remote', 'hybrid', 'onsite')
  );
  IF array_length(v_modes, 1) IS NOT NULL THEN
    filters := filters || ' AND p.work_mode = ANY(string_to_array('
                       || quote_literal(array_to_string(v_modes, ',')) || ', '',''))';
  END IF;
  IF p_q IS NOT NULL AND length(btrim(p_q)) > 0 THEN
    filters := filters || ' AND (p.title ILIKE ''%'' || $10 || ''%'' OR p.company ILIKE ''%'' || $10 || ''%'' OR p.department ILIKE ''%'' || $10 || ''%'')';
  END IF;

  EXECUTE 'SELECT count(*) FROM (SELECT 1 FROM public.job_board_postings p' || filters
          || ' LIMIT ' || (cap + 1)::text || ') c'
    INTO hits
    USING p_fresh_cutoff, p_location, p_country, p_category, p_experience,
          p_salary_floor, p_companies, p_posted_after, p_max_age_days, p_q, p_sources;

  IF hits > cap THEN
    RETURN QUERY SELECT cap::bigint, true;
  ELSE
    RETURN QUERY SELECT hits, false;
  END IF;
END;
$$;

CREATE FUNCTION public.fuzzy_title_search(
  p_q text,
  p_fresh_cutoff timestamptz,
  p_limit integer DEFAULT 40,
  p_location text DEFAULT NULL,
  p_remote boolean DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_experience text[] DEFAULT NULL,
  p_salary_floor numeric DEFAULT NULL,
  p_companies text[] DEFAULT NULL,
  p_posted_after timestamptz DEFAULT NULL,
  p_max_age_days integer DEFAULT NULL,
  p_work_mode text DEFAULT NULL,
  p_vendors text[] DEFAULT NULL
,
  p_pay_stated boolean DEFAULT NULL,
  p_include_unstated boolean DEFAULT false
)
RETURNS TABLE (
  id text, source text, company_token text, company text, title text,
  location text, country text, remote boolean, work_mode text,
  department text, category text, posted_at timestamptz, apply_url text,
  salary text, salary_min_annual numeric, salary_max_annual numeric,
  salary_period text, salary_currency text, experience_band text,
  min_years integer, last_seen timestamptz, missing_since timestamptz,
  total_rows bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
SET statement_timeout = '8s'
AS $$
  WITH m AS (
    SELECT p.*, similarity(p.title, p_q) AS sim
    FROM public.job_board_postings p
    WHERE p.title % p_q
      AND p.effective_posted >= p_fresh_cutoff
      AND p.missing_since IS NULL
      AND (p_location IS NULL OR p.location ILIKE '%' || p_location || '%')
      AND (p_remote IS NOT TRUE OR p.remote)
      AND (p_country IS NULL OR p.country = ANY(string_to_array(p_country, ',')))
      AND (p_category IS NULL OR p.category = ANY(string_to_array(p_category, ',')))
      AND (p_experience IS NULL OR p.experience_band = ANY(p_experience))
      AND (p_salary_floor IS NULL
           OR p.salary_rank_usd >= p_salary_floor
           OR (p_include_unstated AND p.salary_rank_usd IS NULL))
      AND (p_pay_stated IS NOT TRUE OR p.salary_min_annual IS NOT NULL)
      AND (p_companies IS NULL OR p.company_token = ANY(p_companies))
      AND (p_posted_after IS NULL OR p.posted_at > p_posted_after)
      AND (p_max_age_days IS NULL OR p.posted_at >= now() - make_interval(days => p_max_age_days))
      AND (p_vendors IS NULL OR p.source = ANY(p_vendors))
      -- Multi-select, same as the two functions above. string_to_array on a
      -- single value yields a one-element array, so a caller that sends one
      -- mode is unaffected.
      AND (p_work_mode IS NULL OR p.work_mode = ANY(string_to_array(p_work_mode, ',')))
    ORDER BY similarity(p.title, p_q) DESC, p.effective_posted DESC
    LIMIT GREATEST(LEAST(p_limit, 60), 1)
  )
  SELECT m.id, m.source, m.company_token, m.company, m.title, m.location,
         m.country, m.remote, m.work_mode, m.department, m.category,
         m.posted_at, m.apply_url, m.salary, m.salary_min_annual,
         m.salary_max_annual, m.salary_period, m.salary_currency,
         m.experience_band, m.min_years::integer, m.last_seen, m.missing_since,
         (SELECT count(*) FROM m)::bigint AS total_rows
  FROM m
  ORDER BY m.sim DESC, m.effective_posted DESC;
$$;

-- AND THE DOOR THE LOCKDOWN LEFT OPEN, six hours after it was written.
--
-- 20260827130000 revoked SELECT on job_board_postings from anon and dropped its
-- public policy — then waved these three functions off in a comment: "the three
-- search RPCs are SECURITY DEFINER and were already independent of this policy".
-- Being independent of the policy is exactly what makes them the remaining hole.
-- They run as their owner, they were still granted to anon, search_jobs returns
-- WHOLE posting rows including apply_url, and p_offset is bounded only by
-- GREATEST($14, 0) — no ceiling at all.
--
-- Proven live with nothing but the published anon key:
--   POST /rest/v1/rpc/search_jobs
--        {"p_q":"engineer","p_fresh_cutoff":"2026-07-28T00:00:00Z",
--         "p_limit":2,"p_offset":40000}
--   -> HTTP 200, full rows, e.g. Palo Alto Networks "Manager, Site Reliability
--      Engineering" with its apply_url.
--
-- Walking p_offset in steps of 200 over a term dictionary reconstitutes the
-- servable corpus — the same asset the lockdown was written to protect, and the
-- one /v1 exists to meter — with no key, no quota and no per-caller limit,
-- because PostgREST is not the job-board edge function.
--
-- Nothing legitimate loses access: grepping the repo for callers of all three
-- names returns exactly one file, supabase/functions/job-board/index.ts, which
-- authenticates with SUPABASE_SERVICE_ROLE_KEY.
--
-- REVOKED FROM THE CATALOG, NOT BY LISTING SIGNATURES. These functions have been
-- widened several times and this database is known to carry functions the
-- migrations do not describe; a hand-listed REVOKE would miss an overload and
-- silently leave the door open, which is the failure mode this whole change is
-- about.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('search_jobs', 'count_jobs_capped', 'fuzzy_title_search')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- Self-verifying, as anon, because a REVOKE that missed an overload looks
-- exactly like one that worked.
DO $$
DECLARE denied boolean := false;
BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.search_jobs('x', now() - interval '30 days');
  EXCEPTION
    WHEN insufficient_privilege THEN denied := true;
    WHEN OTHERS THEN denied := false;
  END;
  RESET ROLE;
  IF NOT denied THEN
    RAISE EXCEPTION 'anon can still execute search_jobs — the corpus is still pageable around the edge function';
  END IF;
END $$;
