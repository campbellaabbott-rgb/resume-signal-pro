-- WE ALREADY COMPUTE THE DIFF. WE HAVE NEVER ONCE KEPT IT.
--
-- The UNFREEZE block in supabase/functions/job-board/index.ts (~3415) compares
-- the vendor's current payload against our stored row field by field —
-- title, location, apply_url, country, work_mode, employment_type, salary,
-- remote, agency — builds a `patch` of exactly what changed, writes the new
-- value, and drops the old one on the floor. Every rotation. There is no
-- history table anywhere in this repo; this was checked by enumerating every
-- job_board_* table, not by assuming.
--
-- WHAT THAT DISCARDS. An employer editing a LIVE requisition is an event no
-- aggregator holds, because holding it requires having watched the same
-- requisition across two fetches and having bothered to keep the before:
--   * a salary band moved on an open role — repricing, mid-market, dated
--   * work_mode flipped remote -> hybrid on a req that never came down
--   * a title was re-levelled (Senior -> Staff) without a repost
--   * an apply_url moved to a different ATS host — the migration signal
-- The measured rate is not small: 1.16% of titles and 0.57% of locations
-- disagreed with the vendor on 2026-07-29, ~6,800 and ~3,350 rows at the size
-- of the table then.
--
-- observed_at IS OUR CLOCK AND SAYS SO IN ITS COMMENT. It is the moment the
-- ingest pass saw the difference, which is somewhere between the employer's
-- edit and one full rotation later. It is not the moment of the edit, it is
-- not a posting age, and it must never be subtracted from a vendor date to
-- produce a duration without naming that it is a discovery time.

CREATE TABLE IF NOT EXISTS public.job_board_field_changes (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  posting_id    text NOT NULL,
  company_token text NOT NULL DEFAULT '',
  source        text NOT NULL DEFAULT '',
  field         text NOT NULL,
  old_value     text,
  new_value     text,
  observed_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.job_board_field_changes IS
  'Append-only log of edits an employer made to a posting that stayed LIVE '
  'across two of our fetches. Written from the corrections/UNFREEZE path in '
  'job-board/index.ts, one row per changed field, batched one INSERT per pass. '
  'Private: RLS on, no policy, service_role only.';
COMMENT ON COLUMN public.job_board_field_changes.posting_id IS
  'job_board_postings.id — source:company_token:externalId. NOT a foreign key: '
  'the posting row is deleted when the role closes and this history must '
  'outlive it, which is the entire point of the table.';
COMMENT ON COLUMN public.job_board_field_changes.company_token IS
  'Board identity, denormalised so the log stays interpretable after the '
  'posting row is deleted. Note that one employer may hold several tokens '
  '(PwC has four); this is the FEED, not the company.';
COMMENT ON COLUMN public.job_board_field_changes.field IS
  'The job_board_postings column that changed. EXACTLY EIGHT VALUES ARE EVER '
  'WRITTEN: title, location, apply_url, country, work_mode, employment_type, '
  'salary, remote. Three groups of patched columns are deliberately NOT '
  'logged, and a reader must not take their absence for "no employer ever '
  'changed one": (1) region_code, excluded by DERIVED_NOT_EMPLOYER_EDITS in '
  'the collector because it is our own parse of the location string, so a '
  'change in it is a change in our parser; (2) salary_min_annual, '
  'salary_max_annual, salary_period and salary_currency, which are re-derived '
  'from the salary text whenever it moves and are therefore already implied by '
  'the ''salary'' row beside them; (3) agency, which rides the sources.ts '
  'catalog entry rather than the posting, so it changes when WE re-tag a '
  'board. '
  'ONE CAVEAT ON country, the only logged field that is not purely the '
  'employer''s words: the vendor states it on some feeds and on the rest it is '
  'detectCountry(location). A change to the country tables or a bump of '
  'COUNTRY_MAP_VERSION therefore writes country rows across a rotation that '
  'are OUR edit, not the employer''s, and nothing in this table distinguishes '
  'them. Correlate a burst of country rows with a deploy before reading it as '
  'employers relocating live requisitions.';
COMMENT ON COLUMN public.job_board_field_changes.old_value IS
  'The value we held before this pass, rendered as text and TRUNCATED TO 1000 '
  'CHARACTERS by trigger. NULL means we held no value; it does not mean the '
  'employer stated an empty one.';
COMMENT ON COLUMN public.job_board_field_changes.new_value IS
  'The value the vendor stated on this pass, rendered as text and TRUNCATED TO '
  '1000 CHARACTERS by trigger. NULL means the correction cleared the field.';
COMMENT ON COLUMN public.job_board_field_changes.observed_at IS
  'OUR OBSERVATION TIME: when the ingest pass noticed the difference. It is '
  'NOT when the employer made the edit — the true edit falls somewhere in the '
  'rotation interval before this stamp — and it is NOT a posting age. Any '
  'duration derived from it must name it as a discovery clock.';

-- THE 1000-CHARACTER CAP IS ENFORCED HERE, NOT ONLY IN THE CALLER.
-- A CHECK constraint would REJECT an over-long row, and this insert is a
-- best-effort waitUntil write: a rejection loses the history silently, which
-- is the failure mode this table exists to end. A trigger truncates instead,
-- so the row always lands. Salary strings and titles are the long ones; 1000
-- characters is generous for both.
CREATE OR REPLACE FUNCTION public.job_board_field_changes_cap()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.old_value := left(NEW.old_value, 1000);
  NEW.new_value := left(NEW.new_value, 1000);
  NEW.field     := left(NEW.field, 64);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.job_board_field_changes_cap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_job_board_field_changes_cap ON public.job_board_field_changes;
CREATE TRIGGER trg_job_board_field_changes_cap
  BEFORE INSERT OR UPDATE ON public.job_board_field_changes
  FOR EACH ROW EXECUTE FUNCTION public.job_board_field_changes_cap();

-- The three reads this table will obviously get: one employer's edits over
-- time, one posting's history, and a date-bounded sweep (a retention prune, or
-- "every salary change last month"). Nothing speculative beyond those.
CREATE INDEX IF NOT EXISTS job_board_field_changes_company_idx
  ON public.job_board_field_changes (company_token, observed_at DESC);
