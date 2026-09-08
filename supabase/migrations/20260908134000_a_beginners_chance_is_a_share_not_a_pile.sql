-- "WHERE A BEGINNER ACTUALLY HAS A CHANCE" WAS RANKED BY WHO POSTS THE MOST.
--
-- get_entry_level_companies gates on `entry >= 5` and orders by the raw
-- entry-role COUNT. Under that rule the answer to "where does a beginner have
-- a chance" is just "the biggest boards", because an employer with 12,000
-- postings accumulates 300 entry-level roles while running an 2.5% entry
-- share, and an employer with 120 postings of which 60 are entry-level -- half
-- the board, and the one a beginner should actually open -- cannot place.
-- Ranking by size under a question about odds is the same defect this schema
-- removed from the hiring leaderboard in 20260811233000 and from the re-list
-- section in the migration two stamps before this one.
--
-- SO THE RANKING KEY IS THE SHARE: entry_roles / open_roles.
--
-- AND THE FLOORS RISE WITH IT, WHICH IS NOT A DETAIL. A ratio under LIMIT 12
-- is exactly the shape that gave the transparency list twelve boards at 100%
-- of ~50 roles on 2026-08-11; the correction there was to rank by the count
-- instead, and it cannot be the correction here, because the count IS the
-- defect. The other half of that lesson applies instead: raise the floor until
-- a top-of-list share is a fact about a board a reader can use. entry_roles >=
-- 10 AND open_roles >= 50, up from entry_roles >= 5 with no board floor at
-- all, so the worst case at the top of the list is 10 entry roles out of 50
-- rather than 5 out of 5. Every card also prints its own two numbers, so the
-- reader sees the denominator that produced the ordering -- the condition
-- under which a rate ranking is safe on a card that makes no comparative claim
-- about conduct.
--
-- AND THE GROUPING KEY IS THE TOKEN ALONE, WHICH IS PART OF THE GATE.
-- This was GROUP BY company, company_token. company_token is the board; the
-- company column is the DISPLAY NAME the feed happened to state, and one board
-- carries several over time (the Workday name-override trigger rewrites it, and
-- a vendor renaming "Acme" to "ACME Inc" mid-window writes both). Grouping on
-- the pair splits one board into two rows and then applies entry_roles >= 10
-- AND open_roles >= 50 to each half: a 55-role board with 22 entry roles,
-- spelled two ways, clears neither. get_explore_denominators — which prints the
-- sentence under these twelve cards — groups by company_token alone, so it
-- would COUNT that employer in the pool while this ranking could never show it.
-- A denominator naming a population the numerator cannot be drawn from is the
-- defect 20260908134500 was written to close, and it survives in the GROUP BY
-- unless both are keyed the same way. max(company) supplies the display name,
-- exactly as get_transparent_employers already does. THE GROUPING KEY IS NOW
-- PART OF WHAT THE TWO FUNCTIONS PIN TOGETHER, alongside the two floors.
--
-- WHAT "ENTRY" MEANS, AND WHOSE WORD IT IS. experience_band is OURS, not the
-- employer's, and the surface must say so. It is set at ingestion by
-- job-board/experience.ts in two ways: where the posting TEXT states a years
-- requirement we take it (<= 2 years -> entry, and min_years carries the
-- stated number), and where it does not, we infer from TITLE KEYWORDS alone
-- (intern, trainee, apprentice, entry-level, junior, graduate, new grad, early
-- career). No employer publishes a field called "entry level" that we read.
-- A posting with neither signal is 'unspecified' and is counted in open_roles
-- but never in entry_roles, so the share is a floor in the classifier's own
-- direction: the roles we could not read are all in the denominator.
--
-- Unchanged: both serving predicates, the showcase exclusion, SECURITY
-- DEFINER (the corpus lockdown of 20260827130000 -- an INVOKER version returns
-- zero rows to anon instead of raising), the 20s budget, and the returned
-- columns. The return type is deliberately untouched: adding the
-- stated-versus-inferred split as a column would require dropping and
-- recreating the function, and that split is derivable from min_years whenever
-- someone wants to publish it as a number rather than as a sentence.

CREATE OR REPLACE FUNCTION public.get_entry_level_companies(p_limit int DEFAULT 25)
RETURNS TABLE (company text, company_token text, entry_roles int, open_roles int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout = '20s' AS $$
  SELECT max(company) AS company, company_token,
    (count(*) FILTER (WHERE experience_band = 'entry'))::int AS entry_roles, count(*)::int AS open_roles
  FROM public.job_board_postings
  WHERE company <> ''
    AND company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
    AND missing_since IS NULL
    AND effective_posted >= now() - interval '30 days'
  -- ONE GROUP PER BOARD, KEYED THE WAY EVERY OTHER RANKING ON THIS PAGE KEYS
  -- IT. See the header: grouping by (company, company_token) splits a board
  -- across its display-name spellings, and the floors are then applied to the
  -- halves while get_explore_denominators applies them to the whole.
  GROUP BY company_token
  HAVING count(*) FILTER (WHERE experience_band = 'entry') >= 10
     AND count(*) >= 50
  -- The share, then the count as the tie-break. NULLIF guards a denominator
  -- that the HAVING above already makes impossible -- belt and braces on a
  -- division, because a zero here would be an error where a ranking should
  -- simply be an ordering.
  ORDER BY (count(*) FILTER (WHERE experience_band = 'entry'))::numeric
             / NULLIF(count(*), 0) DESC,
           count(*) FILTER (WHERE experience_band = 'entry') DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

COMMENT ON FUNCTION public.get_entry_level_companies(int) IS
  'Employers ranked by the SHARE of their served roles we classify entry-level: '
  'entry_roles / open_roles DESC, with the raw entry count as tie-break. It was '
  'ranked by the raw count, which answered "who posts the most" rather than '
  '"where does a beginner have a chance" and made the answer a list of the '
  'largest boards. GATE: entry_roles >= 10 AND open_roles >= 50 (raised from '
  'entry_roles >= 5 with no board floor) -- a ratio under LIMIT 12 otherwise '
  'fills every slot with tiny boards at 100%, which is how the transparency '
  'list broke on 2026-08-11. GROUPING KEY: company_token ALONE, with max(company) '
  'as the display name. It was (company, company_token), which splits one board '
  'across the display-name spellings its feed has used and applies both floors to '
  'the halves; get_explore_denominators groups by the token alone, so the pair '
  'spelling let the sentence under these cards count an employer this ranking '
  'structurally cannot show. The grouping key is pinned across the two functions '
  'exactly like the floors are. POPULATION: served postings only -- missing_since '
  'IS NULL and effective_posted within 30 days, the two predicates the board '
  'itself applies -- with showcase_excluded removed, so the numbers match the '
  'page each card links to. DATE BASIS: a point-in-time count of what we serve '
  'right now; nothing here is a duration or a claim about what the employer has '
  'open. "ENTRY-LEVEL" IS OUR CLASSIFICATION, NOT THE EMPLOYER''S WORD, and any '
  'surface rendering these numbers must say so: job-board/experience.ts takes a '
  'years requirement from the posting TEXT where one is stated (<= 2 years '
  'entry, with the stated figure kept in min_years) and otherwise infers from '
  'TITLE KEYWORDS alone (intern, trainee, apprentice, entry-level, junior, '
  'graduate, new grad, early career). Postings with neither signal are '
  '''unspecified'': counted in open_roles, never in entry_roles, so the share '
  'understates rather than overstates. The stated-vs-inferred split is '
  'recoverable from min_years IS NOT NULL, and is not returned here.';

NOTIFY pgrst, 'reload schema';
