-- A TEAMTAILOR PAGE OF A HUNDRED WROTE TAKEDOWNS NOBODY MADE.
--
-- Sweep S8-002 (2026-10-08). job-board .92 fixes the cause; this file marks
-- what the cause already wrote, the way 20261005100000 did for Workday. Apply
-- it AFTER job-board answers status.version 2026-09-09.92
-- (docs/job-board-deploy-notes.md, .92), or the old bundle keeps writing rows
-- of the same kind past the ceiling below; re-running the file then marks them.
--
-- WHAT HAPPENED. A Teamtailor jobs.rss serves 100 items a page and pages with
-- ?offset=N. Until .92 the collector made one GET and took it for the whole
-- board. On a board of more than 100 postings each new posting pushed a stored
-- row past item 100; that row was stamped missing, closed after the grace as
-- an unsuspect employer takedown (absence_basis 'full_read'; NULL before the
-- column) and deleted. batchSuspect could not see it: the feed served a full
-- 100.
--
-- WHICH ROWS. A Teamtailor 'full_read' (or pre-basis) closure on a board known
-- to serve more than one page, from two places:
--   - the 82 boards whose jobs.rss had items at offset 100 when all 2,274
--     catalogued boards were probed on 2026-10-08 (inlined below with the size
--     each walked to; 22 boards answered 404 and one 400);
--   - any day of the board_state history (from 2026-09-06) on which a
--     teamtailor board held more than 100 rows or served 100 fresh ones.
-- How this over-marks: a board that grew past 100 after a closure it really
-- read whole, and a board of exactly 100. Those closures leave the estimator
-- with the rest (suspect is excluded by every reader), the cautious direction
-- for a table sold as "the employer took the role down".
--
-- WRITTEN BEFORE .92 ONLY. .92 reads these boards in pages and its own
-- 'full_read' closures are real takedowns. The bundle stamps
-- job_board_meta.slice_stats {build, buildSince}: its version and the earliest
-- start of a slice it fetched in (status.sliceStats shows both). Only closures
-- with closed_at (the moment the row was written) before buildSince + 5
-- minutes are marked; the slack covers an old-bundle slice still in flight
-- when .92 started (a slice's wall is 2 minutes), so .92's closures of its
-- first five minutes are marked too. With no stamp of .92 or later (applied
-- before .92 has finished a slice) every closure up to the ceiling is marked,
-- all of them old-bundle closures, and the file must be re-run once .92
-- serves. Also over-marked: .92's closures written before a later build
-- (.93+) re-stamped buildSince, if the file is first applied after that, and
-- those of a .92 slice that died before its stamp. All are listed under the
-- same repair name, and each one closed after the bound's own buildSince can be
-- told apart by closed_at.
--
-- A CEILING, as in 20261005100000: the rule is applied to the closures that
-- exist when the block starts (event_id <= the max read first), the check
-- covers the same set, and a second pass catches a closure committed just
-- behind the ceiling.
--
-- REVERSIBLE. Every row marked is listed in job_board_closure_repairs under
-- 'teamtailor_rss_page_s8_002':
--   UPDATE public.job_board_closures c SET suspect = false
--     FROM public.job_board_closure_repairs r
--    WHERE r.event_id = c.event_id AND r.repair = 'teamtailor_rss_page_s8_002';
-- RE-RUNNABLE (IF NOT EXISTS, ON CONFLICT DO NOTHING, a suspect guard).
--
-- NOT DONE HERE. The paired job_board_exits rows (exit_reason 'removed') have
-- no suspect column and stay. The deleted postings come back with .92's paged
-- reads, under a new first_seen.

CREATE TABLE IF NOT EXISTS public.job_board_closure_repairs (
  event_id  bigint PRIMARY KEY,
  repair    text NOT NULL,
  marked_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_board_closure_repairs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_board_closure_repairs FROM PUBLIC;
REVOKE ALL ON public.job_board_closure_repairs FROM anon;
REVOKE ALL ON public.job_board_closure_repairs FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.job_board_closure_repairs TO service_role;

SET LOCAL statement_timeout = '15min';

DO $$
DECLARE
  v_tokens  text[];
  v_ceiling bigint;
  v_left    bigint := 0;
  v_pass    int := 0;
  v_marked  bigint;
  v_unmarked_listed bigint;
  v_build   text;
  v_since   text;
  v_bound   timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.job_board_closure_repairs'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'self-verify 20261009100300: job_board_closure_repairs does not have row-level security on';
  END IF;
  IF has_table_privilege('anon', 'public.job_board_closure_repairs', 'SELECT')
     OR has_table_privilege('anon', 'public.job_board_closure_repairs', 'INSERT')
     OR has_table_privilege('authenticated', 'public.job_board_closure_repairs', 'SELECT')
     OR has_table_privilege('authenticated', 'public.job_board_closure_repairs', 'INSERT') THEN
    RAISE EXCEPTION 'self-verify 20261009100300: job_board_closure_repairs is readable or writable by anon or authenticated';
  END IF;

  -- The boards known to serve more than one page. Read once, so the marking
  -- and the check judge the same list.
  SELECT array_agg(DISTINCT t.company_token ORDER BY t.company_token)
    INTO v_tokens
    FROM (
      SELECT company_token
        FROM public.job_board_board_state
       WHERE source = 'teamtailor' AND (stored_count > 100 OR live_count >= 100)
      UNION ALL
      -- Measured 2026-10-08: items at jobs.rss?offset=100, and where each walk ended.
      SELECT m.company_token
        FROM (VALUES
            ('abdulrauf1-1741255834', 234), ('academee', 592), ('advantagemedicalstaffing', 127), ('alehop', 158), ('anicuraglobal', 642),
            ('apirestauration', 202), ('aromazone', 163), ('atlantiqueautomatismesincendie', 126), ('autohellasgroup', 115), ('autolivgroup', 342),
            ('axiansgroup', 112), ('bluestorm', 166), ('bmesproductionaccount', 204), ('capiosverigeab', 159), ('cartrackasiacareerpage', 254),
            ('chalhoubgroup', 131), ('ckw', 223), ('davidkennedyrecruitment', 141), ('districom', 144), ('dmf', 390),
            ('ecm-crit', 167), ('ekium-1706706638', 238), ('endel', 176), ('etam', 121), ('eutalents', 2600),
            ('eworgmbh', 250), ('eyesandmoregmbh-1681220218', 443), ('footasylum', 143), ('groupeberto', 232), ('groupeetam', 255),
            ('groupeguisnel', 103), ('groupelrtechnologies', 191), ('grupoclave', 247), ('grupoysondos', 106), ('huaweidusseldorf-1719303222', 233),
            ('iki-1732802603', 309), ('itmtanzanialimited', 316), ('jobandtalent', 121), ('jobtalentfrance', 311), ('kidsandus', 377),
            ('knightecgroup', 148), ('knowmadmood', 341), ('lacotelarete', 108), ('lagardere', 156), ('leroymerlinpoland', 221),
            ('leroymerlinspain', 282), ('letuelezioni', 865), ('libra', 160), ('loverecruitmentuk', 167), ('lrgcareers', 104),
            ('luminorbank', 105), ('metaline', 125), ('miogruppen', 187), ('multitempo', 330), ('nachhilfeunterricht', 276),
            ('naffco', 112), ('neo2consultant', 356), ('nested', 130), ('ocaglobal', 240), ('orbia', 268),
            ('praesidium', 106), ('providentmexico', 105), ('qualacompany', 202), ('rdtingenieros', 200), ('sacyr', 241),
            ('sdworxgroup', 167), ('sdworxnv', 148), ('seneringenieria', 200), ('smartsanteconseil', 170), ('spacenk', 154),
            ('storallearning', 212), ('synergym', 218), ('synsamgroup', 110), ('teamviewer', 144), ('temporing', 451),
            ('tipgroup', 177), ('tutoringjobs', 534), ('vardaga', 182), ('veterankraftab', 272), ('vincienergiesuk', 136),
            ('wsa3', 116), ('wspcentraleurope', 200)
        ) AS m(company_token, walked)
    ) t;
  IF coalesce(array_length(v_tokens, 1), 0) < 82 THEN
    RAISE EXCEPTION 'self-verify 20261009100300: only % Teamtailor board(s) named; the 82 measured boards alone are more', coalesce(array_length(v_tokens, 1), 0);
  END IF;

  SELECT coalesce(max(event_id), 0) INTO v_ceiling FROM public.job_board_closures;

  -- The upper time bound: .92 (or a later build) has stamped when it began.
  SELECT m.v ->> 'build', m.v ->> 'buildSince' INTO v_build, v_since
    FROM public.job_board_meta m WHERE m.k = 'slice_stats';
  IF v_build ~ '^\d{4}-\d{2}-\d{2}\.\d{1,6}$' AND v_since ~ '^\d{4}-\d{2}-\d{2}T' THEN
    IF split_part(v_build, '.', 1) > '2026-09-09'
       OR (split_part(v_build, '.', 1) = '2026-09-09' AND split_part(v_build, '.', 2)::int >= 92) THEN
      v_bound := v_since::timestamptz + interval '5 minutes';
    END IF;
  END IF;

  LOOP
    v_pass := v_pass + 1;

    INSERT INTO public.job_board_closure_repairs (event_id, repair)
    SELECT c.event_id, 'teamtailor_rss_page_s8_002'
      FROM public.job_board_closures c
     WHERE c.event_id <= v_ceiling
       AND (v_bound IS NULL OR c.closed_at < v_bound)
       AND c.source = 'teamtailor'
       AND c.company_token = ANY (v_tokens)
       AND (c.absence_basis = 'full_read' OR c.absence_basis IS NULL)
       AND c.suspect IS NOT TRUE
    ON CONFLICT (event_id) DO NOTHING;

    UPDATE public.job_board_closures c
       SET suspect = true
      FROM public.job_board_closure_repairs r
     WHERE r.event_id = c.event_id
       AND r.repair = 'teamtailor_rss_page_s8_002'
       AND c.suspect IS NOT TRUE;

    SELECT count(*) INTO v_left
      FROM public.job_board_closures c
     WHERE c.event_id <= v_ceiling
       AND (v_bound IS NULL OR c.closed_at < v_bound)
       AND c.source = 'teamtailor'
       AND c.company_token = ANY (v_tokens)
       AND (c.absence_basis = 'full_read' OR c.absence_basis IS NULL)
       AND c.suspect IS NOT TRUE;
    EXIT WHEN v_left = 0 OR v_pass >= 3;
  END LOOP;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'self-verify 20261009100300: % Teamtailor closure(s) at or under event_id % were left unmarked after % passes', v_left, v_ceiling, v_pass;
  END IF;

  SELECT count(*) INTO v_unmarked_listed
    FROM public.job_board_closure_repairs r
    JOIN public.job_board_closures c ON c.event_id = r.event_id
   WHERE r.repair = 'teamtailor_rss_page_s8_002' AND c.suspect IS NOT TRUE;
  IF v_unmarked_listed > 0 THEN
    RAISE EXCEPTION 'self-verify 20261009100300: % listed closure(s) are still not suspect', v_unmarked_listed;
  END IF;

  IF v_bound IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.job_board_closure_repairs r
         JOIN public.job_board_closures c ON c.event_id = r.event_id
        WHERE r.repair = 'teamtailor_rss_page_s8_002' AND r.marked_at = now() AND c.closed_at >= v_bound) THEN
    RAISE EXCEPTION 'self-verify 20261009100300: this run listed a closure written after %, which .92 or later wrote', v_bound;
  END IF;

  SELECT count(*) INTO v_marked FROM public.job_board_closure_repairs WHERE repair = 'teamtailor_rss_page_s8_002';
  RAISE NOTICE 'self-verify 20261009100300: % Teamtailor closure(s) written while one page of 100 was read as the whole board are marked suspect and listed in job_board_closure_repairs (% boards named, ceiling event_id %, %)', v_marked, array_length(v_tokens, 1), v_ceiling,
    CASE WHEN v_bound IS NULL THEN 'no .92 stamp on slice_stats yet: every closure to the ceiling, re-run once .92 serves'
         ELSE 'closed before ' || v_bound::text || ' (build ' || v_build || ' began ' || v_since || ')' END;
END $$;
