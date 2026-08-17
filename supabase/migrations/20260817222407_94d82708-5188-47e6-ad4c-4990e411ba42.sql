-- `net` WAS ARITHMETIC ON A LEDGER THAT IS NARROW BY DESIGN. THIRD TRY.
--
-- This metric has now been wrong three times in one day, each time in the same
-- direction — overstating growth — and each time for a different reason. The
-- pattern is worth naming, because the fix here is aimed at the pattern rather
-- than at the third reason:
--
--   v1  inferred outtake from rows still sitting past the 30-day edge. But such
--       rows are PRUNED, so it counted stragglers from an emptied pool and
--       reported net +55,863/day against a board flat at ~597,000.
--   v2  (shipped this afternoon) took outtake from job_board_closures instead —
--       a real event log, correctly recorded when the event happens. Still wrong,
--       because `net = intake - closed` treats `closed` as if it were TOTAL
--       outflow when it is deliberately a narrow SUBSET of it.
--   v3  this file. Stops inferring the flow at all.
--
-- MEASURED, v2 IN PRODUCTION, 2026-08-17 20:20-20:34Z: sampling `serving` every
-- 60s for 13.9 minutes, the pool moved 572,690 -> 572,997, or +1,326/hour. Over
-- the same window the RPC reported net +7,689/hour. It contradicts by 5.8x a
-- number returned in the SAME ROW, which is not a close call. (Shorter windows
-- read noisier — 3 min gave 18x, 5 min gave 2.8x — so the 13.9-minute figure is
-- the one quoted; the direction was consistent across all of them.)
--
-- WHY `closed` CAN NEVER BE TOTAL OUTFLOW. The closure gate in job-board's
-- ingest excludes, ON PURPOSE and with good reason, three whole classes of
-- departure:
--   (a) truncated/windowed fetches log NOTHING — a Workday tenant past its page
--       cap has live postings "vanish" as an artefact of paging. Proven live
--       2026-07-21: 7 of 8 sampled "closures" on a windowed board were still
--       open on the company's own site. Logging those would be a lie.
--   (b) age-outs are skipped — a posting crossing OUR 30-day window was removed
--       by US; nobody filled it. Those land in job_board_exits as 'aged_out'.
--   (c) superseded repeats are marked, not counted as roles going away.
-- Plus two whole-board prunes (dormancy and orphan) that until today wrote to
-- neither ledger at all — see the companion change in job-board/index.ts.
--
-- SO THE v2 MIGRATION COMMENT WAS FALSE WHERE IT MATTERED. It claimed "a row
-- that leaves the window is pruned in the same pass that logs its closure, so it
-- is already counted in `closed`". The ingest code says the opposite, in a
-- comment sitting right above the gate: "(b) age-outs are skipped". `closed` is
-- the count of roles an EMPLOYER took down. It is the right number for
-- hiring-health, and the wrong number to subtract from total intake.
--
-- THE FIX: STOP INFERRING A FLOW FROM A PARTIAL LEDGER. `net` is gone. The
-- board's growth is now OBSERVED — sampled from the pool itself each ingest pass
-- and differenced. That number cannot contradict the board's own total, because
-- it IS the board's own total, measured twice.
--
--   intake        rows first seen in the window (discovery, not new supply —
--                 a feed can surface a role posted months ago)
--   closed        employer took the role down (the narrow, honest subset)
--   superseded    of those, re-lists rather than roles going away
--   departed      ALL logged exits in the window, every reason (job_board_exits)
--   serving_prev  the pool at the START of the window, from a real sample
--   serving       the pool now
--   serving_delta OBSERVED change. NULL — never 0 — when no sample is old
--                 enough to difference against.
--
-- `serving_delta` IS NULLABLE ON PURPOSE and will be NULL until samples accrue.
-- A null that says "not yet measurable" is worth more than a confident number
-- that is wrong, which is precisely what the last two versions shipped.
--
-- IT ALSO MAKES THE RPC FAST. v2 counted 572k rows live on every call: measured
-- 2.6-4.0s warm and 7.9s cold against an 8,000ms deadline in the edge function,
-- so a cold call was landing within 77ms of returning null. `serving` now reads
-- the newest sample when one is fresh, and only falls back to a live count when
-- none is. `serving_basis` says which happened, so nobody has to guess.

