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
  IF p_country IS NOT NULL THEN filters := filters || ' AND p.country = $4'; END IF;
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
  IF p_country IS NOT NULL THEN filters := filters || ' AND p.country = $3'; END IF;
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
