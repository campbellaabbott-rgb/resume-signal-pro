-- THE OUTTAKE HALF OF get_board_flow WAS MEASURING A RESIDUE, NOT A FLOW.
--
-- Shipped hours ago and wrong. It reported, over 24 hours:
--
--   intake 63,151   takedown 7,107   aged_out 181   net +55,863
--
-- A net of +55,863 would have grown the board ~9% in a day. The board total sat
-- flat at ~597,000 the whole time. The number contradicted the board's own
-- headline figure, which is the tell.
--
-- THE MISTAKE. `aged_out` counted rows whose effective_posted had crossed the
-- 30-day serving edge and were still sitting in job_board_postings. But rows
-- past the window are PRUNED, not left to age: only 3,092 rows older than 30
-- days exist in the entire table. So the query counted stragglers from a pool
-- that had already been emptied, and `net` subtracted an outflow that was not
-- there to subtract.
--
-- Inferring a departure from the absence of a row cannot work when the row is
-- what gets removed. The event has to be recorded when it happens.
--
-- IT ALREADY IS. job_board_closures has logged every closure since 2026-07-14,
-- with closed_at and — better — `superseded`, which marks a posting that came
-- down while an identical title stayed live at the same employer. That is a
-- re-list, not a role going away, and counting the two together would overstate
-- how much hiring actually stopped. The board draws that distinction everywhere
-- else; this now draws it too.
--
--   intake      rows first seen in the window
--   closed      closure events logged in the window  <- the real outtake
--   superseded  of those, re-lists rather than genuine closures
--   net         intake - closed
--
-- `aged_out` is GONE rather than fixed. There is no honest version of it: a row
-- that leaves the window is pruned in the same pass that logs its closure, so
-- it is already counted in `closed`. Keeping a second, nearly-always-zero field
-- would only invite the same misreading again.
--
-- SECURITY DEFINER, deliberately and narrowly. job_board_closures is not
-- readable by anon (PostgREST returns 400), and it should stay that way — the
-- lifecycle log is the one asset here nobody else can reproduce. This function
-- returns AGGREGATE COUNTS ONLY, never a row, so it exposes the shape of the
-- flow without exposing the log. search_path is pinned; the codebase has been
-- bitten before by definer functions that were broader than intended.

DROP FUNCTION IF EXISTS public.get_board_flow(integer);

CREATE OR REPLACE FUNCTION public.get_board_flow(p_hours integer DEFAULT 24)
RETURNS TABLE (
  window_hours integer,
  intake bigint,
  closed bigint,
  superseded bigint,
  net bigint,
  serving bigint,
  computed_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH w AS (SELECT GREATEST(1, LEAST(COALESCE(p_hours, 24), 720)) AS h),
  b AS (SELECT now() - make_interval(hours => (SELECT h FROM w)) AS since),
  i AS (SELECT count(*) AS n FROM public.job_board_postings
          WHERE first_seen >= (SELECT since FROM b)),
  c AS (SELECT count(*) AS n,
               count(*) FILTER (WHERE superseded) AS sup
          FROM public.job_board_closures
          WHERE closed_at >= (SELECT since FROM b)),
  s AS (SELECT count(*) AS n FROM public.job_board_postings
          WHERE missing_since IS NULL
            AND effective_posted >= now() - interval '30 days')
  SELECT (SELECT h FROM w)::integer,
         (SELECT n FROM i)::bigint,
         (SELECT n FROM c)::bigint,
         (SELECT sup FROM c)::bigint,
         ((SELECT n FROM i) - (SELECT n FROM c))::bigint,
         (SELECT n FROM s)::bigint,
         now();
$$;

COMMENT ON FUNCTION public.get_board_flow(integer) IS
  'Intake vs outtake over the last N hours (default 24, max 720). `closed` comes '
  'from the closure log, not from the absence of a row — rows past the serving '
  'window are pruned, so absence cannot be counted. `superseded` is the subset '
  'that came down while an identical title stayed live at the same employer: a '
  're-list, not a role going away. Aggregates only; the log itself stays private.';

GRANT EXECUTE ON FUNCTION public.get_board_flow(integer) TO anon, authenticated;

-- The closure count filters on closed_at alone. The existing index is
-- (company_token, closed_at DESC), which cannot serve a bare time range — the
-- leading column is wrong. Without this the count seq-scans the whole log, and
-- the log only grows.
CREATE INDEX IF NOT EXISTS job_board_closures_closed_at_idx
  ON public.job_board_closures (closed_at DESC);
