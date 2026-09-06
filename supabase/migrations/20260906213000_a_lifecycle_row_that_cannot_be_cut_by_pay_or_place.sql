-- THE LAST MOMENT PAY, TEAM, GEOGRAPHY AND LEVEL EXIST IS THE MOMENT WE LOG
-- THE EVENT, AND WE HAVE NEVER LOGGED THEM.
--
-- job_board_closures holds posting_id, source, company_token, company, title,
-- category, first_seen, posted_at, closed_at, superseded. job_board_exits is
-- thinner still: no title, no company. Then the posting row is HARD-DELETED
-- (job-board/index.ts ~3665), taking salary, department, country, work mode,
-- employment type, seniority band and jurisdiction with it.
--
-- So every fill rate, churn rate and ghost rate this company will ever publish
-- is, for every period already elapsed, uncuttable by pay, by team, by
-- geography and by level. Not hard to compute — IMPOSSIBLE to compute, because
-- the facts were deleted. "Roles paying over $150k fill in 11 days and roles
-- under $60k take 34" is the product; it cannot be answered for August and it
-- cannot be answered for any month that ends before these columns exist.
--
-- IT COSTS ONE WIDER ROW READ AND NOTHING ELSE. The collector already SELECTs
-- the posting row before deleting it. Widening that select and carrying the
-- values into the insert adds no query, no round trip and no array — which is
-- the only kind of change the ingest loop can afford, since it dies on
-- WORKER_RESOURCE_LIMIT at ~1,800 postings and heap scales at ~146KB each.
--
-- NULLABLE, ALL OF THEM, AND THAT IS LOAD-BEARING. A null here means "the
-- posting did not carry this", which for salary_min_annual is the pay-
-- disclosure number itself. A NOT NULL DEFAULT would convert "the employer
-- did not say" into "the employer said zero" on the one column whose absence
-- IS the measurement.
--
-- NO TIME COLUMN IS ADDED HERE, deliberately: every column below is a
-- descriptive attribute of the role, not a duration, so none of them needs a
-- basis. The two clocks these tables already carry (posted_at = the employer's
-- stated date; first_seen = OUR discovery) keep their existing meanings, and
-- the duration derived from them is dealt with in the next migration.

-- ── the closure log ──────────────────────────────────────────────────────
ALTER TABLE public.job_board_closures
  ADD COLUMN IF NOT EXISTS department        text,
  ADD COLUMN IF NOT EXISTS country           text,
  ADD COLUMN IF NOT EXISTS region_code       text,
  ADD COLUMN IF NOT EXISTS work_mode         text,
  ADD COLUMN IF NOT EXISTS employment_type   text,
  ADD COLUMN IF NOT EXISTS experience_band   text,
  ADD COLUMN IF NOT EXISTS min_years         smallint,
  ADD COLUMN IF NOT EXISTS salary_min_annual numeric,
  ADD COLUMN IF NOT EXISTS salary_max_annual numeric,
  ADD COLUMN IF NOT EXISTS salary_period     text,
  ADD COLUMN IF NOT EXISTS salary_currency   text;

-- ── the exit ledger ──────────────────────────────────────────────────────
-- title and company arrive here too: an exit row was previously unreadable
-- without joining back to a posting that no longer exists.
ALTER TABLE public.job_board_exits
  ADD COLUMN IF NOT EXISTS company           text,
  ADD COLUMN IF NOT EXISTS title             text,
  ADD COLUMN IF NOT EXISTS department        text,
  ADD COLUMN IF NOT EXISTS country           text,
  ADD COLUMN IF NOT EXISTS region_code       text,
  ADD COLUMN IF NOT EXISTS work_mode         text,
  ADD COLUMN IF NOT EXISTS employment_type   text,
  ADD COLUMN IF NOT EXISTS experience_band   text,
  ADD COLUMN IF NOT EXISTS min_years         smallint,
  ADD COLUMN IF NOT EXISTS salary_min_annual numeric,
  ADD COLUMN IF NOT EXISTS salary_max_annual numeric,
  ADD COLUMN IF NOT EXISTS salary_period     text,
  ADD COLUMN IF NOT EXISTS salary_currency   text;

-- company/title on exits are NULLABLE where the closure log defaults them to
-- '': the ingest writes null when the posting row carried none, and an empty
-- string there would be indistinguishable from an employer with no name.

