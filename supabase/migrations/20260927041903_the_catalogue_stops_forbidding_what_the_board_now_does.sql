-- THE DATABASE'S OWN DESCRIPTION OF THIS FUNCTION FORBADE WHAT THE BOARD NOW DOES.
--
-- 20260909100000 is the live definition of get_filter_coverage, and both its
-- in-body note and its COMMENT ON FUNCTION say of the verbatim-pay-field count
-- that no filter binds that column, that it is a transparency statistic rather
-- than a control's reach, and that it must never be quoted beside a pay control.
-- They also say the annualised count is what the states-pay filter binds.
--
-- On 2026-09-27 the states-pay filter moved onto the verbatim pay field in all
-- four runtimes that answer it (20260927034117 for the three SQL functions, the
-- edge bundle for the browse), the states-pay disclosure started quoting that
-- column's share, and /explore's states-pay chip moved its denominator onto the
-- matching per-field count. So the two sentences above became false, and the
-- second of them forbids, in the catalogue, the behaviour that is shipping.
--
-- THE CATALOGUE IS THE AUTHORITY THIS PROJECT SAYS TO TRUST OVER MIGRATION
-- FILES, which is exactly why a stale COMMENT here is worse than a stale comment
-- in source: the next author reads it out of the live database and believes it.
-- A function's description going false while its body stays right is the
-- claim-drift shape one runtime over, and the repair is the same one the source
-- got — re-issue the description with the behaviour it now describes.
--
-- THE BODY IS UNCHANGED EXCEPT FOR ONE ADDED KEY, and that key exists because a
-- guard was resting on the wrong number. The widened predicate is a SUPERSET of
-- the retired one only while every annualised figure has the employer's text
-- behind it, and the only published check was the three-column nesting, which is
-- a comparison of COUNTS: 5,000 rows with an annual figure and no text, beside
-- 207,000 rows with text, keeps that nesting true while the widened predicate
-- silently drops those 5,000 stated-pay rows. Per-row nesting implies the count
-- nesting; the converse does not hold, so the count check cannot detect the
-- failure the widening would suffer. This publishes the per-row question
-- directly — rows carrying an annualised figure with NO employer text behind
-- them — which is zero if and only if the invariant holds. Measured zero on
-- every walk taken for that change: 4,030 rows over two complete country strata,
-- 18,000 rows over six vendor and country slices, and 12,000 rows over the two
-- vendors with structured pay fields (2026-09-27, latest walk 03:30:38Z).
-- Published as DATA, never raised: this runs inside an hourly cron, and a cron
-- that dies on a surprise publishes nothing at all.
--
-- nesting_holds STAYS. It is a cheap sanity check over the same scan and the
-- three-column story above still rests on it; what changes is that nothing
-- describes it as proof of a per-row property any more.
--
-- EVERY NUMERATOR AND THE DENOMINATOR ARE BYTE-FOR-BYTE THE LIVE ONES. The
-- population pair, the window, the 'unspecified' exclusion, the statement
-- timeout, the volatility and the definer posture are carried across unchanged,
-- so the only observable differences are one added key and a corrected
-- description. The nine original keys trace to 20260828122000 through
-- 20260909100000 and are unchanged again here.

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
    -- currency we identified, and it is the ONLY column a pay floor, a pay
    -- ceiling or the pay ORDER can compare against. A chip that offers "$80k+"
    -- must quote this fraction; quoting either wider pay figure beside it
    -- overstates the control's reach.
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
    -- "WE PARSED AN ANNUALISED FIGURE." The middle of the three pay columns.
    -- Until 2026-09-27 this was what the states-pay filter bound, and this key
    -- keeps its name for the bundles that still read it; from that date NO
    -- FILTER BINDS IT. It is now the click rollup's disclosure question ("did we
    -- hold a comparable yearly amount for the row a searcher clicked") and the
    -- honest denominator for a statement about our own parse rate. Wider than
    -- salaryFloor: a figure in a currency the rate table cannot convert lands
    -- here and not there -- 42 rows apart board-wide, 2026-09-27T02:07:00Z.
    'hasStatedPay',   count(*) FILTER (WHERE salary_min_annual IS NOT NULL),
    'maxYears',       count(*) FILTER (WHERE min_years IS NOT NULL),
    'department',     count(*) FILTER (WHERE department IS NOT NULL),
    'employmentType', count(*) FILTER (WHERE employment_type IS NOT NULL),
    -- "THE EMPLOYER PUT A FIGURE IN THE PAY FIELD", parsed or not. The widest of
    -- the three pay columns, the one the employer-transparency surfaces count
    -- (get_explore_denominators' pay_n/postings_pay_n, get_transparent_employers'
    -- 80% gate) -- AND, since 2026-09-27, the column the states-pay FILTER binds
    -- and therefore the share a states-pay control must quote. The sentence that
    -- stood here said no filter binds this column and that it must never be
    -- quoted beside a pay control; both were true when written and are now the
    -- opposite of what ships, which is why this file exists. A pay FLOOR or
    -- CEILING still must quote salaryFloor and not this.
    'salaryText',     count(*) FILTER (WHERE salary IS NOT NULL),
    -- THE POSTED-THIS-WEEK POPULATION. maxAgeDays and postedAfter bind
    -- posted_at -- the EMPLOYER'S stated date -- never effective_posted, which
    -- coalesces our own last_seen and would answer "we found this recently".
    -- An undated posting can therefore never match a freshness chip, however
    -- new it is, and a chip that does not publish this fraction is silently
    -- hiding every posting whose age nobody knows.
    'dated',          count(*) FILTER (WHERE posted_at IS NOT NULL),
    -- THE FUNCTION TESTING ITS OWN STORY. The three pay columns are documented
    -- as nesting; if they stop nesting, the documentation is wrong and every
    -- sentence built on it is wrong with it. Published, not raised: an hourly
    -- cron that dies on a surprise publishes nothing. It is a comparison of
    -- COUNTS and proves nothing about any individual row -- see the key below,
    -- which is the per-row question.
    'nesting_holds',
      count(*) FILTER (WHERE salary IS NOT NULL)
        >= count(*) FILTER (WHERE salary_min_annual IS NOT NULL)
      AND count(*) FILTER (WHERE salary_min_annual IS NOT NULL)
        >= count(*) FILTER (WHERE salary_rank_usd IS NOT NULL),
    -- NEW. THE PER-ROW INVARIANT THE STATES-PAY WIDENING RESTS ON, as a count
    -- that is zero when the invariant holds. A row with an annualised figure and
    -- no employer text behind it is a row the widened predicate DROPS although
    -- the retired one admitted it, i.e. the one way that widening could narrow
    -- something. The count nesting above cannot see such rows while the text
    -- column stays the larger of the two, which is why this is separate.
    'annual_without_text',
      count(*) FILTER (WHERE salary IS NULL AND salary_min_annual IS NOT NULL),
    -- PROVENANCE. A coverage figure with no date is what turns a measurement
    -- into a claim -- the exact failure that let "~4%" survive in a comment for
    -- months after it stopped being true.
    'at',             now(),
    'window_days',    30
  )
  FROM public.job_board_postings
  WHERE missing_since IS NULL
    AND effective_posted >= now() - interval '30 days';
