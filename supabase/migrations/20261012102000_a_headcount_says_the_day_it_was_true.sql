-- A HEADCOUNT SAYS THE DAY IT WAS TRUE (owner decision D11, 2026-10-11).
--
-- company_profiles holds 978 employee counts (YC self-reported and public
-- records) and no column saying when any of them was true, so the employer
-- page printed figures like "≈779,000 employees" with no date basis. This
-- adds that column, as_of, and leaves it NULL: no row is dated here, because
-- no source we hold says when its count was taken.
--
-- Every surface that prints one of these counts renders it only beside a
-- plain calendar date (src/lib/headcount.ts, datedHeadcount), so until a row
-- is dated its count is hidden everywhere. A reader that later returns the
-- column hands it over as employees_as_of.
--
-- Nothing else changes: no grant, no policy, no reader. The table's existing
-- read policy covers the new column, which holds nothing yet.
--
-- Self-verifying, safe to re-run.

SET LOCAL statement_timeout = '1min';

ALTER TABLE public.company_profiles ADD COLUMN IF NOT EXISTS as_of date;

COMMENT ON COLUMN public.company_profiles.as_of IS
  'The day employee_count was true. NULL means undated, and an undated count is '
  'never printed (owner decision D11, 2026-10-11; src/lib/headcount.ts). Added '
  'NULL for every row by 20261012102000: no source we hold says when its count '
  'was taken. A reader returns it as employees_as_of.';

DO $verify$
DECLARE
  v_type    text;
  v_null    text;
  v_default text;
BEGIN
  SELECT c.data_type, c.is_nullable, c.column_default
    INTO v_type, v_null, v_default
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'company_profiles' AND c.column_name = 'as_of';
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'company_profiles.as_of is missing';
  END IF;
  IF v_type <> 'date' THEN
    RAISE EXCEPTION 'company_profiles.as_of is %, not date', v_type;
  END IF;
  IF v_null <> 'YES' THEN
    RAISE EXCEPTION 'company_profiles.as_of must stay nullable: an undated row is the honest state';
  END IF;
  IF v_default IS NOT NULL THEN
    RAISE EXCEPTION 'company_profiles.as_of carries a default (%): it would date every row with a day nobody measured', v_default;
  END IF;
END
$verify$;
