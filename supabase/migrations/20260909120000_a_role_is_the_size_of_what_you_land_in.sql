-- A FIELD TILE REACHES EVERYTHING AND LANDS YOU IN 130,000 ROWS.
--
-- Moving /explore's default to the field grid fixes the reach and leaves the
-- other half of the complaint untouched: "Engineering & IT, 187,402" is a
-- number, not a place to start. The role row is the fix for the SIZE of what
-- the click lands in -- six to ten priced role names under each field, biggest
-- first, each one a search a person would actually type.
--
-- THE VOCABULARY IS THE BOARD'S OWN TITLES, not a curated list. Three curated
-- vocabularies already sit in this repo unused -- src/data/roles.ts builds 216
-- slugs whose pages contain no /jobs link at all, search-alias.ts carries forty
-- acronyms, and scripts/role-vocab-gaps.ts ranks normalised titles by posting
-- count against the resume scanner. The third one is the right idea and this
-- function is its SQL: rank the board's own normalised titles by how many
-- postings carry them, per field. A curated list can name a role with zero
-- postings behind it; a derived one cannot.
--
-- THE KEY IS normalize_close_title PLUS A PUNCTUATION FOLD, AND IT IS NOT THE
-- CLOSURE KEY. 20260908130000 ported normalizeCloseTitle into SQL so that
-- "Staff Nurse (R-48213)" and "Staff Nurse [Req 10422]" stop being two roles;
-- that is exactly the grouping a role vocabulary needs and it is reused here
-- verbatim. This function then folds the remaining punctuation to spaces,
-- because a vocabulary entry has to survive being handed back to the search
-- engine and "medical assistant / phlebotomist" is not a query anyone types.
--   THAT FOLD MAKES THIS A DIFFERENT KEY FROM THE ONE job_board_closures IS
--   WRITTEN UNDER. Nothing here may be joined to a closure count, and no
--   events-per-title rate may be computed on it -- that would be a ratio of two
--   different definitions, which is the specific failure normalize_close_title's
--   own comment warns about.
-- Seniority is deliberately NOT stripped, following normalize_close_title's
-- rule that it never strips words: "senior software engineer" is a different
-- role to look for than "software engineer", and a reader choosing between
-- them is doing the thing this section exists to let them do.
--
-- HOW A ROW IS PRICED, AND WHY THE NUMBER IS A FLOOR. The row links to
-- /jobs?q=<role>. That search does not count the group -- it runs
-- `to_tsvector('simple', title) @@ websearch_to_tsquery('simple', q)` when the
-- router picks the title retriever, and widens to title+company+department
-- through search_jobs when it does not. So this function prices each row with
-- the NARROWEST of those, the exact title-simple predicate, over the exact
-- serving population, using the GIN index that already exists for it
-- (job_board_postings_title_simple_fts_idx). The published count is therefore
-- a FLOOR on what the click shows, never an overstatement, and it says so:
-- `basis` is 'title-simple' and the counts are named _at_least.
--
-- THREE REFUSALS, COUNTED RATHER THAN SILENT.
--   operator_word -- websearch_to_tsquery reads a bare "or" as the OR
--                    operator, so a role key containing one would be priced
--                    against a query WIDER than the phrase the row prints.
--                    (The other two operators cannot survive the fold: "-" and
--                    '"' are both stripped to spaces.)
--   empty_query   -- a key that lexes to nothing matches nothing; publishing a
--                    zero beside a group of 400 postings would be a number the
--                    query could not produce.
--   unreachable   -- priced count below the group it names. Every member of the
--                    group has these words in its title, so the search must
--                    reach at least the group; when it does not, the fold and
--                    the lexer disagree about this string (a "c++" shape) and
--                    the row is dropped rather than published with a price
--                    smaller than its own pile.
-- All three are returned as counts. A refusal nobody can see is a filter
-- pretending to be a measurement.
--
-- THE ROWS OVERLAP AND DO NOT SUM TO THE FIELD. "software engineer" reaches
-- every "senior software engineer" too, because both lexemes are present in
-- both titles. These are the biggest ways in, not a partition, and any caller
-- adding them up is asking a question this data cannot answer.
--
-- IT RUNS ON ITS OWN CRON, NOT INSIDE THE HOURLY EXPLORE REFRESH. A grouped
-- pass over every served title plus ~144 index probes is the most expensive
-- thing on this page, and a role vocabulary moves on the timescale of the
-- labour market, not of an hour. Six-hourly, its own meta key, its own budget;
-- refresh_explore_cache reads the finished row and republishes it with its
-- age attached, so the page still reads ONE key and can still tell how old
-- this block is independently of the rest.

