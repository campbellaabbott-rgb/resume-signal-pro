-- THE BOARD PRINTED THE EMPLOYER'S WAGE AND THE FILTER CALLED THE POSTING SILENT.
--
-- "States pay" bound the ANNUALISED column. The card is gated on the verbatim
-- pay TEXT (Jobs.tsx renders it whenever that text exists), so every posting
-- whose rate we declined to multiply into a year showed its wage in bold on a
-- row the control had just classified as stating nothing. The population that
-- decline lands on is not random: the shared parser refuses to apply a
-- 2,080-hour year to a rate carrying a part-time, casual, per-diem or on-call
-- signal, so the rows dropped were disproportionately the part-time and casual
-- work whose seekers most need a posted wage.
--
-- MEASURED LIVE with the anon key through the board's own read paths, and every
-- figure carries the minute it was taken because this corpus moves ~2% an hour:
--   * Exhaustive walks of two complete country strata, every row read, no
--     sampling. IE at 2026-09-27T02:01:53Z: 2,575 rows, 312 carry pay text,
--     282 carry an annual -> 30 postings print a wage under a control that
--     calls them silent. NZ at 02:02:42Z: 1,455 rows, 161 text, 143 annual
--     -> 18. Both walks agreed EXACTLY with the board's own counted answer for
--     the same stratum (282 and 143, counted at 02:01:02Z and 02:01:04Z).
--   * The hourly slice, counted per country at 02:00:55Z-02:01:10Z
--     (hourly / hourly-and-flagged-as-stating-pay): CA 2,170/1,461,
--     GB 1,875/905, AU 464/168, IE 82/68, NZ 38/23, DE 26/23, NL 24/13.
--   * Board-wide, ONE scan over 733,190 servable rows at 2026-09-27T02:07:00Z:
--     207,108 carry pay text, 173,868 an annual figure, 173,826 a figure a pay
--     floor can compare. So this predicate admits 33,240 postings, the
--     control's published reach moves 23.71% -> 28.25%, and the
--     annual-but-unconvertible slice nobody can see from a row is 42 rows.
--
-- WHAT THE NEW PREDICATE IS, AND WHY IT IS THE PLAIN ONE. The control is
-- labelled for the employer's act, not for our arithmetic, so it now asks
-- whether the employer put a figure in the pay field at all. Three candidates
-- were measured and two refused:
--   * Widening to rows that also state a PERIOD was refused: 39% of the gap
--     population states no period, including every bare range of the
--     "$15.00 - $22.00" shape and every parity-currency figure, and admitting
--     a wage because the text happened to spell out its schedule while
--     refusing the identical wage next to it is an arbitrary line.
--   * Widening to rows stating a period of a year or a month was refused
--     outright: 96.6% of what it adds over the hourly arm carries a figure our
--     own parser judges implausible for the basis it claims.
--   * An extra clause demanding a nonzero DIGIT was measured and dropped, and it
--     is dropped for one reason only: the pay column holds no prose at all, so
--     the arm would have excluded nothing. 0 of 5,472 stored texts carry no
--     digit; 0 of 473 pay-stating rows in the two walked strata; and 0 of 5,350
--     pay texts in a 12,000-row walk of the two vendors with structured pay
--     fields, which is where a vendor default would show up first
--     (2026-09-27T03:30:38Z-03:33:10Z, both vendors read to the end of their
--     inventory). Not one "competitive", "DOE" or "negotiable" string in any of
--     the three samples.
--   * A ZERO-VALUED FIGURE IS A DIFFERENT QUESTION, AND IT IS ACCEPTED HERE
--     RATHER THAN ANSWERED. The arm that would exclude a pay field reading
--     "EUR 0 - 0" is a nonzero-VALUE test, not a nonzero-digit test, and no
--     measurement above bears on it: every such row carries digits. Measured in
--     the same 12,000-row walk, 11 of the 1,674 newly-admitted rows (0.66%)
--     carry a figure whose every number is zero — eight "EUR 0 - 0", one
--     "GBP 0 - 0", one "USD 0 - 0" and one "$0", all of them a vendor's empty
--     structured salary rendered as text — and 8 more carry a zero LOWER bound
--     beside a real upper one ("EUR 0 - 3000", "$0 - $125K"), which do state pay.
--     So the accepted error is on the order of 0.7% of the rows this predicate
--     admits, against the 33,240 it recovers. It is accepted because the card
--     prints that same text: a reader who ticks this control sees "EUR 0 - 0" on
--     the card and can judge it, so the control and the card agree about the row,
--     which is the property this whole change is about. Excluding them would take
--     a value test written in PostgREST once and in plpgsql three times, on an
--     unindexed column, for 0.7% — a decision that has not been made, and must
--     not be made in one runtime alone if it ever is.
--
-- COST, MEASURED RATHER THAN ASSUMED. The pay field carries no index, which is
-- the seq-scan trap an added OR arm would walk into — but this is not an OR, it
-- is one NULL test, and it is DENSER than the period column an existing filter
-- already tests without one (28.3% against 13.1%), so a limited scan finds its
-- rows sooner. Timed live from outside, three runs each, indexed annual column
-- against unindexed period column, on a stratum whose count does NOT cap:
-- GB counts 684/736/791ms against 645/582/589ms, GB pages 1074/769/784ms
-- against 990/878/717ms. The ranges overlap completely. RE-MEASURED at
-- 2026-09-27T03:57:58Z on the same shape, three runs each: the unindexed period
-- column 677/414/753ms over 1,870 rows against the indexed annualised column's
-- 693/823/571ms over 4,825 rows -- the unindexed one is if anything faster. This
-- is a PROXY for the new predicate, not the predicate itself (the pay field
-- cannot be timed until this migration is live), so the post-deploy runbook takes
-- the real timing: verify-deploy section 5y check (e), which fails if the
-- stated-pay count is more than 2.5x the floor-column count and says what to do
-- about it.
--
-- THE THREE FUNCTIONS MOVE IN ONE FILE, AND THAT IS DELIBERATE. The house rule
-- is one function per migration; it is overridden here because a PARTIAL apply
-- of this change IS the defect it repairs. The count function and the ranked
-- search must answer the identical question or the page headlines a number
-- that describes a different population, which is the 2026-07-25 work-mode
-- defect; the rescue tier must answer it too or a typo'd query serves rows the
-- count did not count. One file is one staged apply, so they cannot land apart.
--
-- EACH BODY WAS EXTRACTED FROM ITS OWN LATEST DEFINITION, not from the latest
-- definition of the group -- the rule 20260901200000 exists to record, after a
-- body copied from the group's file silently reverted a location fix. Two of
-- these come from 20260901090000 and the rescue tier comes from 20260901200000,
-- and the extraction was verified to change EXACTLY ONE LINE in each of the
-- three: the line that names the column the stated-pay test reads.
--
-- NOT TOUCHED HERE, deliberately: the pay FLOOR, the pay CEILING and the pay
-- SORT all compare an approximate-USD generated column, and a rate we would not
-- annualise has no value in it. They keep excluding those rows, because
-- inventing a schedule for a part-time wage is how a rate became a six-figure
-- salary once already. The edge function discloses the excluded rows per page
-- instead; refusing to compare and saying so is the only option here that costs
-- no accuracy. The generated column itself, and the undated rate table behind
-- it, are out of scope.
--
-- CONTRACTS CARRIED FORWARD UNCHANGED (this file is the live definition now):
--   * p_location is a '|'-joined alias list matched with EXISTS over
--     string_to_array. A single-name location splits into a
--     one-element array and behaves EXACTLY as before, whether or not the caller
--     knows the list form exists.
--   * p_work_mode and p_employment_type stay validated comma lists inlined via
--     quote_literal, so no positional binding shifts and the OR-form title
--     query's own placeholder keeps its number.
--   * The paged parameters keep their positions; nothing in this change adds,
--     removes or reorders a parameter, so an edge bundle older or newer than
--     this migration calls the same arity and behaves identically apart from
--     the one predicate.
--   * The agency opt-out stays bound in the ranked search, the count and the
--     rescue tier, and the rescue tier keeps the alias-splitting location
--     clause 20260829120000 fixed and 20260901090000 briefly reverted.
--
-- EVERY SIGNATURE IS DROPPED FROM THE CATALOG FIRST, and the signatures this
-- file replaces are ALSO named one per function above their own CREATE -- the
-- sweep alone is invisible to a test that reads SQL text, and this database is
-- known to hold overloads no migration file records. Arity does not change, so
-- no overload can be created here; the drops exist so a stale overload from an
-- environment that missed an earlier migration cannot survive beside the new
-- definition and answer every call with the ambiguity code.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('search_jobs', 'count_jobs_capped', 'fuzzy_title_search')
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer, text[], boolean, boolean, numeric, text, integer, text, text, boolean);
DROP FUNCTION IF EXISTS public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer, text[], boolean, boolean, numeric, text, integer, text, text);
DROP FUNCTION IF EXISTS public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer, text[], boolean, boolean, numeric, text, integer, text);
DROP FUNCTION IF EXISTS public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer, text[], boolean, boolean);
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
  p_include_unstated boolean DEFAULT false,
  p_salary_ceiling numeric DEFAULT NULL,
  p_pay_basis text DEFAULT NULL,
  p_max_years integer DEFAULT NULL,
  p_department text DEFAULT NULL,
  p_employment_type text DEFAULT NULL,
  p_exclude_agencies boolean DEFAULT false
)
RETURNS TABLE (
  id text, source text, company_token text, company text, title text,
  location text, country text, remote boolean, work_mode text, employment_type text, department text, category text,
  posted_at timestamptz, apply_url text, salary text,
  salary_min_annual numeric, salary_max_annual numeric,
  salary_period text, salary_currency text,
  experience_band text,
  min_years integer, last_seen timestamptz, agency boolean, total_rows bigint,
  related_rows bigint, title_match boolean, snippet text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_modes text[];
  v_etypes text[];
  q tsquery := websearch_to_tsquery('english', p_q);
  q_or tsquery;
  filters text := ' AND p.effective_posted >= $2 AND p.missing_since IS NULL';
  title_total bigint;
  total bigint;
  related bigint;
  tsv_col text := 'p.title_tsv';
  snippet_sql text := 'NULL::text';
  cols text :=
    'p.id, p.source, p.company_token, p.company, p.title, p.location, p.country, p.remote, '
    || 'p.work_mode, p.employment_type, p.department, p.category, p.posted_at, p.apply_url, p.salary, '
    || 'p.salary_min_annual, p.salary_max_annual, p.salary_period, p.salary_currency, '
    || 'p.experience_band, p.min_years::integer, p.last_seen, p.agency, ';
BEGIN
  -- THE SAME TERMS, OR'ED, USED ONLY TO ORDER THE RELATED SEGMENT.
  --
  -- websearch_to_tsquery joins bare words with AND, so `q` never matches the
  -- title of a description-only row and ts_rank_cd against title_tsv returns 0
  -- for every one of them. That is the whole related segment tied at zero and
  -- falling through to effective_posted — no relevance ordering at all. This is
  -- the OR form of the same query, so a title carrying SOME of the words
  -- outranks one carrying none.
  --
  -- Built from querytree() rather than by rewriting p_q: replacing spaces with
  -- " or " would break a quoted phrase into disjuncts, while querytree returns
  -- the parsed query with `&` between stemmed lexemes and `<->` inside phrases,
  -- so swapping `&` for `|` loosens the conjunction and leaves phrases whole.
  --
  -- querytree returns 'T' for a query with no indexable lexemes (all stopwords),
  -- and 'T' does not cast back to tsquery. Both that and any future parse
  -- surprise fall back to `q`, where the new key equals the old one and the
  -- ordering is exactly today's.
  IF numnode(q) > 1 THEN
    BEGIN
      q_or := replace(querytree(q), '&', '|')::tsquery;
    EXCEPTION WHEN OTHERS THEN
      q_or := q;
    END;
  ELSE
    q_or := q;
  END IF;

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
  IF p_pay_stated IS TRUE THEN filters := filters || ' AND p.salary IS NOT NULL'; END IF;
  IF p_companies IS NOT NULL THEN filters := filters || ' AND p.company_token = ANY($8)'; END IF;
  IF p_posted_after IS NOT NULL THEN filters := filters || ' AND p.posted_at > $9'; END IF;
  IF p_max_age_days IS NOT NULL THEN filters := filters || ' AND p.posted_at >= now() - make_interval(days => $10)'; END IF;
  IF p_sources IS NOT NULL THEN filters := filters || ' AND p.source = ANY($11)'; END IF;
  -- WORK MODE IS A LIST NOW, not a single literal. Elements are validated
  -- against the closed domain and anything else is dropped, so the value that
  -- reaches SQL can only ever be a subset of {remote,hybrid,onsite} — the same
  -- contract p_category already has in this function. A caller sending one mode
  -- gets a one-element list and byte-identical behaviour.
  -- THE FOUR PREVIOUSLY-BLIND FILTERS, inlined the way v_modes already is —
  -- numerics via ::text (no injection surface), the department via
  -- quote_literal — so every positional USING clause stays byte-identical.
  IF p_salary_ceiling IS NOT NULL THEN
    filters := filters || CASE WHEN p_include_unstated
      THEN ' AND (p.salary_rank_usd <= ' || p_salary_ceiling::text || ' OR p.salary_rank_usd IS NULL)'
      ELSE ' AND p.salary_rank_usd <= ' || p_salary_ceiling::text END;
  END IF;
  -- Closed domain, tested in plpgsql: no caller text ever reaches the SQL.
  IF p_pay_basis = 'hourly' THEN
    filters := filters || ' AND p.salary_period = ''hour''';
  ELSIF p_pay_basis = 'salaried' THEN
    filters := filters || ' AND p.salary_period IN (''year'', ''month'')';
  END IF;
  IF p_max_years IS NOT NULL THEN
    filters := filters || ' AND p.min_years <= ' || p_max_years::integer::text;
  END IF;
  IF p_department IS NOT NULL THEN
    filters := filters || ' AND p.department ILIKE ' || quote_literal('%' || p_department || '%');
  END IF;
  v_modes := ARRAY(
    SELECT DISTINCT btrim(m)
    FROM unnest(string_to_array(coalesce(p_work_mode, ''), ',')) AS m
    WHERE btrim(m) IN ('remote', 'hybrid', 'onsite')
  );
  IF array_length(v_modes, 1) IS NOT NULL THEN
    filters := filters || ' AND p.work_mode = ANY(string_to_array('
                       || quote_literal(array_to_string(v_modes, ',')) || ', '',''))';
  END IF;
  -- EMPLOYMENT TYPE, same closed-domain comma-list contract as work mode:
  -- validated elements only, inlined via quote_literal so no positional
  -- binding shifts and q_or's $16 stays $16.
  v_etypes := ARRAY(
    SELECT DISTINCT btrim(m)
    FROM unnest(string_to_array(coalesce(p_employment_type, ''), ',')) AS m
    WHERE btrim(m) IN ('full_time', 'part_time', 'contract', 'temporary', 'internship')
  );
  IF array_length(v_etypes, 1) IS NOT NULL THEN
    filters := filters || ' AND p.employment_type = ANY(string_to_array('
                       || quote_literal(array_to_string(v_etypes, ',')) || ', '',''))';
  END IF;

  -- AGENCY: a fixed predicate gated on a boolean, so there is no user text to
  -- inline and no positional binding to shift. Binding it here is what lets a
  -- request carrying the opt-out keep the ranked path instead of standing the
  -- RPC down (see the blind-set gate) — the trade the flag shipped with, now
  -- deleted.
  IF p_exclude_agencies THEN
    filters := filters || ' AND p.agency = false';
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
      || '  ORDER BY ts_rank_cd(ARRAY[0,0,0,1]::float4[], p.title_tsv, $1) DESC, CASE WHEN p.title_tsv @@ $1 THEN 0::float4 ELSE ts_rank_cd(ARRAY[0,0,0,1]::float4[], p.title_tsv, $16) END DESC, p.effective_posted DESC, p.id ASC'
      || '  LIMIT GREATEST(LEAST($13, 200), 1) OFFSET GREATEST($14, 0)'
      || ') SELECT ' || cols || '$12::bigint AS total_rows, $15::bigint AS related_rows, (p.title_tsv @@ $1) AS title_match, ' || snippet_sql || ' AS snippet '
      || 'FROM page JOIN public.job_board_postings p ON p.id = page.pid '
      || 'ORDER BY ts_rank_cd(ARRAY[0,0,0,1]::float4[], p.title_tsv, $1) DESC, CASE WHEN p.title_tsv @@ $1 THEN 0::float4 ELSE ts_rank_cd(ARRAY[0,0,0,1]::float4[], p.title_tsv, $16) END DESC, p.effective_posted DESC, p.id ASC'
      USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days, p_sources, total, p_limit, p_offset, related, q_or;
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

DROP FUNCTION IF EXISTS public.count_jobs_capped(timestamptz, text, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, text[], boolean, boolean, numeric, text, integer, text, text, boolean);
DROP FUNCTION IF EXISTS public.count_jobs_capped(timestamptz, text, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, text[], boolean, boolean, numeric, text, integer, text, text);
DROP FUNCTION IF EXISTS public.count_jobs_capped(timestamptz, text, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, text[], boolean, boolean, numeric, text, integer, text);
DROP FUNCTION IF EXISTS public.count_jobs_capped(timestamptz, text, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, text[], boolean, boolean);
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
  p_include_unstated boolean DEFAULT false,
  p_salary_ceiling numeric DEFAULT NULL,
  p_pay_basis text DEFAULT NULL,
  p_max_years integer DEFAULT NULL,
  p_department text DEFAULT NULL,
  p_employment_type text DEFAULT NULL,
  p_exclude_agencies boolean DEFAULT false
)
RETURNS TABLE (n bigint, capped boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_modes text[];
  v_etypes text[];
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
  IF p_pay_stated IS TRUE THEN filters := filters || ' AND p.salary IS NOT NULL'; END IF;
  IF p_companies IS NOT NULL THEN filters := filters || ' AND p.company_token = ANY($7)'; END IF;
  IF p_posted_after IS NOT NULL THEN filters := filters || ' AND p.posted_at > $8'; END IF;
  IF p_max_age_days IS NOT NULL THEN filters := filters || ' AND p.posted_at >= now() - make_interval(days => $9)'; END IF;
  IF p_sources IS NOT NULL THEN filters := filters || ' AND p.source = ANY($11)'; END IF;
  -- WORK MODE IS A LIST NOW, not a single literal. Elements are validated
  -- against the closed domain and anything else is dropped, so the value that
  -- reaches SQL can only ever be a subset of {remote,hybrid,onsite} — the same
  -- contract p_category already has in this function. A caller sending one mode
  -- gets a one-element list and byte-identical behaviour.
  -- THE FOUR PREVIOUSLY-BLIND FILTERS, inlined the way v_modes already is —
  -- numerics via ::text (no injection surface), the department via
  -- quote_literal — so every positional USING clause stays byte-identical.
  IF p_salary_ceiling IS NOT NULL THEN
    filters := filters || CASE WHEN p_include_unstated
      THEN ' AND (p.salary_rank_usd <= ' || p_salary_ceiling::text || ' OR p.salary_rank_usd IS NULL)'
      ELSE ' AND p.salary_rank_usd <= ' || p_salary_ceiling::text END;
  END IF;
  -- Closed domain, tested in plpgsql: no caller text ever reaches the SQL.
  IF p_pay_basis = 'hourly' THEN
    filters := filters || ' AND p.salary_period = ''hour''';
  ELSIF p_pay_basis = 'salaried' THEN
    filters := filters || ' AND p.salary_period IN (''year'', ''month'')';
  END IF;
  IF p_max_years IS NOT NULL THEN
    filters := filters || ' AND p.min_years <= ' || p_max_years::integer::text;
  END IF;
  IF p_department IS NOT NULL THEN
    filters := filters || ' AND p.department ILIKE ' || quote_literal('%' || p_department || '%');
  END IF;
  v_modes := ARRAY(
    SELECT DISTINCT btrim(m)
    FROM unnest(string_to_array(coalesce(p_work_mode, ''), ',')) AS m
    WHERE btrim(m) IN ('remote', 'hybrid', 'onsite')
  );
  IF array_length(v_modes, 1) IS NOT NULL THEN
    filters := filters || ' AND p.work_mode = ANY(string_to_array('
                       || quote_literal(array_to_string(v_modes, ',')) || ', '',''))';
  END IF;
  -- EMPLOYMENT TYPE, same closed-domain comma-list contract as work mode:
  -- validated elements only, inlined via quote_literal so no positional
  -- binding shifts and q_or's $16 stays $16.
  v_etypes := ARRAY(
    SELECT DISTINCT btrim(m)
    FROM unnest(string_to_array(coalesce(p_employment_type, ''), ',')) AS m
    WHERE btrim(m) IN ('full_time', 'part_time', 'contract', 'temporary', 'internship')
  );
  IF array_length(v_etypes, 1) IS NOT NULL THEN
    filters := filters || ' AND p.employment_type = ANY(string_to_array('
                       || quote_literal(array_to_string(v_etypes, ',')) || ', '',''))';
  END IF;
  IF p_q IS NOT NULL AND length(btrim(p_q)) > 0 THEN
    filters := filters || ' AND (p.title ILIKE ''%'' || $10 || ''%'' OR p.company ILIKE ''%'' || $10 || ''%'' OR p.department ILIKE ''%'' || $10 || ''%'')';
  END IF;

  -- AGENCY: a fixed predicate gated on a boolean, so there is no user text to
  -- inline and no positional binding to shift. Binding it here is what lets a
  -- request carrying the opt-out keep the ranked path instead of standing the
  -- RPC down (see the blind-set gate) — the trade the flag shipped with, now
  -- deleted.
  IF p_exclude_agencies THEN
    filters := filters || ' AND p.agency = false';
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

DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, text[], boolean, boolean, numeric, text, integer, text, text, boolean);
DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, text[], boolean, boolean, numeric, text, integer, text, text);
DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, text[], boolean, boolean, numeric, text, integer, text);
DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, text[], boolean, boolean);
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
,
  p_pay_stated boolean DEFAULT NULL,
  p_include_unstated boolean DEFAULT false,
  p_salary_ceiling numeric DEFAULT NULL,
  p_pay_basis text DEFAULT NULL,
  p_max_years integer DEFAULT NULL,
  p_department text DEFAULT NULL,
  p_employment_type text DEFAULT NULL,
  p_exclude_agencies boolean DEFAULT false
)
RETURNS TABLE (
  id text, source text, company_token text, company text, title text,
  location text, country text, remote boolean, work_mode text,
  employment_type text, department text, category text, posted_at timestamptz, apply_url text,
  salary text, salary_min_annual numeric, salary_max_annual numeric,
  salary_period text, salary_currency text, experience_band text,
  min_years integer, last_seen timestamptz, missing_since timestamptz,
  agency boolean,
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
      -- A '|'-JOINED ALIAS LIST MATCHED WHOLE CAN NEVER BE TRUE (20260829120000).
      -- The opt-out reaches the RESCUE tier too. Binding it only in
      -- search_jobs meant a searcher who asked to hide staffing agencies got
      -- a page of them the moment the exact tier came back empty and the
      -- fuzzy rescue took over — undisclosed, because these rows carried no
      -- agency column for the badge or the integrity sensor to read.
      AND (NOT p_exclude_agencies OR p.agency = false)
      AND (p_location IS NULL OR EXISTS (
            SELECT 1 FROM unnest(string_to_array(p_location, '|')) AS alias(x)
            WHERE p.location ILIKE '%' || alias.x || '%'))
      AND (p_remote IS NOT TRUE OR p.remote)
      AND (p_country IS NULL OR p.country = ANY(string_to_array(p_country, ',')))
      AND (p_category IS NULL OR p.category = ANY(string_to_array(p_category, ',')))
      AND (p_experience IS NULL OR p.experience_band = ANY(p_experience))
      AND (p_salary_floor IS NULL
           OR p.salary_rank_usd >= p_salary_floor
           OR (p_include_unstated AND p.salary_rank_usd IS NULL))
      AND (p_pay_stated IS NOT TRUE OR p.salary IS NOT NULL)
      AND (p_companies IS NULL OR p.company_token = ANY(p_companies))
      AND (p_posted_after IS NULL OR p.posted_at > p_posted_after)
      AND (p_max_age_days IS NULL OR p.posted_at >= now() - make_interval(days => p_max_age_days))
      AND (p_vendors IS NULL OR p.source = ANY(p_vendors))
      AND (p_salary_ceiling IS NULL
           OR p.salary_rank_usd <= p_salary_ceiling
           OR (p_include_unstated AND p.salary_rank_usd IS NULL))
      AND (p_pay_basis IS NULL
           OR (p_pay_basis = 'hourly' AND p.salary_period = 'hour')
           OR (p_pay_basis = 'salaried' AND p.salary_period IN ('year', 'month')))
      AND (p_max_years IS NULL OR p.min_years <= p_max_years)
      AND (p_department IS NULL OR p.department ILIKE '%' || p_department || '%')
      -- Multi-select, same as the two functions above. string_to_array on a
      -- single value yields a one-element array, so a caller that sends one
      -- mode is unaffected.
      AND (p_work_mode IS NULL OR p.work_mode = ANY(string_to_array(p_work_mode, ',')))
      AND (p_employment_type IS NULL OR p.employment_type = ANY(string_to_array(p_employment_type, ',')))
    ORDER BY similarity(p.title, p_q) DESC, p.effective_posted DESC
    LIMIT GREATEST(LEAST(p_limit, 60), 1)
  )
  SELECT m.id, m.source, m.company_token, m.company, m.title, m.location,
         m.country, m.remote, m.work_mode, m.employment_type, m.department, m.category,
         m.posted_at, m.apply_url, m.salary, m.salary_min_annual,
         m.salary_max_annual, m.salary_period, m.salary_currency,
         m.experience_band, m.min_years::integer, m.last_seen, m.missing_since,
         m.agency,
         (SELECT count(*) FROM m)::bigint AS total_rows
  FROM m
  ORDER BY m.sim DESC, m.effective_posted DESC;
$$;


-- GRANTS ARE DISCARDED BY DROP, SO THEY ARE RE-ISSUED HERE, FROM THE CATALOG.
--
-- Hand-listing signatures leaves behind whatever overload no migration file
-- records, and this database is known to hold some. The posture is unchanged:
-- revoked from the two anonymous roles and from the implicit one Postgres
-- grants to by default, executable only by the role the edge functions
-- authenticate as. A grant with no revoke is not a restriction.
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

NOTIFY pgrst, 'reload schema';
