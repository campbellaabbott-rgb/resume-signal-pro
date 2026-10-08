-- THE TAKEDOWN TICKER NO LONGER SAYS THE CHANGE FEED COUNTS HIGHER.
--
-- get_takedowns_today()'s description (20261002113617) told a reader that
-- /v1/changes does not expose the doubted-batch flag, so a consumer rebuilding
-- the ticker from the feed would count higher. From API version 2026-10-08.1
-- (register 1.70 / L13-56, the owner's decision of 2026-10-07) the feed leaves
-- those batches out by default and marks them suspectBatch when a caller asks
-- for them, so that sentence went false the moment public-api shipped. This
-- restates the description with that one sentence corrected; the body, the
-- grants and every other sentence are unchanged.
--
-- COMMENT ONLY: no function is created, replaced or re-granted, so nothing a
-- caller can execute changes. Safe to re-run. APPLY ORDER: after public-api
-- 2026-10-08.1 is serving (the sentence describes that build).

COMMENT ON FUNCTION public.get_takedowns_today() IS
  'Non-superseded closures logged since midnight UTC -- an events-per-day '
  'RATE, dated entirely by closed_at. SECURITY DEFINER because '
  'job_board_closures is service_role-only; as INVOKER it returns 0 with a '
  '200, which is indistinguishable from a quiet day (20260820174500). '
  'EXCLUDES batches the collector flagged as possible read failures of its '
  'own (suspect), the filter closed_90d and the weekly series apply, since '
  '20261002113617: before it this counter read 130,373 on a day the admitted '
  'rate was a fraction of that. /v1/changes leaves the same batches out by '
  'default since API version 2026-10-08.1 (include_suspect=true returns them '
  'marked suspectBatch), so a default walk of the feed, with re-listed and '
  'closedAtIsObservation rows dropped, counts on the same rules as this '
  'figure, except that this figure also counts the sources /v1 may not '
  'redistribute: the feed can count lower by those, never higher. '
  'ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. It is a count of events, '
  'never a dated one -- see COMMENT ON COLUMN '
  'public.job_board_closures.absence_basis, and get_closure_population() '
  'for how many such rows exist. '
  'This is the surface a backlog would distort most visibly: one board''s '
  'first lap could multiply today''s figure several-fold with takedowns '
  'that happened over the preceding month.';

-- The end state, read back from the catalogue: the description names the
-- feed's opt-in and keeps the absence-basis paragraph the closure guards rely
-- on. Anything else rolls the file back.
DO $$
DECLARE
  d text := obj_description(to_regprocedure('public.get_takedowns_today()'), 'pg_proc');
BEGIN
  IF d IS NULL THEN
    RAISE EXCEPTION 'get_takedowns_today: no description after the COMMENT (does the function exist?)';
  END IF;
  IF position('include_suspect=true' IN d) = 0 OR position('ADMITTED ABSENCE BASES' IN d) = 0 THEN
    RAISE EXCEPTION 'get_takedowns_today: the description did not land as written: %', left(d, 200);
  END IF;
END $$;