CREATE INDEX IF NOT EXISTS job_board_field_changes_posting_idx
  ON public.job_board_field_changes (posting_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS job_board_field_changes_observed_idx
  ON public.job_board_field_changes (observed_at DESC);

ALTER TABLE public.job_board_field_changes ENABLE ROW LEVEL SECURITY;
-- No policy, no anon/authenticated grant: RLS with no policy denies everyone
-- but service_role, and the grant is withheld rather than granted-then-revoked.
GRANT ALL ON public.job_board_field_changes TO service_role;

-- NO RETENTION JOB IS INSTALLED, DELIBERATELY, AND THAT IS A DECISION WITH A
-- NUMBER BEHIND IT. At the measured change rate a full rotation produces on
-- the order of 10-20k rows; a year is a few million rows of narrow text. That
-- is affordable, and this is precisely the class of history that a retention
-- job installed "for tidiness" destroys irreversibly — the exact mistake
-- 20260727140000 caught being made to the closure log. If this table ever
-- needs pruning it needs a rollup FIRST, in the shape of
-- roll_up_and_prune_closures, and never a bare DELETE.
--
-- NOTE FOR THE INGEST CHANGE THAT FEEDS THIS TABLE (not made here — this
-- migration owns schema only):
--   * ONE batched insert per pass, built from the `corrections` array that
--     already exists. Do not add a per-posting round trip and do not retain a
--     new array proportional to postings fetched: the array of changed fields
--     is proportional to CHANGES (~1-2% of rows), which is why this is
--     affordable inside a loop that dies at ~1,800 postings.
--   * supabase-js RETURNS errors. Check { error } on the insert or the history
--     silently never accrues, which is the failure this table cannot survive.
--   * The write is best-effort: waitUntil(...).then().catch(), never blocking
--     or failing the pass.