-- ── what every one of them means, on both tables ─────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['job_board_closures', 'job_board_exits'] LOOP
    EXECUTE format($c$COMMENT ON COLUMN public.%I.department IS
      'The team/department the vendor stated for this posting, copied verbatim from job_board_postings at the moment the event was logged. Free text and vendor-specific: "Engineering", "R&D - Platform". NULL means the vendor stated none.'$c$, t);
    EXECUTE format($c$COMMENT ON COLUMN public.%I.country IS
      'ISO 3166-1 alpha-2 country as normalize.ts resolved it from the location string, copied at event time. NULL means the location string named no country we recognise.'$c$, t);
    EXECUTE format($c$COMMENT ON COLUMN public.%I.region_code IS
      'ISO 3166-2 subdivision ("US-CO", "CA-ON") as parsed from the location string, copied at event time. Always country-prefixed; a bare two-letter code is ambiguous and is never written. This is the grain pay-disclosure law is written at, and it exists nowhere else once the posting row is deleted.'$c$, t);
    EXECUTE format($c$COMMENT ON COLUMN public.%I.work_mode IS
      'remote | hybrid | onsite as stated by the vendor or resolved by enrichment, copied at event time. NULL means undisclosed, which is itself the coverage number — it does not mean onsite.'$c$, t);
    EXECUTE format($c$COMMENT ON COLUMN public.%I.employment_type IS
      'full_time | part_time | contract | temporary | internship as stated by the vendor, copied at event time. NULL means the vendor stated none.'$c$, t);
    EXECUTE format($c$COMMENT ON COLUMN public.%I.experience_band IS
      'entry | mid | senior | lead as classified from title and description, copied at event time. OUR classification, not the employer''s words.'$c$, t);
    EXECUTE format($c$COMMENT ON COLUMN public.%I.min_years IS
      'Minimum years of experience the posting demanded, parsed from its text. NOT a duration of this event and NOT a time on the board — it is a requirement stated by the employer, and it has no clock.'$c$, t);
    EXECUTE format($c$COMMENT ON COLUMN public.%I.salary_min_annual IS
      'Bottom of the stated pay band, normalised to an ANNUAL figure in salary_currency, copied at event time. NULL means the posting disclosed no pay — the pay-disclosure measurement itself — never zero.'$c$, t);
    EXECUTE format($c$COMMENT ON COLUMN public.%I.salary_max_annual IS
      'Top of the stated pay band, normalised to an ANNUAL figure in salary_currency, copied at event time. NULL means no pay was disclosed, or only a single figure was.'$c$, t);
    EXECUTE format($c$COMMENT ON COLUMN public.%I.salary_period IS
      'The period the employer actually quoted (hour | day | week | month | year) before annualisation. Kept because "$32/hour" and "$66,560/year" are the same annual figure and not the same job advert.'$c$, t);
    EXECUTE format($c$COMMENT ON COLUMN public.%I.salary_currency IS
      'ISO 4217 code for the stated band. NULL means no pay was disclosed; it does not mean USD, and any cross-currency comparison that assumes otherwise is wrong.'$c$, t);
  END LOOP;
END $$;

COMMENT ON COLUMN public.job_board_exits.company IS
  'Employer display name at event time, denormalised so an exit row is readable after the posting is deleted. NULL when the posting carried none.';
COMMENT ON COLUMN public.job_board_exits.title IS
  'Posting title at event time, denormalised for the same reason. NULL when the posting carried none.';

-- ── HOW LONG THESE ANSWERS SURVIVE, WHICH IS NOT FOREVER ─────────────────
-- Stating it here because a column that quietly empties on a rolling window is
-- worse than one that was never added: someone will build a longitudinal
-- product on it and find the early months gone.
--
--   job_board_closures  raw rows are pruned at 180 days by
--     roll_up_and_prune_closures (scheduled daily by 20260727140000), and its
--     summary table job_board_closure_rollup carries only
--     (company_token, company, category, month, fills, relists, p50/p75 days
--     open). NONE of the eleven columns above is summarised anywhere. So "roles
--     over $150k fill in 11 days" is answerable for a rolling 180-day window
--     and then stops being answerable for that period, exactly as it is
--     unanswerable for August today. Fixing that means adding facet dimensions
--     to job_board_closure_rollup, which is a change to the closures rollup
--     function — owned by another workflow this week and deliberately not
--     touched from here. IT NEEDS AN OWNER; it is not fixed by this migration.
--
--   job_board_exits     raw rows are pruned at 90 days by
--     roll_up_and_prune_exits (20260906218000), whose rollup DOES carry the
--     pay and jurisdiction cuts: country and region_code are in its key,
--     salary disclosure and a pay percentile are columns, and work_mode /
--     experience_band / employment_type survive as dim_counts. department and
--     the salary max/period/currency do not, and are lost at 90 days.
--
-- ── indexes ──────────────────────────────────────────────────────────────
-- NONE ADDED. Both tables already carry (company_token, date) and (date), the
-- two access patterns that exist, and nothing reads these columns today — this
-- wave is writes. A pay-band or jurisdiction cut is an aggregate over a date
-- range that will seq-scan whatever we build, so an index now would be pure
-- write cost on two hot append paths.