CREATE OR REPLACE FUNCTION public.get_field_role_rows(
  p_per_field int DEFAULT 8,
  p_min_n     int DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
  WITH
  bounds AS (
    -- Both parameters clamped in the body rather than trusted: p_per_field
    -- above ten turns a scannable list into a second search results page, and
    -- a p_min_n under twenty admits titles whose "biggest role in the field"
    -- claim rests on a handful of postings.
    SELECT GREATEST(LEAST(p_per_field, 10), 1) AS per_field,
           GREATEST(p_min_n, 20)               AS min_n
  ),
  served AS (
    SELECT p.category, p.title
    FROM public.job_board_postings p
    WHERE p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
  ),
  keyed AS (
    SELECT s.category, k.role_key
    FROM served s
    CROSS JOIN LATERAL (
      -- normalize_close_title first (lowercase, drop bracketed req ids, fold
      -- unicode whitespace), THEN punctuation to spaces, THEN collapse. The
      -- surviving alphabet is letters, digits, space, & and + -- "r&d" and
      -- "c++" are real role words and are kept, while "-" and the double quote
      -- are removed precisely because websearch_to_tsquery reads them as
      -- operators.
      SELECT btrim(regexp_replace(
               regexp_replace(public.normalize_close_title(s.title), '[^a-z0-9&+ ]+', ' ', 'g'),
               '\s+', ' ', 'g')) AS role_key
    ) k
  ),
  grp AS (
    SELECT k.category, k.role_key, count(*)::int AS group_n
    FROM keyed k
    WHERE length(k.role_key) >= 3
    GROUP BY k.category, k.role_key
    HAVING count(*) >= (SELECT min_n FROM bounds)
  ),
  cand AS (
    SELECT g.*,
           (g.role_key ~ '(^| )or( |$)')                            AS has_operator,
           (websearch_to_tsquery('simple', g.role_key)::text = '')  AS empty_query
    FROM grp g
  ),
  ranked AS (
    SELECT c.*,
           row_number() OVER (PARTITION BY c.category
                              ORDER BY c.group_n DESC, c.role_key ASC) AS rn
    FROM cand c
    WHERE NOT c.has_operator AND NOT c.empty_query
  ),
  picked AS (SELECT r.* FROM ranked r WHERE r.rn <= (SELECT per_field FROM bounds)),
  priced AS (
    SELECT r.category, r.role_key, r.group_n, px.n_board, px.n_field
    FROM picked r
    LEFT JOIN LATERAL (
      -- THE SEARCH'S OWN PREDICATE, over the serving population, index-served
      -- by job_board_postings_title_simple_fts_idx. n_field is the same count
      -- narrowed to the field the row sits under, so a caller can price either
      -- /jobs?q=<role> or /jobs?q=<role>&category=<field> without asking twice.
      SELECT count(*)::int AS n_board,
             count(*) FILTER (WHERE p.category = r.category)::int AS n_field
      FROM public.job_board_postings p
      WHERE p.missing_since IS NULL
        AND p.effective_posted >= now() - interval '30 days'
        AND to_tsvector('simple', p.title) @@ websearch_to_tsquery('simple', r.role_key)
    ) px ON TRUE
  ),
  kept AS (
    SELECT * FROM priced
    WHERE n_board IS NOT NULL AND n_board >= group_n
  )
  SELECT jsonb_build_object(
    'at',           now(),
    'window_days',  30,
    'per_field',    (SELECT per_field FROM bounds),
    'min_group_n',  (SELECT min_n FROM bounds),
    -- basis: the predicate the counts were taken under, so a caller can word
    -- the sentence correctly and a later reader can tell what changed if it
    -- ever moves. 'title-simple' = to_tsvector('simple', title) @@
    -- websearch_to_tsquery('simple', role), over the served population.
    'basis',        'title-simple',
    -- REFUSALS, VISIBLE. Zero here means nothing was dropped; a rising
    -- `unreachable` means the punctuation fold and the lexer are drifting
    -- apart and this whole section needs re-deriving.
    'refused', jsonb_build_object(
      'operator_word', (SELECT count(*)::int FROM cand WHERE has_operator),
      'empty_query',   (SELECT count(*)::int FROM cand WHERE empty_query),
      'unreachable',   (SELECT count(*)::int FROM priced
                        WHERE n_board IS NULL OR n_board < group_n)
    ),
    'vocab_n',      (SELECT count(*)::int FROM cand),
    'rows_n',       (SELECT count(*)::int FROM kept),
    'fields', (
      SELECT COALESCE(jsonb_object_agg(f.category, f.rows), '{}'::jsonb)
      FROM (
        SELECT k.category,
               jsonb_agg(jsonb_build_object(
                 -- role: the query string itself. What the row prints IS what
                 -- /jobs?q= receives -- one string, so the label cannot come to
                 -- describe a different search than the link runs.
                 'role',              k.role_key,
                 -- group_n: served postings whose NORMALISED TITLE is exactly
                 -- this. The evidence the phrase is a real role here.
                 'group_n',           k.group_n,
                 -- n_at_least: served postings the title-simple search reaches
                 -- board-wide. A FLOOR on what /jobs?q=<role> shows, because
                 -- that search may also widen into company and department.
                 'n_at_least',        k.n_board,
                 -- n_field_at_least: the same, narrowed to this field.
                 'n_field_at_least',  k.n_field
               ) ORDER BY k.n_board DESC, k.role_key ASC) AS rows
        FROM kept k
        GROUP BY k.category
      ) f
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_field_role_rows(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_field_role_rows(int, int) TO service_role;

COMMENT ON FUNCTION public.get_field_role_rows(int, int) IS
  'Six-to-ten priced role rows per field, derived from the board''s OWN titles. '
  'POPULATION: what the board serves -- missing_since IS NULL AND '
  'effective_posted within 30 days. A SERVING surface: no showcase_excluded, '
  'because every row is a link and its number must match the page it opens. '
  'DATE BASIS: point-in-time at `at`, over window_days. '
  'KEY: public.normalize_close_title (20260908130000) followed by a punctuation '
  'fold to the alphabet [a-z0-9&+ ] and a whitespace collapse. THAT FOLD MAKES '
  'THIS A DIFFERENT KEY FROM THE ONE job_board_closures IS WRITTEN UNDER -- '
  'nothing here may be joined to a closure count and no events-per-title rate '
  'may be computed on it, or the ratio has a different definition top and '
  'bottom. Seniority is never stripped, following that function''s own rule. '
  'PRICING: n_at_least and n_field_at_least are counted with the search''s own '
  'narrowest predicate, to_tsvector(''simple'', title) @@ '
  'websearch_to_tsquery(''simple'', role), index-served by '
  'job_board_postings_title_simple_fts_idx. /jobs?q= runs exactly this when the '
  'router picks the title retriever and something WIDER (title, company and '
  'department, through search_jobs) when it does not -- so these are FLOORS on '
  'what the click shows, never overstatements, and are named _at_least for it. '
  '`basis` publishes the predicate so the wording can follow it if it moves. '
  'THE ROWS OVERLAP AND DO NOT SUM TO THE FIELD: "software engineer" reaches '
  'every "senior software engineer" as well. They are the biggest ways in, not '
  'a partition. THREE REFUSALS ARE COUNTED IN `refused` rather than applied '
  'silently: operator_word (a bare "or" would be read by websearch_to_tsquery '
  'as the OR operator and price a wider query than the row prints), empty_query '
  '(a key that lexes to nothing), and unreachable (a priced count below the '
  'group it names, which means the fold and the lexer disagree about that '
  'string -- publishing it would be publishing a number smaller than the pile '
  'it describes). p_per_field is clamped to 10 and p_min_n floored at 20. '
  'Cron-only, and NOT called from refresh_explore_cache: a grouped pass over '
  'every served title plus one index probe per row is the most expensive query '
  'on this page and a role vocabulary does not move hourly. Its writer is '
  'refresh_explore_role_rows().';


-- THE WRITER. Same wrapped shape as refresh_explore_cache: BOTH arms on every
-- handler (WHEN OTHERS does NOT catch QUERY_CANCELED, which is exactly what a
-- statement_timeout raises), previous value carried forward rather than
-- zeroed, and the write is unconditional so a failed hour degrades one block
-- instead of deleting the section.
CREATE OR REPLACE FUNCTION public.refresh_explore_role_rows()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
SET statement_timeout = '10min'
AS $$
DECLARE
  prev jsonb := '{}'::jsonb;
  rows_v jsonb := '{}'::jsonb;
  status_v text := 'ok';
BEGIN
  SELECT COALESCE(v, '{}'::jsonb) INTO prev
    FROM public.job_board_meta WHERE k = 'explore_role_rows';

  BEGIN
    rows_v := COALESCE(public.get_field_role_rows(8, 50), '{}'::jsonb);
    -- A SHAPE CHECK, NOT A TRUTH CHECK. The scalar form means a bad call shape
    -- returns a one-row table wrapped in an object rather than raising, and
    -- the reader's Array/object gates would pass on it -- the trap
    -- get_transparent_employers shipped for weeks behind a timeout.
    IF jsonb_typeof(rows_v -> 'fields') <> 'object' THEN
      status_v := 'failed: expected fields object, got ' ||
                  COALESCE(jsonb_typeof(rows_v -> 'fields'), 'null');
      rows_v := COALESCE(prev - 'status', '{}'::jsonb);
    END IF;
  EXCEPTION
    -- CARRY FORWARD AND SAY SO. The previous vocabulary is six hours old at
    -- worst and still true; an empty object would blank every role row under
    -- every field with nothing on screen explaining it.
    WHEN QUERY_CANCELED THEN
    rows_v := COALESCE(prev - 'status', '{}'::jsonb);
    status_v := 'failed: ' || left(SQLERRM, 120);
    RAISE WARNING 'explore role rows: unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
    rows_v := COALESCE(prev - 'status', '{}'::jsonb);
    status_v := 'failed: ' || left(SQLERRM, 120);
    RAISE WARNING 'explore role rows: unavailable (%)', SQLERRM;
  END;

  -- `status` rides INSIDE the payload and is stripped before any carry-forward,
  -- so a carried value never inherits the status of the run that carried it.
  -- `at` inside rows_v is the age of the DATA, not of this run -- the two
  -- differ by exactly one failed cycle and the page needs the former.
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('explore_role_rows', rows_v || jsonb_build_object('status', status_v), now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_explore_role_rows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_explore_role_rows() TO service_role;

COMMENT ON FUNCTION public.refresh_explore_role_rows() IS
  'Six-hourly writer for the explore_role_rows meta key. Separate from '
  'refresh_explore_cache on purpose: this is the most expensive query on the '
  'Explore page and a role vocabulary does not move hourly, so putting it in '
  'the hourly budget would buy nothing and risk the eight collections that '
  'already work. The payload carries its OWN `at` (the age of the data, which '
  'survives a failed cycle) and `status`; refresh_explore_cache republishes '
  'both inside its own payload so the page reads one key and can still see how '
  'old this block is on its own. Degrades exactly like its sibling: both '
  'handler arms, previous value carried forward with `status` stripped first so '
  'a carried payload cannot inherit the status of the run that carried it, and '
  'an unconditional write.';

-- Six-hourly at minute 22, clear of the explore refresh at minute 7 and of the
-- board refresh's 4-59/10.
--
-- The cron reference is NESTED and reached through EXECUTE, not written as a
-- second conjunct beside the namespace test. PL/pgSQL plans a whole IF
-- expression at once, so the sibling form
--   IF EXISTS (... nspname = 'cron') AND NOT EXISTS (SELECT 1 FROM cron.job ...)
-- raises "relation cron.job does not exist" on any database without pg_cron
-- INSTEAD of skipping -- the namespace guard in front of it never gets to run.
-- Measured here on a bare Postgres. The existing sibling schedulers in this
-- repo carry that shape; this one does not, so the migration applies anywhere.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    EXECUTE $q$
      SELECT cron.schedule('refresh-explore-role-rows', '22 */6 * * *',
                           'SELECT public.refresh_explore_role_rows();')
      WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-explore-role-rows')
    $q$;
  ELSE
    RAISE NOTICE 'pg_cron absent: refresh-explore-role-rows not scheduled';
  END IF;
END $$;

-- Populate once so the section is not empty until the first tick. Bounded and
-- guarded with BOTH arms: the sibling this pattern was copied from catches only
-- WHEN OTHERS, which does not catch the QUERY_CANCELED a statement_timeout
-- raises -- so a slow one-time compute there would fail the migration, which is
-- the one thing this block exists to prevent.
DO $$
BEGIN
  SET LOCAL statement_timeout = '60s';
  PERFORM public.refresh_explore_role_rows();
EXCEPTION
  WHEN QUERY_CANCELED THEN
    RAISE NOTICE 'explore role rows: initial populate timed out; the cron will fill it';
  WHEN OTHERS THEN
    RAISE NOTICE 'explore role rows: initial populate failed (%); the cron will fill it', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
