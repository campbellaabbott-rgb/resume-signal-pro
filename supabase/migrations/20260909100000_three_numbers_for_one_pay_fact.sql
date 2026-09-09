-- THREE NUMBERS FOR ONE FACT, AND ALL THREE WERE ON SCREEN.
--
-- "How much of this board states pay" is published in three places, and until
-- this migration a reader could collect all three in one session:
--
--   20.1%   supabase/functions/job-board/index.ts, MEASURED_COVERAGE.hasStatedPay
--           (112,524 of 559,805, dated 2026-08-25)
--   12.9%   the same file's coverageDisclosure header and the refresh pass's
--           own comment, "MEASURED against 599,316 open postings: salary is
--           stated on 12.9%"
--   ~4%     src/pages/Jobs.tsx, in the disclosure-aware-filtering note:
--           "only ~4% of postings state salary at all; work mode ~8%"
--
-- This is the claim-drift shape this repo has already paid for once. It is
-- also, in two of the three cases, NOT a contradiction -- which is worse,
-- because nothing on the page said so.
--
-- THE RECONCILIATION. There are three pay columns, and they nest:
--
--   salary             the raw text the employer put in a pay field. Anything
--                      at all: "competitive", "DOE", "$22/hr". This is the
--                      column get_explore_denominators and
--                      get_transparent_employers count, and it is the widest.
--   salary_min_annual  a FIGURE we parsed out of that text and annualised.
--                      Strictly narrower: "competitive" leaves this NULL.
--                      This is the column the hasStatedPay filter binds
--                      (`q.not("salary_min_annual", "is", null)`), so 20.1%
--                      is the right number for the question "does this
--                      posting state a figure at all".
--   salary_rank_usd    that figure PLUS a currency we could identify, so it
--                      can be compared against a floor. Strictly narrower
--                      again. This is the column the pay-FLOOR filter binds
--                      (`q.gte("salary_rank_usd", ...)`), so 12.9% is the
--                      right number for the question "can a pay floor see
--                      this posting".
--
-- So 20.1% and 12.9% are BOTH RIGHT, for different populations, and index.ts
-- already knew it -- the comment at the hasStatedPay binding says so in words:
-- "20.1% of the board states a figure, and fewer than that state one we can
-- convert". What was missing is that the two numbers never cited each other,
-- so each read as a total.
--
--   A PAY-FLOOR CHIP MUST QUOTE salaryFloor, NEVER hasStatedPay. Quoting 20.1%
--   beside a control bound to salary_rank_usd overstates that control's reach
--   by 56%. That is the whole operative consequence of this file.
--
-- THE THIRD NUMBER IS SIMPLY WRONG. "~4%" carries no date, no population and
-- no column, and it is refuted by every live scan since 2026-08-27: the
-- narrowest of the three columns runs about 12.9%, three times that figure.
-- Its companion "work mode ~8%" is refuted the same way (live: ~29.9%). Both
-- are undated estimates from before this function existed, and the correct
-- repair is to delete them and read `coverage` -- which that same component
-- already receives. THIS FILE CANNOT DELETE THEM: they are TypeScript, and
-- this is a migration. It publishes the figures they must cite instead.
--
-- WHAT CHANGES IN SQL. get_filter_coverage gains the widest of the three
-- columns (`salaryText`), the date basis a posted-this-week chip needs
-- (`dated`), and its own provenance (`at`, `window_days`). It gains no scan:
-- these are FILTER aggregates on the pass that was already running, and the
-- nine existing keys are byte-for-byte 20260828122000.
--
-- IT ALSO CHECKS ITS OWN STORY. The paragraph above claims a nesting --
-- salary >= salary_min_annual >= salary_rank_usd -- and a claim a function
-- makes about its own columns should be a claim that function tests.
-- `nesting_holds` is that test, published as data rather than raised as an
-- error: this runs inside an hourly cron, and a cron that dies on a surprise
-- publishes nothing at all, which is strictly worse than publishing the
-- surprise. A false value means the parse pipeline has a path that writes a
-- figure with no raw text behind it, and the three-column story above is
-- wrong somewhere.

