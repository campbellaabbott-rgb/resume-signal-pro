-- DEEP PAGES MUST NOT HEADLINE THE ROWS THEY SKIP —
-- AND "POSTED AFTER" MUST MEAN THE EMPLOYER'S DATE ON EVERY PATH.
--
-- Two changes, both to the same two functions, so they ship as one DROP+CREATE
-- rather than two migrations racing to replace the same objects. The second is
-- described at its own line below.
--
-- The description tier put ts_headline() in the target list of the SAME SELECT
-- that carried LIMIT/OFFSET. Postgres evaluates that target list for every row
-- the node below OFFSET produces, so the headline — and the TOAST detoast of
-- description behind it — ran once per SKIPPED row. Cost is linear in p_offset
-- and independent of p_limit.
--
-- MEASURED LIVE 2026-08-22, concurrency 4, p_limit 180,
-- p_q='clinical documentation specialist' (description tier):
--   p_offset 1000  -> HTTP 500, 57014 statement timeout, 4 of 4, 3.21-3.39s
--   p_offset 1500  -> HTTP 500, 3 of 4
--   p_offset 3000  -> HTTP 500, 4 of 4
-- p_offset 200000 returns ZERO rows and still times out, so the cost is provably
-- in the rows OFFSET throws away, not the ones returned. The title tier selects
-- 'NULL::text AS snippet' and is flat at any offset (q='manager' p_offset 90000
-- ran 2.04-2.73s x4, all 200).
--
-- This is a PREREQUISITE, not an optimisation: the edge function is about to
-- start sending real p_offset values on the scored path. Apply and verify this
-- BEFORE deploying job-board/index.ts.
--
-- THE FIX. Rank, limit and offset inside a MATERIALIZED CTE that selects only
-- the id, then join back and compute the snippet on the <=200 rows that actually
-- ship. MATERIALIZED is explicit rather than relied upon: a LIMIT node is already
-- an optimisation barrier, but this is the one property the change depends on and
-- it should not rest on planner discretion. Row order and content are unchanged —
-- the inner ORDER BY is the same expression list ending in p.id ASC, so the
-- ranking is total and the outer ORDER BY re-sorts the same rows into the same
-- sequence. Verified against the OLD function that p_offset=200 is byte-stable
-- across repeats.
--
-- DROP + CREATE, and BOTH functions re-issued, even though the signatures are
-- BYTE-IDENTICAL and CREATE OR REPLACE would be safe against PGRST203. The repo's
-- guards select "the newest migration that DEFINES search_jobs or
-- count_jobs_capped and mentions p_sources" and then assert on it:
-- board-agent-ready-filter.test.ts:34 — plain CREATE for BOTH, the sources
-- parameter declared and bound exactly once per function, a DROP ahead of each
-- CREATE, the total_rows cast, and the positional LIMIT/OFFSET clause.
--
-- THE ASSERTIONS ABOVE ARE DESCRIBED, NOT QUOTED, AND THAT IS DELIBERATE. Those
-- guards COUNT occurrences of their literals across this whole file, comments
-- included. Spelling them here made this file carry three copies of a string
-- that must appear exactly twice, and the guard failed on prose while the SQL
-- was correct. That has now happened four times in this repo. A comment must
-- never contain the literal a guard counts.
-- board-uncategorised.test.ts:30 (string_to_array >= 2), and
-- changing-a-signature-must-drop-the-old-one.test.ts:110. A CREATE OR REPLACE of
-- search_jobs alone fails four of those. count_jobs_capped below is unchanged from
-- 20260807064219, character for character.
--
-- The DROPs name the CURRENT 15- and 14-parameter signatures, not the
-- pre-p_sources ones the previous migration dropped. A DROP naming a signature
-- that no longer exists is a silent no-op, and the plain CREATE that follows then
-- fails with "function already exists".
--
-- NOT CHANGED HERE, deliberately: the `IF title_total < 200` escalation. A filter
-- can still flip the tier and widen a search (PT+manager 233, +workMode:hybrid
-- 266). Every discriminator proposed for it so far collapses filtered skill
-- searches (q=aws+PT 93 -> 2, python 145 -> 8, excel 449 -> 3, hvac 7 -> 0) or
-- has no separating gap (hvac title/desc 20.8% against manager 28.1%). That fix
-- must be written against THIS file, in its own migration, with a discriminator
-- validated over skill terms.

