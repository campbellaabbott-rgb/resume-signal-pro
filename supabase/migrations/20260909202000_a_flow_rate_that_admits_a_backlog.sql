-- A FLOW RATE THAT ADMITS A BACKLOG.
--
-- The third file of 20260909200000's change, whose header carries the argument
-- for all three: a 'lap_backfill' closure's closed_at is the day a big board's
-- first observable lap could finally see the takedown, late by up to the
-- freshness window, so it may not date any duration, rate or tenure.
--
-- get_board_flow gets a file to itself, and the reason is a guard rather than
-- taste. plpgsql-out-params-cannot-capture-columns.test.ts -- the guard that
-- exists because this exact function shipped a 42702 on every call when a bare
-- `superseded` collided with its own OUT parameter -- locates the body by
-- taking the NEWEST MIGRATION whose text mentions the function and then slicing
-- from the file's first dollar-quote opener to its last. (Not spelled here:
-- that opener is a two-character literal, and writing it in this comment would
-- move the guard's slice up into the header -- the slice is taken from the RAW
-- file and stripped afterwards. Found by running it.) That is sound while a
-- migration holds one function and silently wrong the moment it holds a dozen:
-- pooled in
-- with its siblings, the guard read every other function's unaliased FROM
-- clauses as get_board_flow's and failed on them, which is a guard reporting a
-- defect in a body it is not looking at. One function, one file, and the guard
-- keeps pointing at the thing it names.
--
-- `closed` and `superseded` here are per-window RATES dated entirely by
-- closed_at, and they are published beside serving_delta, an OBSERVED pool
-- difference over the same window. A backfilled batch moves the first and not
-- the second, so it would show as an outflow spike the pool difference does not
-- corroborate -- which is precisely the inference this endpoint exists to
-- support.

SET LOCAL statement_timeout = '5min';

-- ── 15. the intake/outtake flow ────────────────────────────────────────────
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
    FROM public.job_board_postings p
   WHERE p.first_seen >= since;

  -- c.superseded, NOT bare `superseded`. That bare reference is the 42702 this
  -- migration exists to fix.
  SELECT count(*), count(*) FILTER (WHERE c.superseded)
    INTO v_closed, v_sup
    FROM public.job_board_closures c
   WHERE c.closed_at >= since
     AND c.absence_basis IS DISTINCT FROM 'lap_backfill';

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
  -- which is the exact failure this metric exists to correct.
  --
  -- AND THE BACKLOG IS EXCLUDED FROM THIS COLUMN TOO, which the first draft of
  -- this file missed. `closed` filtered on absence_basis and `departed` did
  -- not, so on the day a big board's first lap lands its whole month of
  -- accumulated takedowns would be excluded from the narrow column and counted
  -- in full in the wide one -- closed=400 beside departed=8,000 over the same
  -- window, with serving_delta showing no matching pool drop. That is exactly
  -- the "outflow spike the pool difference does not corroborate" this file's
  -- header names as the failure it exists to prevent, reintroduced through the
  -- column nobody filtered.
  --
  -- job_board_exits HAS NO absence_basis COLUMN to filter on: the collector
  -- writes the closure row (which carries the basis) and then, separately, the
  -- 'removed' exit row for the same event, untagged. So the basis is reached
  -- through the closure keyed on posting_id, scoped to the SAME window on both
  -- sides so the planner can anti-join two bounded sets rather than probe an
  -- unindexed column (neither table has an index on posting_id).
  --
  -- ONLY THE 'removed' ARM IS TESTED. 'aged_out', 'backdated', 'board_dormant'
  -- and 'untracked' are not written from the closure path at all, so a closure
  -- row can never be the same event as one of them; testing them would risk
  -- deleting an unrelated exit that happens to share a posting id with a
  -- backfilled closure.
  SELECT count(*) INTO v_departed
    FROM public.job_board_exits e
   WHERE e.exited_at >= since
     AND e.exit_reason IN ('removed', 'aged_out', 'backdated', 'board_dormant', 'untracked')
     AND (e.exit_reason <> 'removed' OR NOT EXISTS (
           SELECT 1
             FROM public.job_board_closures c
            WHERE c.closed_at >= since
              AND c.posting_id = e.posting_id
              AND c.absence_basis = 'lap_backfill'));

  -- Newest sample, if it is fresh enough to stand in for a live count.
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
  -- the rate.
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
  'serving_delta is OBSERVED -- the pool sampled at the window start differenced '
  'against the pool now -- never inferred from a ledger. It is NULL, never 0, '
  'until a sample old enough to difference exists. `closed` is the narrow, '
  'honest subset (an employer took the role down); `departed` is every logged '
  'exit EXCEPT the backfilled ones -- a ''removed'' exit whose posting has a '
  'lap_backfill closure in the same window is the same event as a row '
  '`closed` already refuses, and admitting it here would put a big board''s '
  'whole month of takedowns into one 24-hour window. Do not subtract `closed` from `intake`: windowed fetches, age-outs and '
  'whole-board prunes are excluded from it by design, so the difference '
  'overstates growth -- measured at 5.8x on 2026-08-17. Aggregates only; the '
  'closure log and the raw sample series stay private. '
  'ADMITTED ABSENCE BASES, for `closed`, `superseded` AND `departed` alike: '
  'full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. It is a count of events, '
  'never a dated one -- see COMMENT ON COLUMN '
  'public.job_board_closures.absence_basis, and get_closure_population() '
  'for how many such rows exist. '
  'A backlog admitted here would show as an outflow spike the serving-pool '
  'difference beside it does not corroborate, which is precisely the '
  'inference this endpoint exists to support.';
GRANT EXECUTE ON FUNCTION public.get_board_flow(integer) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
