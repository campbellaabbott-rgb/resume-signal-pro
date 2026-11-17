-- lovable-cron-fallback-reviewed: no cron; this file schedules nothing (reviewed 2026-11-17 in the board .103 integration).
--
-- THE CATALOGUE HIGH-WATER FOLLOWS THE DEAD-BOARD PRUNE.
--
-- job-board 2026-09-09.103 carries fewer boards than the 44,499 of .102, on
-- purpose: it prunes the dead entries on vendors whose robots and terms allow
-- our read (boards a second read on 2026-11-17 or later still found dead, and
-- that served 0 rows before the merge), and it retires lever:usasurveyjob, a
-- paid-survey ad feed under the owner's OD1(a) junk and aggregator bar. The
-- repoints move a board to its employer's live vendor in place, so they change
-- no count.
--
-- WHY THE MARK HAS TO MOVE. The orphan prune refuses to run from a bundle whose
-- catalogue is smaller than the largest one ever deployed (the stale-bundle
-- guard of 2026-07-15), and it cannot tell an intentional removal from a stale
-- deploy. Left at .102's 44,499 the mark blocks the prune for good: status
-- reads orphanPruneBlocked true, usasurveyjob's rows keep serving until the
-- 30-day age-out, and the pass-end exit .103 gives the held boards never runs,
-- since it runs only while the prune is unblocked.
--
-- THE LITERAL IS THE MERGED TIP'S CATALOGUE. The clamp and the self-check
-- below carry JOB_SOURCES.length at the tip that merges as .103, written as
-- one number in the form the guard in a-demo-board-is-not-an-employer.test.ts
-- parses. src/test/the-board-103-high-water-follows-the-prune.test.ts fails
-- while either literal is any other number, so a catalogue change after this
-- file was written fails there until both are set again. It is the only clamp
-- that tracks the catalogue: .102's 20261111120000 is applied and is pinned to
-- the 44,499 it ran with.
--
-- THE SAME SHAPE AS 20261111120000, DELIBERATELY: a literal clamp under a
-- refusal and over a self-check.
--
-- ORDER: AFTER job-board 2026-09-09.103 serves and has sliced
-- (docs/deploy-ledger.json migrationOrder, a slice: rule). Applied while .102
-- still serves, the next pass end of the 44,499-board bundle raises the mark
-- straight back, and .103 then starts blocked. An OPTIONS answer of .103 comes
-- minutes before .102's last hop has finished, so the file refuses (REFUSAL,
-- below) unless job_board_meta.slice_stats names 2026-09-09.103 or later: the
-- job-board status action's sliceStats.build, which .103's first slice
-- writes. If it refuses, wait for that slice and apply this same file again,
-- unedited. Applied after, a bundle larger than the mark is, by the guard's
-- own rule, never treated as stale, so a later and larger catalogue raises it
-- again by itself. A rollback to .102 needs no undo for the same reason.
--
-- IDEMPOTENT: LEAST() lowers and never raises, so a second run is a no-op. The
-- self-check reads only the row this file writes. No table is created and no
-- privilege changes.
--
-- PROOF IS EXTERNAL AND NAMED: two hours after this file, status reports
-- catalogSize equal to the merged tip's JOB_SOURCES.length, catalogHighwater
-- equal to catalogSize and orphanPruneBlocked false; after the next completed
-- pass, a pruned key and usasurveyjob serve no row
-- (scripts/verify-deploy.d/99zzzzzzzz-board-103.sh, lines PR1, PR2 and RT1).

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '1min';

-- REFUSAL. Raises, and so changes nothing, until a slice of .103 or later has
-- written job_board_meta.slice_stats; no row at all refuses too.
DO $$
DECLARE
  v_build text;
BEGIN
  SELECT m.v ->> 'build' INTO v_build FROM public.job_board_meta m WHERE m.k = 'slice_stats';
  IF NOT coalesce(CASE WHEN v_build ~ '^\d{4}-\d{2}-\d{2}\.\d{1,6}$' THEN
         split_part(v_build, '.', 1) > '2026-09-09'
         OR (split_part(v_build, '.', 1) = '2026-09-09' AND split_part(v_build, '.', 2)::int >= 103) END, false) THEN
    RAISE EXCEPTION '20261117110000: job_board_meta.slice_stats names build %, not job-board 2026-09-09.103 or later (applied while .102 still slices, its next pass end raises the mark straight back). Wait until the job-board status action''s sliceStats.build reads 2026-09-09.103 (the first slice after the deploy writes it), then apply the same file again, unedited', coalesce(v_build, '(none)');
  END IF;
END $$;

UPDATE public.job_board_meta
SET v = jsonb_set(v, '{size}', to_jsonb(LEAST((v->>'size')::int, 44499))),
    updated_at = now()
WHERE k = 'catalog_highwater';

-- SELF-CHECK. Raises, and so rolls the update back, if the mark is still above
-- the catalogue .103 carries. A database with no mark (no row, or no size in
-- it) has nothing to block the prune with: the bundle reads that as 0.
DO $$
DECLARE
  mark int;
BEGIN
  SELECT (v->>'size')::int INTO mark FROM public.job_board_meta WHERE k = 'catalog_highwater';
  IF NOT FOUND THEN
    RAISE NOTICE 'self-check 20261117110000: no catalogue high-water row yet; the first pass end of the bundle writes one';
    RETURN;
  END IF;
  IF mark > 44499 THEN
    RAISE EXCEPTION 'self-check 20261117110000: the catalogue high-water is %, above the 44499 boards job-board 2026-09-09.103 carries, so the orphan prune stays blocked', mark;
  END IF;
  RAISE NOTICE 'self-check 20261117110000: the catalogue high-water is % (at most 44499)', mark;
END $$;
