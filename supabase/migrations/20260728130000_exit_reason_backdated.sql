-- A third exit reason, added BEFORE the thing that needs it runs.
--
-- The posted-date backfill has been dead code since it shipped (its only kick
-- sat behind a completed 120-slice cold rotation; measured 2026-07-28,
-- bamboohr dated = 0 for 3h09). That is now fixed, so it is about to date
-- ~43,687 BambooHR and ~9,600 Rippling postings for the first time.
--
-- Measured at the vendor, n=161 BambooHR: 161 of 162 answered 200 WITH a date
-- (these are live postings, not dead links), and 82.0% are older than 30 days
-- (95% CI 76.1-87.9), median 174 days, oldest 8.7 years. So the freshness cap
-- will delete roughly 33,224-38,411 of them, correctly — an undated posting
-- from January should not sit on a board that promises nothing older than 30
-- days. That is the intended outcome and it is not what this migration is
-- about.
--
-- WHAT THIS MIGRATION IS ABOUT: those deletions each write an exit event, and
-- job_board_exits currently offers only two labels. Its own header defines
-- 'aged_out' as "still advertised when it crossed OUR 30-day serving cap" —
-- a tenure this board watched elapse. It is the numerator of the Ghost Job
-- Index's namesake stat ("X% of postings in <field> are still advertised after
-- 30 days"), which ships only after ~30 days of accrual with n >= 500 per
-- segment.
--
-- A posting we first saw eight weeks ago, whose employer says it was posted
-- 174 days ago, gives us no such observation. We did not watch it age; a
-- backfill told us it was already aged. Filing ~35,000 of those as 'aged_out'
-- would let a dating sweep MANUFACTURE ghost-rate evidence out of our own late
-- knowledge, and it would arrive as a single-day spike, because a sweep drains
-- in hours what the board would otherwise emit over months. The stat has not
-- shipped yet, which is exactly why this is cheap to get right now and
-- expensive to unpick later.
--
-- 'backdated' = the employer's stated post date precedes our first sighting by
-- more than the serving window. days_on_board is unchanged and still real (it
-- is defined off the employer's date, and 174 days IS this posting's true
-- tenure at the employer) — only the claim we are entitled to make about it
-- changes.
--
-- The edge function decides this from the ROW (posted_at < first_seen - 30d),
-- not from a flag the sweep sets, so every future backfill on any vendor
-- inherits the correct label without anyone remembering that this cohort
-- existed.
ALTER TABLE public.job_board_exits
  DROP CONSTRAINT IF EXISTS job_board_exits_exit_reason_check;

ALTER TABLE public.job_board_exits
  ADD CONSTRAINT job_board_exits_exit_reason_check
  CHECK (exit_reason IN ('removed', 'aged_out', 'backdated'));

COMMENT ON COLUMN public.job_board_exits.exit_reason IS
  'removed = the feed stopped listing it (filled or withdrawn). '
  'aged_out = still advertised when it crossed OUR 30-day cap; a tenure this '
  'board observed, and the only reason admissible in the ghost-rate numerator. '
  'backdated = the employer date predates our first sighting by more than the '
  'serving window, so the tenure was learned, not observed. Ghost-rate '
  'consumers MUST filter to aged_out.';