DROP FUNCTION IF EXISTS public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer, text[]);

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
)
RETURNS TABLE (
  id text, source text, company_token text, company text, title text,
  location text, country text, remote boolean, work_mode text, department text, category text,
  posted_at timestamptz, apply_url text, salary text,
  salary_min_annual numeric, salary_max_annual numeric,
  salary_period text, salary_currency text,
  experience_band text,
  min_years integer, last_seen timestamptz, total_rows bigint, snippet text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q tsquery := websearch_to_tsquery('english', p_q);
  filters text := ' AND p.effective_posted >= $2 AND p.missing_since IS NULL';
  title_total bigint;
  total bigint;
  tsv_col text := 'p.title_tsv';
  snippet_sql text := 'NULL::text';
  cols text :=
    'p.id, p.source, p.company_token, p.company, p.title, p.location, p.country, p.remote, '
    || 'p.work_mode, p.department, p.category, p.posted_at, p.apply_url, p.salary, '
    || 'p.salary_min_annual, p.salary_max_annual, p.salary_period, p.salary_currency, '
    || 'p.experience_band, p.min_years::integer, p.last_seen, ';
BEGIN
  IF p_location IS NOT NULL THEN filters := filters || ' AND p.location ILIKE ''%'' || $3 || ''%'''; END IF;
  IF p_remote IS TRUE THEN filters := filters || ' AND p.remote'; END IF;
  -- A SELECTION OF COUNTRIES, THE SAME WAY A SELECTION OF FIELDS ALREADY WORKS.
  -- Equality could only ever express one, so "DE,GB" matched the literal string
  -- and returned zero. This is the split the category line two rows down has
  -- used since the unsorted bucket shipped; the parameter list is untouched, so
  -- there is no new signature and no ambiguity exposure.
  IF p_country IS NOT NULL THEN filters := filters || ' AND p.country = ANY(string_to_array($4, '','')) '; END IF;
  IF p_category IS NOT NULL THEN filters := filters || ' AND p.category = ANY(string_to_array($5, '','')) '; END IF;
  IF p_experience IS NOT NULL THEN filters := filters || ' AND p.experience_band = ANY($6)'; END IF;
  IF p_salary_floor IS NOT NULL THEN filters := filters || ' AND p.salary_rank_usd >= $7'; END IF;
  IF p_companies IS NOT NULL THEN filters := filters || ' AND p.company_token = ANY($8)'; END IF;
  -- POSTED AFTER MEANS THE EMPLOYER'S DATE, ON THIS PATH TOO.
  -- effective_posted is coalesce(posted_at, first_seen), so binding it here
  -- answered "we first SAW it after X", and every undated posting passed on the
  -- strength of a recent crawl. The browse path was corrected to posted_at in
  -- e16fcdc3; this one was missed, which is the shape the note at index.ts:7576
  -- warns about — a fix landing on one of four query paths and silently missing
  -- the rest. Measured live before this change: q=manager postedAfter=2026-08-20
  -- returned total 10,000 with 14 of 60 rows carrying NO employer date, against
  -- 7,274 and 0 of 60 for the honest maxAgeDays comparator.
  -- posted_at > x excludes NULL by construction, which is the correct answer:
  -- a posting whose date the employer never stated cannot be shown to be newer
  -- than a date the visitor named.
  IF p_posted_after IS NOT NULL THEN filters := filters || ' AND p.posted_at > $9'; END IF;
  IF p_max_age_days IS NOT NULL THEN filters := filters || ' AND p.posted_at >= now() - make_interval(days => $10)'; END IF;
  -- Bound like every other optional filter: the bind is always present in USING,
  -- the clause only when the caller asked.
  IF p_sources IS NOT NULL THEN filters := filters || ' AND p.source = ANY($11)'; END IF;
  IF p_work_mode IN ('remote', 'hybrid', 'onsite') THEN
    filters := filters || ' AND p.work_mode = ' || quote_literal(p_work_mode);
  END IF;

  EXECUTE 'SELECT count(*) FROM (SELECT 1 FROM public.job_board_postings p WHERE p.title_tsv @@ $1' || filters || ' LIMIT 10000) c'
    INTO title_total
    USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days, p_sources;

  IF title_total < 200 THEN
    tsv_col := 'p.search_tsv';
    snippet_sql := 'ts_headline(''english'', left(coalesce(p.description, ''''), 4000), $1, ''StartSel=[[, StopSel=]], MaxWords=18, MinWords=8, MaxFragments=1'')';
    EXECUTE 'SELECT count(*) FROM (SELECT 1 FROM public.job_board_postings p WHERE p.search_tsv @@ $1' || filters || ' LIMIT 3000) c'
      INTO total
      USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days, p_sources;
  ELSE
    total := title_total;
  END IF;

  -- total/limit/offset are $12/$13/$14 — the FILTER numbering stays contiguous.
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
      || '  ORDER BY ts_rank_cd(p.title_tsv, $1) DESC, p.effective_posted DESC, p.id ASC'
      || '  LIMIT GREATEST(LEAST($13, 200), 1) OFFSET GREATEST($14, 0)'
      || ') SELECT ' || cols || '$12::bigint AS total_rows, ' || snippet_sql || ' AS snippet '
      || 'FROM page JOIN public.job_board_postings p ON p.id = page.pid '
      || 'ORDER BY ts_rank_cd(p.title_tsv, $1) DESC, p.effective_posted DESC, p.id ASC'
      USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days, p_sources, total, p_limit, p_offset;
  ELSE
    RETURN QUERY EXECUTE
      'SELECT ' || cols || '$12::bigint AS total_rows, NULL::text AS snippet '
      || 'FROM public.job_board_postings p WHERE p.title_tsv @@ $1' || filters
      || ' ORDER BY ts_rank_cd(p.title_tsv, $1) DESC, p.effective_posted DESC, p.id ASC'
      || ' LIMIT GREATEST(LEAST($13, 200), 1) OFFSET GREATEST($14, 0)'
      USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days, p_sources, total, p_limit, p_offset;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer, text[]) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.count_jobs_capped(timestamptz, text, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, text[]);

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
)
RETURNS TABLE (n bigint, capped boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  filters text := ' WHERE p.effective_posted >= $1 AND p.missing_since IS NULL';
  cap integer := GREATEST(LEAST(p_cap, 100000), 100);
  hits bigint;
BEGIN
  IF p_location IS NOT NULL THEN filters := filters || ' AND p.location ILIKE ''%'' || $2 || ''%'''; END IF;
  IF p_remote IS TRUE THEN filters := filters || ' AND p.remote'; END IF;
  -- Same split as search_jobs, or the headline answers a different question
  -- from the rows it sits over.
  IF p_country IS NOT NULL THEN filters := filters || ' AND p.country = ANY(string_to_array($3, '','')) '; END IF;
  IF p_category IS NOT NULL THEN filters := filters || ' AND p.category = ANY(string_to_array($4, '','')) '; END IF;
  IF p_experience IS NOT NULL THEN filters := filters || ' AND p.experience_band = ANY($5)'; END IF;
  IF p_salary_floor IS NOT NULL THEN filters := filters || ' AND p.salary_rank_usd >= $6'; END IF;
  IF p_companies IS NOT NULL THEN filters := filters || ' AND p.company_token = ANY($7)'; END IF;
  -- Same correction as search_jobs above: the count must ask the question the
  -- list answers, or the headline and the rows disagree by a third.
  IF p_posted_after IS NOT NULL THEN filters := filters || ' AND p.posted_at > $8'; END IF;
  IF p_max_age_days IS NOT NULL THEN filters := filters || ' AND p.posted_at >= now() - make_interval(days => $9)'; END IF;
  IF p_sources IS NOT NULL THEN filters := filters || ' AND p.source = ANY($11)'; END IF;
  IF p_work_mode IN ('remote', 'hybrid', 'onsite') THEN
    filters := filters || ' AND p.work_mode = ' || quote_literal(p_work_mode);
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

GRANT EXECUTE ON FUNCTION public.count_jobs_capped(timestamptz, text, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, text[]) TO anon, authenticated, service_role;

-- ===========================================================================
-- A TYPO PLUS ANY FILTER RETURNED ZERO JOBS.
-- ===========================================================================
-- The trigram rescue stood down whenever any filter was active, because this
-- function took no filter arguments and its result columns did not even carry
-- country or work mode, so the edge function could not narrow its rows
-- afterwards either. Measured live 2026-08-22 against the DEPLOYED board, and
-- re-confirmed the same day this file was written:
--   q=nurrse                        -> 17 rows, disclosed as close matches
--   q=nurrse + country US           -> 0 rows, total 0, no disclosure at all
--   q=nurrse + category healthcare  -> 0 rows, total 0, no disclosure
--   q=nurrse + workMode remote      -> 0 rows, total 0, no disclosure
--
-- HYDRATE-AND-REFILTER WAS MEASURED AND REJECTED FOR THIS TIER. Fetching the
-- unfiltered top 60 and re-querying those ids through the edge function's own
-- filter binder needs no signature change, and it is what the semantic tier now
-- does. Here it fails, because the cap lands BEFORE the filter: of the 60 rows
-- this function returns for q=nurrse, 26 survive a US filter, 2 survive GB and
-- 0 survive a work-mode filter.
--
-- BE HONEST ABOUT THE SIZE OF THE WIN, because the first draft of this comment
-- was not. The trigram operator does not reach every posting whose title
-- CONTAINS the misspelled word — similarity('Registered Nurse','nurrse') is
-- below the threshold — so the reachable pool is not the ILIKE pool. Measured by
-- shrinking the freshness window until the result fell under the 60-row cap, so
-- the figure is the COMPLETE set and not a capped head:
--   q=nurrse   1-day window:  8 rows total
--   q=nurrse   3-day window: 47 rows total — US 14, GB 13, remote 0
--   q=nurrse   4-day window: 56 rows total — US 19, GB 14, remote 0
--   q=desinger 8-day window: 47 rows total — US 19, GB  1, remote 4
-- Extrapolated 30-day nurrse set: on the order of 350-450 rows, not 15,000.
--
-- So the honest claim is this: pushing the filters into the WHERE clause takes a
-- GB-filtered typo search from 2 rows to a full page, because the similarity-
-- ordered head is dominated by US-heavy short titles while the complete set is
-- about 28% GB. It does NOT make every filtered typo search return rows —
-- workMode=remote returns zero either way for this query class, and the tier
-- then correctly falls through to the semantic one. The page does not always
-- fill. It stops lying about why.
--
-- THE PREDICATES ARE WRITTEN AS "parameter IS NULL OR column = parameter" ON
-- PURPOSE. That form cannot be served by an index on the filtered column, and
-- that is the desired outcome: the trigram index on title stays the only
-- selective access path, so the planner cannot flip to walking the work-mode
-- serving index (44,993 fresh rows) or seq-scanning for country (256,372 fresh
-- US rows) and rechecking similarity on each. The rows this function touches
-- stay bounded by the trigram match set exactly as today, and a filter can only
-- shrink it. Baseline on the deployed function, concurrency 4, all 200:
-- nurrse 0.48-0.57s, desinger 1.33-1.36s, enginer 1.40s, maneger 1.49-1.65s.
--
-- THE CALLER MUST NOT SEND A ONE- OR TWO-CHARACTER QUERY HERE. Degenerate
-- queries are this function's worst case by a wide margin — measured at
-- concurrency 4 on the deployed version, q='a' 3.07-3.36s, q='++' 3.94-3.96s,
-- q='  ' 2.64-2.72s, against a named worst case of 1.65s for a real misspelling.
-- The edge function gates this tier at three characters, the same floor the
-- semantic and augmentation tiers already use. Do not remove that gate.
--
-- TWO SMALLER DEFECTS CLOSED IN THE SAME REWRITE:
--  * No freshness-of-presence predicate. This was one of two read paths still
--    able to serve postings the board has already stamped as gone from their
--    employer's feed; the other one is corrected immediately below.
--  * No country and no work mode in the result columns, so the row mapper
--    emitted null for both and the response self-check would have flagged every
--    rescued row as violating a filter the database had actually honoured.
--
-- DROP + CREATE, naming the THREE-argument signature that is live right now.
-- Verified against production: PostgREST reports exactly one candidate, taking a
-- query, a freshness cutoff and a limit. This one DOES change arity, so the
-- ordering rule at the top of this file is load-bearing here: apply the SQL
-- first, and the edge function omits the new arguments entirely when nothing is
-- narrowed so that an unfiltered typo search keeps working in either order.

DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer);

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
      AND (p_salary_floor IS NULL OR p.salary_rank_usd >= p_salary_floor)
      AND (p_companies IS NULL OR p.company_token = ANY(p_companies))
      AND (p_posted_after IS NULL OR p.posted_at > p_posted_after)
      AND (p_max_age_days IS NULL OR p.posted_at >= now() - make_interval(days => p_max_age_days))
      AND (p_vendors IS NULL OR p.source = ANY(p_vendors))
      AND (p_work_mode IS NULL OR p.work_mode = p_work_mode)
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