-- THE LEDGER'S VOCABULARY HAS TO ADMIT THE TWO NEW REASONS FIRST.
--
-- job_board_exits carries CHECK (exit_reason IN ('removed','aged_out','backdated')).
-- The companion change in job-board/index.ts logs whole-board prunes as
-- 'board_dormant' and 'untracked' — both rejected by that constraint. And the
-- insert is deliberately best-effort (a prune must never fail because
-- bookkeeping did), so the rejection would have been caught, warned, and
-- discarded: the fix would have logged NOTHING while reporting success. Widen
-- the vocabulary in the same migration that starts writing it.
--
--   board_dormant  our fetch failed repeatedly and we dropped the board
--   untracked      we removed the board from sources.ts
--
-- Neither means the employer stopped hiring, which is why neither is a closure.
-- NOT VALID, deliberately. A plain ADD CONSTRAINT ... CHECK takes ACCESS
-- EXCLUSIVE and scans every existing row to validate it. This migration is
-- landing on a database that spent 2026-08-17 22:00Z refusing `select id limit 1`
-- inside 20s, and the sibling migration's plain CREATE INDEX on
-- job_board_closures is a prime suspect for that. Adding another full-table lock
-- to a struggling database to validate rows I can already prove are fine is not
-- a trade worth making.
--
-- Nothing is lost: the pre-existing vocabulary is ('removed','aged_out',
-- 'backdated'), all three are in the new list, so every existing row already
-- satisfies the constraint. NOT VALID skips the historical scan and still
-- enforces the check on every INSERT and UPDATE from here on, which is the only
-- thing this constraint is for.
ALTER TABLE public.job_board_exits
  DROP CONSTRAINT IF EXISTS job_board_exits_exit_reason_check;
ALTER TABLE public.job_board_exits
  ADD CONSTRAINT job_board_exits_exit_reason_check
  CHECK (exit_reason IN ('removed', 'aged_out', 'backdated', 'board_dormant', 'untracked'))
  NOT VALID;

CREATE TABLE IF NOT EXISTS public.job_board_pool_samples (
  sampled_at timestamptz PRIMARY KEY DEFAULT now(),
  serving bigint NOT NULL,
  total bigint
);

CREATE INDEX IF NOT EXISTS job_board_pool_samples_at_idx
  ON public.job_board_pool_samples (sampled_at DESC);

-- Written by the ingest pass (service role), read only through the aggregate
-- below. Consistent with the closure log: the raw series stays private.
ALTER TABLE public.job_board_pool_samples ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.job_board_pool_samples TO service_role;

-- ONE DEFINITION OF "SERVING", CALLED BY BOTH SIDES.
--
-- The sampler and the reader MUST count the same population or the difference
-- between them is noise dressed as a trend. The obvious shortcut was to sample
-- the ingest pass's existing facets total — but that is
-- `count(*) FROM job_board_postings`, the RAW table (583,876 when checked),
-- while `serving` is the 30-day servable subset (572,946 at the same moment).
-- Differencing one against the other would have rebuilt this bug out of a
-- mismatch instead of an inference. So neither side gets to spell it out.
CREATE OR REPLACE FUNCTION public.board_serving_count()
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*) FROM public.job_board_postings
   WHERE missing_since IS NULL
     AND effective_posted >= now() - interval '30 days';
$$;

-- Called once per completed ingest pass by the service role. Returns the value
-- it stored so the caller can log it without a second count.
CREATE OR REPLACE FUNCTION public.record_board_pool_sample()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '25s'
AS $$
DECLARE v_serving bigint; v_total bigint;
BEGIN
  v_serving := public.board_serving_count();
  SELECT count(*) INTO v_total FROM public.job_board_postings;
  INSERT INTO public.job_board_pool_samples (sampled_at, serving, total)
  VALUES (now(), v_serving, v_total)
  ON CONFLICT (sampled_at) DO NOTHING;
  RETURN v_serving;
END;
$$;

-- Service role ONLY. This writes, and it is reachable from the anonymous
-- function surface; anon must not be able to stuff the series that the public
-- growth number is differenced from.
REVOKE ALL ON FUNCTION public.record_board_pool_sample() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_board_pool_sample() TO service_role;

