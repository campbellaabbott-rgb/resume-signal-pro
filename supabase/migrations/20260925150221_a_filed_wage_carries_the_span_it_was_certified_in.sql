-- A FILED WAGE CARRIES THE SPAN IT WAS CERTIFIED IN.
--
-- WHY THIS EXISTS. public.oflc_lca_wages already carries the file each cell
-- came from and that file's publication date, and the label naming the period
-- was read off the FILE NAME. The Department's "quarterly" disclosure file is
-- cumulative year to date: the FY2026 Q3 file holds every application decided
-- since 1 October, and the three months its name points at are about half of
-- it. Every cell was therefore stamped with a label 1.86x narrower than the
-- applications behind it, and no check could see it, because each step
-- downstream compared the label to the file name it was taken from.
--
-- The two columns below are the measurement that ends that: the earliest and
-- latest DECISION_DATE of the applications actually folded into the cells,
-- read out of the file by the loader. The label is now computed from them, so
-- a label and a span cannot disagree without one of them being edited by hand,
-- and the surface can print what the figures are a figure OF.
--
-- WHY THEY ARE NULLABLE. A row loaded before this column existed has no span,
-- and inventing one -- the file's name, the publication date, anything -- is
-- the defect this migration is here to remove. Rows written from here on carry
-- both: the payload's decoder refuses a cell without them before a single row
-- is posted, and the loader refuses to emit one. The only CHECK is that they
-- are in order when both are present.
--
-- THE MEDIAN IS ALSO RENAMED IN ITS COMMENT AND NOT IN ITS SPELLING, because
-- what changed is what the loader puts in it. It held the median of the range
-- FLOORS, which is why 165 of the 929 cells with three or more filings had a
-- "median" sitting exactly on one end of their own range. It now holds the
-- median of the wage FIGURES the filings state. The comment says so, because a
-- column called median that is not one is a loaded gun for whichever surface
-- prints it next.
--
-- No function is defined here. Columns, one constraint, and the comments that
-- say what the numbers are.

SET LOCAL statement_timeout = '5min';

ALTER TABLE public.oflc_lca_wages
  ADD COLUMN IF NOT EXISTS coverage_from date,
  ADD COLUMN IF NOT EXISTS coverage_to   date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.oflc_lca_wages'::regclass
       AND conname = 'oflc_lca_wages_coverage_ordered'
  ) THEN
    ALTER TABLE public.oflc_lca_wages
      ADD CONSTRAINT oflc_lca_wages_coverage_ordered
      CHECK (coverage_from IS NULL OR coverage_to IS NULL OR coverage_from <= coverage_to);
  END IF;
END $$;

COMMENT ON COLUMN public.oflc_lca_wages.coverage_from IS
  'The earliest decision date among the certified applications folded into this load, measured from '
  'the disclosure file itself. With coverage_to it is the span every figure in this table is about. '
  'Null only on rows loaded before this column existed.';
COMMENT ON COLUMN public.oflc_lca_wages.coverage_to IS
  'The latest such decision date. The Department publishes cumulative year-to-date files, so this '
  'span is what the label means and the label is computed from it -- never the other way round.';
COMMENT ON COLUMN public.oflc_lca_wages.fiscal_quarter IS
  'The label for the span between coverage_from and coverage_to, computed from those dates by the '
  'loader and refused unless it equals the one they earn. It is NOT read from the file name: the '
  'file is cumulative year to date and its name names about half of what is in it.';
COMMENT ON COLUMN public.oflc_lca_wages.wage_median_annual IS
  'The median of the annual wage FIGURES the certified applications behind this cell state: each '
  'filing''s floor, plus its ceiling wherever the employer filed a range. Not a median of salaries '
  '-- one application can contribute two figures -- and not the median of the floors, which is what '
  'this column held until 2026-09-25 and which put a sixth of the printable cells'' "median" exactly '
  'on one end of their own range.';

-- Self-check: a migration that claims a widening it did not make is worse than
-- none, because the next deploy stops looking.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'oflc_lca_wages'
     AND column_name IN ('coverage_from', 'coverage_to');
  IF n <> 2 THEN
    RAISE EXCEPTION 'the wage table does not carry both coverage columns after this migration (found %)', n;
  END IF;
END $$;
