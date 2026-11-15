-- THE CATALOGUE HIGH-WATER FOLLOWS THE RETIREMENTS.
--
-- job-board 2026-09-09.102 carries 44,499 boards, 24 fewer than the 44,523 of
-- .101: the owner's OD1 retirements of 2026-11-08 (teamtailor eutalents,
-- workable toloka-ai, clients-blackbox-inc and huzzle, smartrecruiters
-- JobsForHumanity, recruitee vluchtelingenwerkvrijwilligers), the nine twin
-- boards whose every posting another catalogued board also lists (BB-05), and
-- the ten dead or duplicate boards of the 2026-10-24 coverage report
-- (PRUNE-1024): 25 boards out, and Convergint's Workday site in, appended last.
--
-- WHY THE MARK HAS TO MOVE. The orphan prune refuses to run from a bundle whose
-- catalogue is smaller than the largest one ever deployed (the stale-bundle
-- guard of 2026-07-15), and it cannot tell an intentional removal from a stale
-- deploy. Left at 44,523, the mark blocks the prune for good: status reads
-- orphanPruneBlocked true, and the retired boards' rows (3,269 eutalents rows
-- and 143 JobsForHumanity rows on 2026-11-15) keep serving until the 30-day
-- age-out, which is the wrong exit for a board retired on purpose.
--
-- THE SAME SHAPE AS 20260909220000, DELIBERATELY: a literal clamp, which the
-- guard in src/test/a-demo-board-is-not-an-employer.test.ts checks against the
-- catalogue the tree carries, and which
-- src/test/the-od1-charter-and-the-dedupe-leave-the-catalogue.test.ts pins to
-- JOB_SOURCES.length exactly.
--
-- ORDER: AFTER job-board 2026-09-09.102 serves and has sliced
-- (docs/deploy-ledger.json migrationOrder, a slice: rule). Applied while .101
-- still serves, the next pass end of the 44,523-board bundle raises the mark
-- straight back, and .102 then starts blocked. An OPTIONS answer of .102 comes
-- minutes before .101's last hop has finished, so the file refuses (REFUSAL,
-- below) unless job_board_meta.slice_stats names 2026-09-09.102 or later: the
-- job-board status action's sliceStats.build, which .102's first slice
-- writes. If it refuses, wait for that slice and apply this same file again,
-- unedited. Applied after, a bundle larger than the mark is, by the guard's
-- own rule, never treated as stale, so a later and larger catalogue raises it
-- again by itself.
--
-- IDEMPOTENT: LEAST() lowers and never raises, so a second run is a no-op. The
-- self-check reads only the row this file writes.
--
-- PROOF IS EXTERNAL AND NAMED: the next status read reports catalogSize
-- 44,499, catalogHighwater 44,499 and orphanPruneBlocked false, and after the
-- next completed pass a count of each retired board's rows, read by its vendor
-- and token, is 0 (scripts/verify-deploy.d/99zzzzzzz-board-102-catalogue.sh).

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '1min';

-- REFUSAL. Raises, and so changes nothing, until a slice of .102 or later has
-- written job_board_meta.slice_stats; no row at all refuses too.
DO $$
DECLARE
  v_build text;
BEGIN
  SELECT m.v ->> 'build' INTO v_build FROM public.job_board_meta m WHERE m.k = 'slice_stats';
  IF NOT coalesce(CASE WHEN v_build ~ '^\d{4}-\d{2}-\d{2}\.\d{1,6}$' THEN
         split_part(v_build, '.', 1) > '2026-09-09'
         OR (split_part(v_build, '.', 1) = '2026-09-09' AND split_part(v_build, '.', 2)::int >= 102) END, false) THEN
    RAISE EXCEPTION '20261111120000: job_board_meta.slice_stats names build %, not job-board 2026-09-09.102 or later (applied while .101 still slices, its next pass end raises the mark straight back). Wait until the job-board status action''s sliceStats.build reads 2026-09-09.102 (the first slice after the deploy writes it), then apply the same file again, unedited', coalesce(v_build, '(none)');
  END IF;
END $$;

UPDATE public.job_board_meta
SET v = jsonb_set(v, '{size}', to_jsonb(LEAST((v->>'size')::int, 44499))),
    updated_at = now()
WHERE k = 'catalog_highwater';

-- SELF-CHECK. Raises, and so rolls the update back, if the mark is still above
-- the catalogue .102 carries. A database with no mark (no row, or no size in
-- it) has nothing to block the prune with: the bundle reads that as 0.
DO $$
DECLARE
  mark int;
BEGIN
  SELECT (v->>'size')::int INTO mark FROM public.job_board_meta WHERE k = 'catalog_highwater';
  IF NOT FOUND THEN
    RAISE NOTICE 'self-check 20261111120000: no catalogue high-water row yet; the first pass end of the bundle writes one';
    RETURN;
  END IF;
  IF mark > 44499 THEN
    RAISE EXCEPTION 'self-check 20261111120000: the catalogue high-water is %, above the 44499 boards job-board 2026-09-09.102 carries, so the orphan prune stays blocked', mark;
  END IF;
  RAISE NOTICE 'self-check 20261111120000: the catalogue high-water is % (at most 44499)', mark;
END $$;
