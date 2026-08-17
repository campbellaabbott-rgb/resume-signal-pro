-- get_board_flow RETURNED 400 ON EVERY CALL. My bug, shipped in 20260818050000
-- and live until this lands.
--
--   {"code":"42702","message":"column reference \"superseded\" is ambiguous",
--    "details":"It could refer to either a PL/pgSQL variable or a table column."}
--
-- Rewriting the function from LANGUAGE sql to LANGUAGE plpgsql turned every name
-- in `RETURNS TABLE (...)` into an OUT PARAMETER that is in scope throughout the
-- body. One of them, `superseded`, is also a column on job_board_closures, and
-- the body said:
--
--     count(*) FILTER (WHERE superseded)          -- ambiguous: param or column?
--
-- In the previous LANGUAGE sql version this exact line was fine, because SQL
-- functions have no such parameter scope. The ambiguity was created by the
-- rewrite, not carried into it — which is why it survived a review of the
-- diff's logic: the changed line was correct in isolation and only became
-- ambiguous because of a declaration forty lines above it.
--
-- It also failed CLOSED and LOUD, which is the one good thing here: a 400 on
-- every call, caught on the first probe after deploy. The metric it replaced
-- failed OPEN — it returned a confident, wrong number for hours.
--
-- THE FIX IS THE GENERAL ONE, not the single line. Every table gets an alias and
-- every column reference is qualified through it, so no OUT parameter can ever
-- capture a column again no matter what the return shape is named later. The
-- collision list today is exactly one name; qualifying all of them costs nothing
-- and removes the class.
--
-- Behaviour is otherwise unchanged from 20260818050000. Same columns, same
-- semantics, same statement_timeout.

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
   WHERE c.closed_at >= since;

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
  SELECT count(*) INTO v_departed
    FROM public.job_board_exits e
   WHERE e.exited_at >= since
     AND e.exit_reason IN ('removed', 'aged_out', 'backdated', 'board_dormant', 'untracked');

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

GRANT EXECUTE ON FUNCTION public.get_board_flow(integer) TO anon, authenticated;
