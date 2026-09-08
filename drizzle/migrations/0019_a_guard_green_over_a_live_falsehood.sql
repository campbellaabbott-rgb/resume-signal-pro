-- A GUARD WENT GREEN WHILE PRODUCTION KEPT THE FALSEHOOD.
-- Corrects the COMMENT ON FUNCTION for get_actively_hiring_companies:
-- at_risk_14d is a survivor count / sample-size gate, not the rate's denominator.
-- No behaviour change, no return-type change, no DROP. Idempotent.

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