-- A GUARD WENT GREEN WHILE PRODUCTION KEPT THE FALSEHOOD.
--
-- 20260907010000 shipped get_actively_hiring_companies with a COMMENT that
-- described at_risk_14d as "the common denominator the rate is computed
-- against". It is not: at_risk_14d is sum(cnt) WHERE tt >= 14 -- the SURVIVORS
-- at day 14. fill_incidence_14d is an Aalen-Johansen cumulative incidence,
-- which accumulates over the whole entering cohort, so the survivors are a
-- strict subset of the denominator and dividing by them overstates. Measured
-- against the live function 2026-09-07: EIGHT of fourteen returned rows have
-- fills_le_14d > at_risk_14d (Ubc 207/120, Schnucks 293/194, BBVA 209/54 =
-- 387%) while the rates sit between 0.40 and 0.60. A reader doing the
-- arithmetic the comment invited gets >100% and concludes the rate is broken.
--
-- THE PROCESS ERROR IS THE REASON THIS FILE EXISTS. The correction was first
-- made by EDITING 20260907010000 itself -- after that migration had already
-- been applied. Editing an applied migration changes nothing in the database:
-- the live COMMENT stayed wrong, the file stopped matching what ran, and the
-- guard (which reads the file) went green over a production falsehood. That is
-- the same shape as every defect this schema was rewritten to remove, arriving
-- through the deploy process instead of through the SQL. 20260907010000 has
-- been restored byte-for-byte to what was applied; the correction lives here,
-- in a statement that actually executes.
--
-- COMMENT ON FUNCTION replaces the whole comment, so this restates every
-- column rather than patching one line -- the same reason CREATE OR REPLACE
-- replaces a whole function body.

DO $$
DECLARE prev text;
BEGIN
  SELECT obj_description(p.oid, 'pg_proc') INTO prev
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_actively_hiring_companies'
  LIMIT 1;

  IF prev IS NULL THEN
    RAISE NOTICE 'get_actively_hiring_companies has no comment to correct; skipping';
    RETURN;
  END IF;

  -- Replace only the misnaming, leaving the other eighteen column notes as
  -- 20260907010000 wrote them. If the phrase is absent the migration is a
  -- no-op, so re-running it is safe and a future rewrite is not clobbered.
  IF position('denominator the rate is computed against' in prev) = 0 THEN
    RAISE NOTICE 'the misnaming is already gone; leaving the comment as-is';
    RETURN;
  END IF;

  EXECUTE format(
    'COMMENT ON FUNCTION public.get_actively_hiring_companies(int) IS %L',
    replace(
      prev,
      '(15) at_risk_14d: observations still at risk at day 14 -- the common denominator the rate is computed against. ',
      '(15) at_risk_14d: observations STILL AT RISK at day 14 -- survivors, '
      'i.e. sum(cnt) WHERE tt >= 14. IT IS NOT THE DENOMINATOR OF '
      'fill_incidence_14d AND DIVIDING BY IT IS WRONG: a cumulative incidence '
      'accumulates over the whole entering cohort, so fills_le_14d / '
      'at_risk_14d routinely exceeds 1 (live 2026-09-07: Ubc 207/120, BBVA '
      '209/54) while the rate is 0.4-0.6. It is published as the SAMPLE-SIZE '
      'GATE the caller checks (>= 25), never as a quantity to divide by. '
    )
  );
END $$;