GRANT EXECUTE ON FUNCTION public.fuzzy_title_search(text, timestamptz, integer, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, text[]) TO anon, authenticated, service_role;

-- ===========================================================================
-- THE SECOND GHOST-SERVING READ PATH.
-- ===========================================================================
-- The claim that the trigram rescue was "the last" read path able to serve a
-- posting already stamped as gone from its employer's feed was FALSE when it was
-- written. The semantic tier has the same hole: its only predicates are the
-- distance ceiling and a 30-day recency window. It fires on the queries where
-- the board has least else to offer, which is exactly when a dead posting is
-- most likely to be clicked.
--
-- Its signature is UNCHANGED, so this is an in-place replace and carries no
-- overload risk. It is included in this file rather than a separate one only so
-- that the whole search read surface moves in a single apply; nothing else in
-- this migration depends on it.

CREATE OR REPLACE FUNCTION public.search_jobs_semantic(
  p_embedding text,
  p_limit integer DEFAULT 30,
  p_max_distance numeric DEFAULT 0.18
)
RETURNS TABLE (
  id text, source text, company_token text, company text, title text,
  location text, remote boolean, work_mode text, department text, category text,
  posted_at timestamptz, apply_url text, salary text,
  salary_min_annual numeric, salary_max_annual numeric,
  salary_period text, salary_currency text,
  experience_band text, min_years integer, last_seen timestamptz,
  similarity numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
SET statement_timeout = '15s'
SET hnsw.ef_search = '100'
AS $$
  SELECT p.id, p.source, p.company_token, p.company, p.title,
         p.location, p.remote, p.work_mode, p.department, p.category,
         p.posted_at, p.apply_url, p.salary,
         p.salary_min_annual, p.salary_max_annual,
         p.salary_period, p.salary_currency,
         p.experience_band, p.min_years::integer, p.last_seen,
         round((1 - (e.embedding <=> p_embedding::extensions.vector(384)))::numeric, 3) AS similarity
  FROM public.job_board_embeddings e
  JOIN public.job_board_postings p ON p.id = e.id
  WHERE e.embedding <=> p_embedding::extensions.vector(384) <= LEAST(GREATEST(p_max_distance, 0.05), 0.5)
    AND p.effective_posted >= now() - interval '30 days'
    AND p.missing_since IS NULL
  ORDER BY e.embedding <=> p_embedding::extensions.vector(384)
  LIMIT LEAST(GREATEST(p_limit, 1), 60);
$$;

GRANT EXECUTE ON FUNCTION public.search_jobs_semantic(text, integer, numeric) TO anon, authenticated, service_role;
```