DROP FUNCTION IF EXISTS public.get_board_flow(integer);

CREATE OR REPLACE FUNCTION public.get_board_flow(p_hours integer DEFAULT 24)
RETURNS TABLE (
  window_hours integer,
  intake bigint,
  closed bigint,
  superseded bigint,
  departed bigint,
  serving_prev bigint,
  serving bigint,
  serving_delta bigint,
  serving_basis text,
  computed_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
DECLARE
  h integer := GREATEST(1, LEAST(COALESCE(p_hours, 24), 720));
  since timestamptz := now() - make_interval(hours => h);
  v_intake bigint;
  v_closed bigint;
  v_sup bigint;
  v_departed bigint;
  v_prev bigint;
  v_now bigint;
  v_basis text;
BEGIN
  SELECT count(*) INTO v_intake
    FROM public.job_board_postings WHERE first_seen >= since;

  SELECT count(*), count(*) FILTER (WHERE superseded) INTO v_closed, v_sup
    FROM public.job_board_closures WHERE closed_at >= since;

  -- ENUMERATED, not `count(*)` over the raw ledger. published-claims.test.ts
  -- holds an invariant that no published function may read job_board_exits
  -- without naming the reasons: the ledger mixes observed age ('removed' — the
  -- employer took it down) with LEARNED age ('backdated' — a posting whose
  -- stated date was already old when we first saw it), and a stat that blends
  -- them manufactures evidence out of our own late knowledge.
  --
  -- 'backdated' IS counted here, unlike in the ghost-rate stat that invariant
  -- was written for. This field answers "how many rows left the pool", and a
  -- backdated row genuinely left it; excluding it would under-count outflow,
  -- which is the exact failure this migration exists to correct. Naming the
  -- list makes that a visible decision instead of a silent one.
  SELECT count(*) INTO v_departed
    FROM public.job_board_exits
   WHERE exited_at >= since
     AND exit_reason IN ('removed', 'aged_out', 'backdated', 'board_dormant', 'untracked');

  -- Newest sample, if it is fresh enough to stand in for a live count. Twelve
  -- passes' worth of slack; beyond that we pay for the real count rather than
  -- quote a stale one as current.
  SELECT s.serving INTO v_now
    FROM public.job_board_pool_samples s
   WHERE s.sampled_at >= now() - interval '30 minutes'
   ORDER BY s.sampled_at DESC LIMIT 1;

  IF v_now IS NULL THEN
    v_now := public.board_serving_count();
    v_basis := 'live';
  ELSE
    v_basis := 'sample';
  END IF;

  -- The sample NEAREST the window start, and only from at or before it. Reaching
  -- forward for a closer sample would shorten the window silently and inflate
  -- the rate — the same shape of error this file exists to remove.
  SELECT s.serving INTO v_prev
    FROM public.job_board_pool_samples s
   WHERE s.sampled_at <= since
   ORDER BY s.sampled_at DESC LIMIT 1;

  RETURN QUERY SELECT
    h,
    v_intake,
    v_closed,
    v_sup,
    v_departed,
    v_prev,
    v_now,
    CASE WHEN v_prev IS NULL THEN NULL ELSE v_now - v_prev END,
    v_basis,
    now();
END;
$$;

COMMENT ON FUNCTION public.get_board_flow(integer) IS
  'Board intake vs outtake over the last N hours (default 24, max 720). '
  'serving_delta is OBSERVED — the pool sampled at the window start differenced '
  'against the pool now — never inferred from a ledger. It is NULL, never 0, '
  'until a sample old enough to difference exists. `closed` is the narrow, '
  'honest subset (an employer took the role down); `departed` is every logged '
  'exit. Do not subtract `closed` from `intake`: windowed fetches, age-outs and '
  'whole-board prunes are excluded from it by design, so the difference '
  'overstates growth — measured at 5.8x on 2026-08-17. Aggregates only; the '
  'closure log and the raw sample series stay private.';

GRANT EXECUTE ON FUNCTION public.get_board_flow(integer) TO anon, authenticated;

-- Trim the series. It exists to be differenced, not to be a second history.
DELETE FROM public.job_board_pool_samples WHERE sampled_at < now() - interval '90 days';