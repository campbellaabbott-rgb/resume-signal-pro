-- THE FIELD GRID'S DESCRIPTION FORBADE THE DENOMINATOR /explore NOW USES.
--
-- 20260909110000 is the live definition of get_explore_field_grid. Its
-- description says of pay_text_n that it is a transparency statistic which no
-- filter binds and which no pay control may quote, and that stated_pay_n is what
-- the states-pay filter binds.
--
-- On 2026-09-27 the states-pay filter moved onto the employer's verbatim pay
-- field in all four runtimes that answer it (20260927034117 plus the edge
-- bundle), and /explore's states-pay chip moved its coverage family onto
-- pay_text_n in the same change -- because a chip's denominator must count the
-- column the chip's own filter tests, which is the rule this grid exists to
-- enforce. Board-wide on one scan at 2026-09-27T02:07:00Z the two counts are
-- 207,108 and 173,868 of 733,190 servable rows, so keeping the old column would
-- have understated that chip's reach by 33,240 postings. The behaviour is right;
-- the catalogue's description of it was not.
--
-- NO FUNCTION IS REDEFINED HERE. A description is not a definition, so the
-- one-function-per-file rule is not engaged and nothing about the grid's body,
-- its grants or its numerators changes. The body's own inline note about
-- pay_text_n cannot be corrected without re-issuing the whole function over a
-- description error, so this description is the authority a reader gets from the
-- live catalogue, and it now names which control binds which count.
--
-- The two paragraphs are otherwise carried across verbatim from the live
-- COMMENT, so the only change a reader sees is the pay one.

COMMENT ON FUNCTION public.get_explore_field_grid() IS
  'Per-field coverage counts for /explore, one row per category plus a `board` '
  'row, all from ONE hourly scan. See 20260909110000 for the full contract: the '
  'population pair, the remote_n / remote_mode_n distinction (remote is a '
  'boolean that is never NULL, so it reads as 100% coverage and NO CONTROL ON '
  '/explore BINDS IT; remote_mode_n is the chip''s number), week_n''s '
  'employer-stated date basis against dated_n, one_click_n as a hand mirror of '
  'the sendable-vendor list in three runtimes, and why the tiles need not sum to '
  'the board. '
  'THE THREE PAY COUNTS ARE THREE DIFFERENT QUESTIONS, they nest exactly as '
  'get_filter_coverage documents, and WHICH CHIP MAY QUOTE WHICH CHANGED ON '
  '2026-09-27. pay_text_n counts `salary IS NOT NULL` -- the employer wrote a '
  'figure in a pay field, parsed by us or not. From 2026-09-27 that is what the '
  'STATES-PAY FILTER binds (buildQuery, and search_jobs / count_jobs_capped / '
  'fuzzy_title_search per 20260927034117), so it is the count the states-pay chip '
  'MUST quote -- the previous description forbade exactly that, and was true only '
  'while the filter bound the middle column. stated_pay_n counts '
  '`salary_min_annual IS NOT NULL` -- we parsed an annualised figure -- and NO '
  'FILTER BINDS IT any more; it stays published as the honest denominator for a '
  'statement about our own parse rate and for the click rollup''s question. '
  'pay_floor_n counts `salary_rank_usd IS NOT NULL` -- that figure in a currency '
  'the rate table converts -- and is still the only column a pay FLOOR, a pay '
  'CEILING or the pay ORDER can compare against, so it is the only count an '
  '"$80k+" chip may quote. Board-wide, one scan 2026-09-27T02:07:00Z: 207,108 / '
  '173,868 / 173,826 of 733,190 servable rows. A chip quoting a count from a '
  'column its own filter does not test is the field-grain defect this grid was '
  'built to end, in the other direction.';

NOTIFY pgrst, 'reload schema';
