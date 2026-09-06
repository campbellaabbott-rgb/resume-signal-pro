-- THE PARSER LEARNED A PERIOD THE COLUMN STILL REJECTS.
--
-- job_board_postings.salary_period carries
--     CHECK (salary_period IN ('hour', 'week', 'month', 'year'))
-- added by 20260722224800 (and 20260722213009 before it). The structured
-- parser has since learned a fifth: parseSalaryStructured returns period
-- 'day' for lever's "/per-day-wage", "$500 per day", "£350 a day" — the live
-- substitute-teacher and per-diem cases pinned in
-- src/test/an-hourly-rate-is-not-a-full-time-salary.test.ts, which asserts
-- period === 'day' and an annualisation at 260 working days rather than the
-- 2080-hour inference that once turned a $160 day rate into $332,800.
--
-- The two have disagreed ever since, and the collection wave makes the
-- disagreement fatal rather than merely latent:
--
--   * 20260906210500 teaches apply_posting_corrections to write
--     salary_period, and the corrections path re-runs the structured parse
--     whenever an employer edits their pay text. A vendor moving a role to a
--     day rate therefore puts salary_period = 'day' into a 200-row batched
--     patch. Postgres raises 23514 job_board_postings_salary_period_check for
--     the WHOLE batch; the edge only falls back to per-row UPDATEs on a
--     PGRST202 name mismatch, so every remaining correction for that board —
--     up to CORRECTIONS_PER_VISIT = 1,000 — is dropped for that visit, and it
--     recurs on every visit while the text still differs.
--   * 20260906213000's own COMMENT on the closure/exit salary_period columns
--     names the vocabulary as 'hour | day | week | month | year'. Two files in
--     the same wave disagreeing about a legal value set is exactly the claim
--     drift this repo has a rule against.
--
-- WIDENING, NOT NARROWING, so validation is trivial: no stored row can hold
-- 'day' today (the constraint forbade it), every stored value is still legal
-- under the new list, and the constraint is added VALID rather than NOT VALID
-- because the scan can only pass.
--
-- The closure and exit copies of salary_period carry no CHECK at all and are
-- deliberately left that way: they are a historical record of what the parser
-- said at event time, and a rejected value there would lose the whole
-- lifecycle row rather than degrade one column of it.

ALTER TABLE public.job_board_postings
  DROP CONSTRAINT IF EXISTS job_board_postings_salary_period_check;
ALTER TABLE public.job_board_postings
  ADD CONSTRAINT job_board_postings_salary_period_check
  CHECK (salary_period IN ('hour', 'day', 'week', 'month', 'year'));

COMMENT ON COLUMN public.job_board_postings.salary_period IS
  'The period the employer actually quoted before annualisation: hour | day | '
  'week | month | year. NULL means the pay text stated no period or disclosed '
  'no pay at all. This vocabulary must stay in step with '
  'parseSalaryStructured in supabase/functions/_shared/salary-extract.ts — a '
  'period the parser can emit and the constraint rejects fails the whole '
  'batched correction it rides in, not just the one row.';