CREATE OR REPLACE FUNCTION public.get_filter_coverage()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '45s'
AS $$
  SELECT jsonb_build_object(
    -- THE DENOMINATOR FOR EVERY FRACTION BELOW: postings the board will
    -- actually serve, which is the two predicates buildQuery applies --
    -- present on the feed, and inside the 30-day freshness window. Counting a
    -- numerator over one population and dividing by another is the defect the
    -- caller's own comment records (published fractions ran 1.5-3% high).
    'open',           count(*),
    -- THE PAY-FLOOR POPULATION. salary_rank_usd is a parsed figure in a
    -- currency we identified, and it is the ONLY column a pay floor or ceiling
    -- can compare against. A chip that offers "$80k+" must quote this
    -- fraction; quoting hasStatedPay overstates the control's reach.
    'salaryFloor',    count(*) FILTER (WHERE salary_rank_usd IS NOT NULL),
    -- Work mode as the employer or vendor STATED it. NULL is "did not say",
    -- never "onsite" -- so an onsite chip is bounded by this and a remote chip
    -- (bound to the always-populated `remote` boolean) is not.
    'workMode',       count(*) FILTER (WHERE work_mode IS NOT NULL),
    -- 'unspecified' is a stated value meaning nothing was stated, so it is
    -- excluded here exactly as the band filter excludes it.
    'experience',     count(*) FILTER (WHERE experience_band IS NOT NULL AND experience_band <> 'unspecified'),
    'country',        count(*) FILTER (WHERE country IS NOT NULL),
    'payBasis',       count(*) FILTER (WHERE salary_period IS NOT NULL),
    -- "STATES A FIGURE." salary_min_annual is the parsed annualised number,
    -- which is what the hasStatedPay filter binds. Wider than salaryFloor
    -- (a figure in a currency we could not identify lands here and not there)
    -- and narrower than salaryText (an unparseable "competitive" lands there
    -- and not here).
    'hasStatedPay',   count(*) FILTER (WHERE salary_min_annual IS NOT NULL),
    'maxYears',       count(*) FILTER (WHERE min_years IS NOT NULL),
    'department',     count(*) FILTER (WHERE department IS NOT NULL),
    'employmentType', count(*) FILTER (WHERE employment_type IS NOT NULL),
    -- NEW. "THE EMPLOYER PUT SOMETHING IN A PAY FIELD", parsed or not. This is
    -- the widest of the three pay columns and the one the employer-transparency
    -- surfaces count (get_explore_denominators' pay_n/postings_pay_n,
    -- get_transparent_employers' 80% gate). It is published here so those
    -- surfaces and the filter disclosures can be read against each other
    -- instead of being three unrelated percentages on one site. NO FILTER
    -- BINDS THIS COLUMN -- it is a transparency statistic, not a control's
    -- reach, and must never be quoted beside a pay control.
    'salaryText',     count(*) FILTER (WHERE salary IS NOT NULL),
    -- NEW. THE POSTED-THIS-WEEK POPULATION. maxAgeDays and postedAfter bind
    -- posted_at -- the EMPLOYER'S stated date -- never effective_posted, which
    -- coalesces our own last_seen and would answer "we found this recently".
    -- An undated posting can therefore never match a freshness chip, however
    -- new it is, and a chip that does not publish this fraction is silently
    -- hiding every posting whose age nobody knows.
    'dated',          count(*) FILTER (WHERE posted_at IS NOT NULL),
    -- NEW. THE FUNCTION TESTING ITS OWN STORY. The three pay columns are
    -- documented as nesting; if they stop nesting, the documentation is wrong
    -- and every sentence built on it is wrong with it. Published, not raised:
    -- an hourly cron that dies on a surprise publishes nothing.
    'nesting_holds',
      count(*) FILTER (WHERE salary IS NOT NULL)
        >= count(*) FILTER (WHERE salary_min_annual IS NOT NULL)
      AND count(*) FILTER (WHERE salary_min_annual IS NOT NULL)
        >= count(*) FILTER (WHERE salary_rank_usd IS NOT NULL),
    -- NEW. PROVENANCE. A coverage figure with no date is what turns a
    -- measurement into a claim -- the exact failure that let "~4%" survive in
    -- a comment for months after it stopped being true.
    'at',             now(),
    'window_days',    30
  )
  FROM public.job_board_postings
  WHERE missing_since IS NULL
    AND effective_posted >= now() - interval '30 days';
$$;

-- A public exact scan of the whole table is a free load test. Unchanged.
REVOKE ALL ON FUNCTION public.get_filter_coverage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_filter_coverage() TO service_role;

COMMENT ON FUNCTION public.get_filter_coverage() IS
  'How much of the board each NULL-discarding filter can see, all figures from '
  'ONE scan. POPULATION: postings the board will serve -- missing_since IS NULL '
  'AND effective_posted within 30 days -- which is buildQuery''s own pair, so '
  'every numerator and the denominator describe the same board. WINDOW: 30 '
  'days, published as window_days. DATE BASIS: point-in-time at `at`; these are '
  'a snapshot and a snapshot with no date is a claim. '
  'THE THREE PAY COLUMNS NEST, AND EACH ANSWERS A DIFFERENT QUESTION. '
  'salaryText counts `salary IS NOT NULL` -- the employer wrote something in a '
  'pay field, parseable or not ("competitive" counts). It is a TRANSPARENCY '
  'statistic and no filter binds it; it is what get_explore_denominators and '
  'get_transparent_employers count. hasStatedPay counts `salary_min_annual IS '
  'NOT NULL` -- we parsed an annualised FIGURE out of that text -- and is what '
  'the states-pay filter binds. salaryFloor counts `salary_rank_usd IS NOT '
  'NULL` -- that figure in a currency we could identify -- and is what a pay '
  'FLOOR or CEILING binds, because a comparison needs a currency. '
  'A PAY-FLOOR CONTROL MUST QUOTE salaryFloor. Quoting hasStatedPay beside it '
  'overstates its reach by about half again, and quoting salaryText beside it '
  'overstates it further. This is why the same board has been published as '
  'stating pay on 20.1% (index.ts MEASURED_COVERAGE.hasStatedPay, 2026-08-25) '
  'and on 12.9% (the refresh pass''s salaryFloor comment) with neither number '
  'wrong: they count different columns for different controls. The third '
  'published figure, "~4%" in Jobs.tsx''s disclosure-filtering note, carries no '
  'date, no population and no column and is REFUTED by every scan since '
  '2026-08-27 -- as is its companion "work mode ~8%" against a live ~29.9%. '
  'Those two are estimates from before this function existed; the component '
  'already receives `coverage` and must read it instead of restating them. '
  'nesting_holds is this function checking the paragraph above against its own '
  'data (salaryText >= hasStatedPay >= salaryFloor). It is DATA, not an '
  'exception: this runs inside an hourly cron and a cron that dies on a '
  'surprise publishes nothing at all. A false value means a figure was written '
  'with no raw pay text behind it and the nesting story needs re-deriving. '
  'dated counts posted_at IS NOT NULL, the population a freshness chip can '
  'reach: maxAgeDays and postedAfter bind posted_at -- the EMPLOYER''S stated '
  'date -- and never effective_posted, which coalesces our own last_seen. An '
  'undated posting can never match a freshness filter however new it is. '
  'The nine original keys are byte-for-byte 20260828122000; salaryText, dated, '
  'nesting_holds, at and window_days are added on the SAME scan, at no extra '
  'pass. Cron and refresh-pass only -- anon holds no EXECUTE, because an exact '
  'count over the whole corpus is a load test anyone could run.';

NOTIFY pgrst, 'reload schema';
