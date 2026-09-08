-- THE ENTRY DENOMINATOR WAS COUNTING A POOL THE LEADERBOARD NO LONGER DRAWS
-- FROM.
--
-- 20260908134000 raised the entry-level ranking's gate from `entry_roles >= 5`
-- to `entry_roles >= 10 AND open_roles >= 50`, because a share ranked under
-- LIMIT 12 fills with tiny boards otherwise. get_explore_denominators computes
-- the sentence under those twelve cards -- "the 12 with the highest share of
-- N employers" -- and its entry_n was built from the OLD gate:
--
--     'entry_n', (SELECT NULLIF(count(*), 0)::int FROM co WHERE entry_n >= 5)
--
-- Leaving that alone would state a denominator drawn from a population the
-- numerator is not a subset of: twelve cards selected out of one pool,
-- described as twelve out of a larger, different one. This page has shipped
-- that shape before ("the 12 best of 0 employers" when a scan died), and it is
-- the reason this function exists at all -- a leaderboard without its
-- denominator is a claim about the population dressed as a list, and a
-- leaderboard with the WRONG denominator is that claim with a number attached.
--
-- The two predicates are duplicated across two functions, which is a drift
-- risk this file cannot remove without merging the two scans; what it can do
-- is say so. IF THE RANKING'S HAVING CHANGES, THIS LINE CHANGES IN THE SAME
-- COMMIT. Nothing else in the function is touched: fields, employers_n, the
-- pay pair and the board counts are byte-for-byte 20260812130736, including
-- the >=20-roles-ALONE construction of pay_pool_n that guards pin, and
-- including the two-populations split (serving predicates only for the field
-- chips and board totals; company exclusions as well for the collection
-- pools).

CREATE OR REPLACE FUNCTION public.get_explore_denominators()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '3min'
AS $$
  WITH co AS (
    SELECT company_token,
           count(*)::int AS total,
           count(*) FILTER (WHERE salary IS NOT NULL)::int AS pay_n,
           count(*) FILTER (WHERE experience_band = 'entry')::int AS entry_n
    FROM public.job_board_postings
    WHERE company <> ''
      AND company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
      AND missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
    GROUP BY company_token
  ),
  fld AS (
    SELECT category, count(*)::int AS n
    FROM public.job_board_postings
    WHERE missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
      AND category IS NOT NULL
    GROUP BY category
  ),
  board AS (
    SELECT count(*)::int AS postings_n,
           count(*) FILTER (WHERE salary IS NOT NULL)::int AS postings_pay_n
    FROM public.job_board_postings
    WHERE missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
  )
  -- strip_nulls + NULLIF(_, 0): a zero denominator is either a broken scan or a
  -- meaningless sentence ("12 of 0"), and in both cases the honest render is no
  -- sentence at all. The frontend gates on key presence, so a stripped key
  -- degrades to silence rather than to a zero.
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'fields',         (SELECT COALESCE(jsonb_object_agg(category, n), '{}'::jsonb)
                       FROM fld WHERE n >= 50),
    'employers_n',    (SELECT NULLIF(count(*), 0)::int FROM co),
    -- BOTH halves of the ranking's gate, in the ranking's spelling, over the
    -- ranking's own grouping key: `co` groups by company_token alone, and
    -- 20260908134000 moved get_entry_level_companies onto that same key in the
    -- same commit. This is the pool the twelve entry-level cards are chosen
    -- from and nothing else.
    'entry_n',        (SELECT NULLIF(count(*), 0)::int FROM co
                       WHERE entry_n >= 10 AND total >= 50),
    -- THE GATE ITSELF, SO THE PAGE CAN TELL WHICH ONE PRODUCED entry_n.
    -- entry_n exists under BOTH definitions -- the deployed `entry_n >= 5` with
    -- no board floor, and the pair above -- so key presence cannot distinguish
    -- them, and the frontend deploys before migrations apply. Every other new
    -- quantity on this page degrades to SILENCE when its migration has not
    -- landed, because its key is new; without these two, entry_n would degrade
    -- to a WRONG NUMBER underneath a sentence naming floors it was not counted
    -- under. Deliberately not NULLIF'd: their presence IS the shape marker.
    'entry_min_entry', 10,
    'entry_min_open',  50,
    -- The pay pair CANNOT be read off get_transparent_employers' agg CTE: its
    -- HAVING combines >=20 roles AND >=80% stated, so counting rows there gives
    -- the numerator twice and a median around 90% rather than the board's real
    -- rate. The denominator has to be built from the >=20 condition ALONE.
    'pay_pool_n',     (SELECT NULLIF(count(*), 0)::int FROM co WHERE total >= 20),
    'pay_n',          (SELECT NULLIF(count(*), 0)::int FROM co
                       WHERE total >= 20 AND 100.0 * pay_n / GREATEST(total, 1) >= 80),
    'postings_n',     (SELECT NULLIF(postings_n, 0) FROM board),
    'postings_pay_n', (SELECT NULLIF(postings_pay_n, 0) FROM board)
  ));
$$;

REVOKE ALL ON FUNCTION public.get_explore_denominators() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_explore_denominators() TO service_role;

COMMENT ON FUNCTION public.get_explore_denominators() IS
  'Pool sizes behind each Explore collection, plus per-field served counts. '
  'fields/board apply ONLY the two serving predicates the job-board function '
  'applies (missing_since IS NULL, effective_posted within 30 days) so a field '
  'chip''s number matches the page it opens; `co` additionally excludes '
  'showcase_excluded and blank companies because that is the pool the cards '
  'were drawn from. pay_pool_n counts the >=20-roles condition ALONE — reading '
  'it off get_transparent_employers would apply the 80% gate to the '
  'denominator too. entry_n MIRRORS get_entry_level_companies'' OWN GATE '
  '(entry_roles >= 10 AND open_roles >= 50, raised 2026-09-08 when that '
  'leaderboard moved from ranking by count to ranking by share) AND ITS '
  'GROUPING KEY (company_token alone, which that function was moved onto in the '
  'same commit); the predicates and the GROUP BY live in two functions and must '
  'be changed in one commit, or the sentence under the twelve cards describes a '
  'population they were not chosen from. entry_min_entry and entry_min_open '
  'publish that gate as data: entry_n exists under the old five-role definition '
  'too, so a page that shipped ahead of this migration cannot tell the two apart '
  'by key presence and would print the old pool beneath the new floors'' '
  'wording. They carry no NULLIF -- their presence is the shape marker, and a '
  'caller must render the pool sentence only when they match the floors it is '
  'about to name. '
  'DATE BASIS: every count here is point-in-time, of what the board '
  'serves at the moment of the scan. Cron-only.';

NOTIFY pgrst, 'reload schema';
