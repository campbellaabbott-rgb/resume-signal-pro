-- FOUR WRITE SITES, TWO CLOCKS, ONE COLUMN, NO WAY TO TELL THEM APART.
--
-- job_board_exits.days_on_board is written from four places in
-- job-board/index.ts, and three of them coalesced two different quantities
-- into one number:
--
--   :1773  whole-board exits    (r.posted_at ?? r.first_seen)   MIXED
--   :3613  aged-out path         r.posted_at only               clean
--   :3655  the 'removed' path   (r.posted_at ?? r.first_seen)   MIXED
--   :4122  freshlyDead          (r.posted_at ?? r.first_seen)   MIXED
--
-- posted_at is the EMPLOYER'S stated post date. first_seen is OUR discovery
-- date — the day this board first fetched that company's feed, which for a
-- board added in the census is a fact about us and not about the role. A
-- coalesce of the two says "this role was open for six days" when the truth is
-- "we found this board six days ago". This company has already shipped one
-- number built exactly that way (the 2.8-day median) and the standing rule
-- since is that a stored duration must name its origin basis.
--
-- IT IS LOAD-BEARING RIGHT NOW, NOT IN PRINCIPLE. The hiring-health estimator
-- being built this week takes its RIGHT-CENSORING times from exits rows with
-- exit_reason <> 'removed' — which draws on :1773 and :4122, two of the three
-- contaminated sites. Mixed-clock durations were being fed into the censoring
-- input of the model whose entire purpose is to remove that error, and no
-- column in the table could distinguish a clean row from a contaminated one.
--
-- ── THE CHOICE, MADE ONCE AND APPLIED AT ALL FOUR SITES ──────────────────
--
-- ALWAYS EMIT A DURATION WHEN ONE CAN BE COMPUTED, AND ALWAYS SAY WHICH CLOCK
-- PRODUCED IT. The alternative — writing NULL whenever posted_at is absent —
-- was rejected because it destroys information that cannot be recollected: the
-- row is written at the only moment the posting exists. A flagged
-- discovered-basis duration is a lower bound a reader can filter out in a
-- WHERE clause; a NULL is a fact nobody can ever get back.
--
--   'stated'      days_on_board measured from the employer's posted_at.
--                 The clean population. An estimator that wants one clock
--                 filters WHERE origin_basis = 'stated' and gets exactly it.
--   'discovered'  posted_at was null, so it is measured from OUR first_seen.
--                 A LOWER BOUND on the true tenure. NOT a posting age.
--   NULL          neither clock was readable; days_on_board is NULL too.
--
-- THE CHECK ADMITS NULL ON PURPOSE. Rows written before this column existed,
-- and rows written by a bundle deployed ahead of this migration, are NULL —
-- which honestly means "basis not recorded" and must not be confused with
-- either value. A NOT NULL DEFAULT would have stamped 'stated' onto the
-- historical mixed-clock rows, which is the original error with a schema
-- change on top.
--
-- job_board_closures DOES NOT GET THIS COLUMN, and that is a decision rather
-- than an omission: closures stores no duration at all. It stores posted_at
-- and first_seen as separate nullable columns, so a reader can always see
-- which clocks were available for that row. The ambiguity there lives one
-- level up, in the rollup, and is dealt with by the comment at the foot of
-- this file.

ALTER TABLE public.job_board_exits
  ADD COLUMN IF NOT EXISTS origin_basis text;

ALTER TABLE public.job_board_exits
  DROP CONSTRAINT IF EXISTS job_board_exits_origin_basis_check;
ALTER TABLE public.job_board_exits
  ADD CONSTRAINT job_board_exits_origin_basis_check
  CHECK (origin_basis IN ('stated', 'discovered'));

COMMENT ON COLUMN public.job_board_exits.origin_basis IS
  'WHICH CLOCK days_on_board WAS MEASURED FROM. '
  '''stated'' = from the employer''s posted_at; the clean population, and the '
  'only one an estimator should use without thinking about it. '
  '''discovered'' = posted_at was null, so it was measured from OUR first_seen '
  '(the day we first fetched this board): a LOWER BOUND on the real tenure and '
  'NOT a posting age. '
  'NULL = basis not recorded — every row written before 2026-09-06, and any '
  'row from a bundle deployed ahead of this migration. NULL is not a third '
  'basis and must not be read as ''stated''.';

COMMENT ON COLUMN public.job_board_exits.days_on_board IS
  'Days from the origin named by origin_basis to exited_at. THE COALESCE IS '
  'GONE: this is never silently a mix of the employer''s clock and ours. '
  'Rows with origin_basis IS NULL predate the stamp and ARE such a mix — they '
  'come from three of the four write sites and must be excluded from any '
  'duration estimate. A row can carry a duration with basis ''discovered'' and '
  'still be perfectly usable for volume and coverage work; only the tenure '
  'reading needs the ''stated'' filter.';

COMMENT ON COLUMN public.job_board_exits.exited_at IS
  'OUR OBSERVATION TIME: when this ingest pass concluded the posting had left '
  'the board. Not the employer''s removal time, which no feed states.';

-- The censoring query the estimator runs is "exits in a window, by basis", so
-- the basis rides the existing date ordering rather than getting an index of
-- its own.
CREATE INDEX IF NOT EXISTS job_board_exits_basis_idx
  ON public.job_board_exits (origin_basis, exited_at DESC);

-- ── THE SAME AMBIGUITY, ONE LEVEL UP, IN A TABLE THIS FILE DOES NOT REWRITE ──
-- roll_up_and_prune_closures (20260727140000) computes its stored percentiles
-- as `closed_at - COALESCE(c.posted_at, c.first_seen)` — the identical mixed
-- clock, frozen into a number after the raw rows that could explain it are
-- pruned. The raw table is fine; the SUMMARY is where the basis is lost.
-- It is documented rather than rewritten because another workflow is editing
-- job_board_closures this week and a CREATE OR REPLACE of that function from
-- here would silently overwrite theirs. The exit rollup added later in this
-- wave splits its percentiles by basis from the start, which is the shape the
-- closure rollup should be moved to.
COMMENT ON COLUMN public.job_board_closure_rollup.p50_days_open IS
  'Median days open for the month, computed at rollup time from '
  'closed_at - COALESCE(posted_at, first_seen) — a MIXED CLOCK: the employer''s '
  'stated date where there was one, OUR discovery date otherwise, with no flag '
  'saying which row used which. Treat as an upper-bounded estimate, not a '
  'tenure. job_board_exit_rollup splits the same statistic by origin_basis.';
COMMENT ON COLUMN public.job_board_closure_rollup.p75_days_open IS
  'As p50_days_open, and carrying the same mixed-clock caveat.';
