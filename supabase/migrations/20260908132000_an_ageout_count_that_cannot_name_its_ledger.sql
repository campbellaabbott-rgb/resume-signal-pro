-- "STILL ADVERTISED WHEN IT CROSSED DAY 30" — OVER HOW LONG?
--
-- /explore is about to render ageouts_90d, which get_company_fill_curve
-- already returns and which Explore already fetches and then drops on the
-- floor. That merge is the whole of the count: the curve is the ONE owner of
-- it, its exclusion of 'backdated' is already correct there ("ageouts_90d
-- counts ''aged_out'' alone", in that function's COMMENT ON), and adding a
-- second count of the same quantity anywhere would be this repo's oldest
-- defect wearing a new name. Nothing here recomputes it.
--
-- WHAT IS MISSING IS ITS DATE BASIS, AND THE MISSING PIECE IS NOT COSMETIC.
-- The column is named for a 90-day window of exit events. The exit ledger does
-- not hold 90 days: job_board_exits was created 2026-07-26, and a retention
-- cron deletes rows older than 90 days, so the ledger's span is bounded above
-- by both. A card printing "N roles were still advertised when they crossed
-- day 30" beside a column called _90d invites the reader to divide by ninety
-- days of watching that we have not done — the same shape as "90 days of
-- watching" over a 56-day closure log, and the same shape as the 2.8-day
-- median before it.
--
-- So this publishes the ledger's own span, board-wide, and nothing else. One
-- scalar, one owner, no second count to drift from the first.
--
-- WHY min(exited_at) FILTERED TO 'aged_out' AND NOT min OVER THE LEDGER. The
-- basis being named is the basis of THE AGE-OUT SERIES. 'removed' rows have
-- been written since the ledger existed; the aged-out arm is what the card is
-- about, and if age-out stamping ever started later than the ledger did, the
-- honest span is the shorter one. Written as ORDER BY ... LIMIT 1 rather than
-- min() so the plan is an index walk on job_board_exits_exited_idx that stops
-- at the first matching row, not a filtered scan of the ledger.
--
-- 'backdated' IS EXCLUDED HERE TOO, and for the reason the exit ledger's own
-- header gives: 'aged_out' means STILL ADVERTISED WHEN IT CROSSED OUR 30-DAY
-- CAP -- a tenure our board watched elapse -- while 'backdated' is a posting
-- that was already old when it reached us, i.e. OUR LATE KNOWLEDGE and not the
-- employer's conduct. A basis measured over both would date the series from
-- rows the series does not contain.

CREATE OR REPLACE FUNCTION public.get_ageout_basis()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  WITH first_ageout AS (
    SELECT e.exited_at AS at
    FROM public.job_board_exits e
    WHERE e.exit_reason = 'aged_out'
    ORDER BY e.exited_at ASC
    LIMIT 1
  )
  -- strip_nulls, so an empty ledger degrades to an absent key and the caller
  -- renders no sentence rather than "0 days".
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'ageout_log_start', (SELECT first_ageout.at FROM first_ageout),
    'ageout_log_days',  (SELECT NULLIF(GREATEST(
                           EXTRACT(DAY FROM now() - first_ageout.at)::int, 0), 0)
                         FROM first_ageout)
  ));
$$;

-- Cron-only like its siblings: it rides the hourly explore cache, and the
-- ledger it reads has no public SELECT policy by design.
REVOKE ALL ON FUNCTION public.get_ageout_basis() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ageout_basis() TO service_role;

COMMENT ON FUNCTION public.get_ageout_basis() IS
  'The DATE BASIS for the age-out count, and nothing else -- it deliberately '
  'publishes no count, because get_company_fill_curve.ageouts_90d is the single '
  'owner of that quantity and a second copy would drift from it. COLUMNS: '
  'ageout_log_start = the earliest exited_at we hold with exit_reason '
  '''aged_out'' (OUR clock: the moment we recorded the exit, not a date any '
  'employer stated); ageout_log_days = whole days from that instant to now. '
  'WHAT IT IS FOR: ageouts_90d is named for a 90-day window of exit events, but '
  'the ledger began 2026-07-26 and a retention cron deletes rows past 90 days, '
  'so the record is SHORTER than the column name and a card must state the span '
  'it actually has. ''backdated'' is excluded on both this basis and the count '
  'it dates: ''aged_out'' means STILL ADVERTISED WHEN IT CROSSED OUR 30-DAY '
  'CAP -- a tenure this board watched elapse -- whereas ''backdated'' is our own '
  'late knowledge of a posting that was already old when it arrived, and '
  'counting it would manufacture employer conduct out of a dating sweep. The '
  'count it dates is a FLOOR: the collector writes exit rows best-effort and '
  'logs insert failures non-fatally, so an age-out we failed to write is an '
  'age-out we cannot see. Both keys are absent (never zero) when the ledger '
  'holds no aged-out row. Cron-only.';

NOTIFY pgrst, 'reload schema';