$$;

-- A public exact scan of the whole table is a free load test. Unchanged posture:
-- revoked from the two anonymous roles and from the implicit grant Postgres
-- makes by default, executable only by the role the cron and the refresh pass
-- authenticate as. A grant with no revoke is not a restriction.
REVOKE ALL ON FUNCTION public.get_filter_coverage() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_filter_coverage() FROM anon;
REVOKE ALL ON FUNCTION public.get_filter_coverage() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_filter_coverage() TO service_role;

COMMENT ON FUNCTION public.get_filter_coverage() IS
  'How much of the board each NULL-discarding filter can see, all figures from '
  'ONE scan. POPULATION: postings the board will serve -- missing_since IS NULL '
  'AND effective_posted within 30 days -- which is buildQuery''s own pair, so '
  'every numerator and the denominator describe the same board. WINDOW: 30 '
  'days, published as window_days. DATE BASIS: point-in-time at `at`; these are '
  'a snapshot and a snapshot with no date is a claim. '
  'THE THREE PAY COLUMNS NEST, EACH ANSWERS A DIFFERENT QUESTION, AND WHICH '
  'CONTROL BINDS WHICH CHANGED ON 2026-09-27. salaryText counts `salary IS NOT '
  'NULL` -- the employer wrote a figure in a pay field, parsed by us or not. '
  'From 2026-09-27 that is what the STATES-PAY FILTER binds, in buildQuery and '
  'in search_jobs, count_jobs_capped and fuzzy_title_search (20260927034117), '
  'and it is therefore the share a states-pay control must quote; it remains '
  'what get_explore_denominators and get_transparent_employers count, so the '
  'filter and the transparency surfaces now agree by construction. '
  'hasStatedPay counts `salary_min_annual IS NOT NULL` -- we parsed an '
  'annualised FIGURE out of that text. NO FILTER BINDS IT any more: it is the '
  'click rollup''s disclosure question and the honest denominator for a '
  'statement about our own parse rate, and it keeps its key name so a bundle '
  'older than 2026-09-27 still reads a number. salaryFloor counts '
  '`salary_rank_usd IS NOT NULL` -- that figure in a currency the rate table '
  'converts -- and is what a pay FLOOR, a pay CEILING or the pay ORDER binds, '
  'because a comparison needs an amount. '
  'A PAY-FLOOR CONTROL MUST STILL QUOTE salaryFloor, and quoting either wider '
  'figure beside it overstates its reach. That is why one board has been '
  'published as stating pay on 20.1% (the annualised column, 2026-08-25), 23.7% '
  '(the convertible column, live 2026-09-27T03:29:32Z) and 28.3% (the pay field, '
  'board scan 2026-09-27) with no number wrong: they count different columns for '
  'different controls. The states-pay control quotes the last of those; the '
  'floor, the ceiling and the order quote the middle-converted one. The fourth '
  'published figure, "~4%" in a client disclosure note, carries no date, no '
  'population and no column and is REFUTED by every scan since 2026-08-27 -- as '
  'is its companion "work mode ~8%" against a live ~29.9%. '
  'nesting_holds is this function checking the paragraph above against its own '
  'data (salaryText >= hasStatedPay >= salaryFloor). It is DATA, not an '
  'exception: this runs inside an hourly cron and a cron that dies on a '
  'surprise publishes nothing at all. It compares COUNTS, so it is NOT proof of '
  'any per-row property -- 5,000 rows with an annual and no text beside 207,000 '
  'with text leaves it true. annual_without_text is the per-row question it '
  'cannot answer: rows holding an annualised figure with no employer pay text '
  'behind them, which is the only population the states-pay widening could lose. '
  'Zero on every walk taken for that change (4,030 rows over two complete '
  'country strata; 18,000 over six slices; 12,000 over the two structured-pay '
  'vendors, 2026-09-27) and a non-zero value means the widening is no longer a '
  'superset and the three-column story needs re-deriving. '
  'dated counts posted_at IS NOT NULL, the population a freshness chip can '
  'reach: maxAgeDays and postedAfter bind posted_at -- the EMPLOYER''S stated '
  'date -- and never effective_posted, which coalesces our own last_seen. An '
  'undated posting can never match a freshness filter however new it is. '
  'The nine original keys are byte-for-byte 20260828122000; salaryText, dated, '
  'nesting_holds, at and window_days arrived on the SAME scan in 20260909100000 '
  'and annual_without_text joins it here, at no extra pass. Cron and '
  'refresh-pass only -- anon holds no EXECUTE, because an exact count over the '
  'whole corpus is a load test anyone could run.';

NOTIFY pgrst, 'reload schema';
