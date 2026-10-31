-- SIX ICIMS BOARDS KEEP ONLY THEIR OWN BRAND OR HIRER.
--
-- Trust round 3 (the round-2 plan, item 2; ~/.config/resumebooster/trust-round-2/icims).
-- Three pairs of catalogued iCIMS hosts each read one shared feed, unfiltered,
-- so each page of a pair listed the other employer's roles under its own name:
--   - careers.delmarva.com ("Exelon") and careers.comed.com ("ComEd") read
--     Exelon's feed of seven brands. The feed filters by &brand= on the
--     server, and every brand applies on its own portal (careers-exeloncorp,
--     careers-comed, careers-bge, careers-delmarva, careers-atlanticcityelectric,
--     careers-peco, careers-pepco .icims.com; read 2026-10-26);
--   - careers.baycenterfoods.com ("Chick-fil-A") and careers.chick-fil-a.com
--     ("Chick-fil-A Supply LLC") read one feed whose hiring_organization says
--     which of the two each posting is (careers-chickfila and
--     canadacareers-chickfila for Chick-fil-A, Inc.; careers-cfasupply for
--     Chick-fil-A Supply LLC), with no brand filter;
--   - careers.ynvgroup.com ("YNV Group") and careers.monifai.com
--     ("Teknowledge"), the same shape (careers-ynvgroup, careers-teknowledge).
--
-- job-board 2026-09-09.96 reads the two Exelon boards one brand each
-- (`brand`, &brand= on the feed URL) and the other four one hiring_organization
-- each (`org`, kept after the read). Four duplicate hosts whose feed is one
-- employer's leave the catalogue (careers.bpas.com, careers.keysight.com,
-- careers.goldennugget.com, talent.lla.com); their catalogue places now hold
-- four Exelon brand boards, so no other board's index moves, and their rows
-- leave through the orphan prune as 'untracked'. This file moves the rows that
-- are now another board's (or, for Delmarva Power, no board's: its 3 postings
-- are not carried) off the six boards, through job_board_exits as
-- 'untracked', the reason for a row that left by OUR action (the shape of
-- 20260909216000), never through job_board_closures: each is still open.
--
-- AND ONE STORE'S COUNTRY. Kohl's store 1250 at "Lake Wales (1250)" was filed
-- GB, the Welsh reading of a Florida town. .96 reads that string as no
-- country at all, and a reading of none never overwrites a stored one, so the
-- store's rows take the country Workday's own record gives it (R504030,
-- alpha2Code US, read 2026-10-26): every Kohl's row stored with that location
-- and GB. On 2026-10-26 the board served two (R504030, open at the vendor, and
-- R503656, which the vendor answers 404 for and which leaves at its board's
-- next proven lap or the 30-day fence).
--
-- APPLY AFTER job-board 2026-09-09.96 SERVES (docs/deploy-ledger.json
-- migrationOrder), and after its first slice: the file refuses unless
-- job_board_meta.slice_stats names .96 or later (the job-board status action's
-- sliceStats.build), which the first slice after the deploy writes. Run while
-- an older build serves, the unscoped read puts the rows back on its next
-- visit. If it refuses, wait for that slice and apply this same file again,
-- unedited.
--
-- THE RACE THE ORDER LEAVES. Between the deploy and this file, a scoped read
-- that reaches one of the six boards stamps the other employer's rows missing
-- and, after the grace, closes them as takedowns: on today's boards that is 2
-- of Teknowledge's 9 rows and 8 of Chick-fil-A Supply's 26, and the engine's
-- own suspect mark catches neither (it marks a batch only when the share is
-- implausible and the feed came back short). They are marked suspect here and listed
-- in job_board_closure_repairs under 'icims_scope_trust_round_3', judged by
-- the requisition, never by the batch alone: a closure on one of the six
-- boards since 30 minutes before .96's first slice (buildSince; why, below)
-- whose requisition a board of the same feed
-- still stores with an apply link on another brand's or hirer's portal of
-- that board's feed. That is checked before the move below, while those rows
-- are still stored. A real takedown is never marked by it, even beside a
-- stale copy on the other board: that copy applies on the closing board's own
-- portal. One fallback, on the Exelon pair only: a requisition no board of the
-- feed stores (Delmarva Power's 3, which no board carries, or one whose every
-- copy was closed) is marked when its batch took more than 30% of the board.
-- The Chick-fil-A and YNV feeds have no such brand, so they have no fallback.
--
-- WHY 30 MINUTES BEFORE THE FIRST SLICE. job-board keeps buildSince only while
-- the build that wrote slice_stats last is its own (firstSliceOf): a slice of
-- the older build that began before the deploy and stamps after .96's first
-- slice flips the record back, and .96's next slice restarts buildSince at
-- its own start, so closures .96 wrote in between would fall before the bound
-- (land/all recheck, 2026-10-27). A slice stops its board loop at 120 s
-- (SLICE_WALL_BUDGET_MS) and stamps right after it, and the refresh crons
-- start one every 5 minutes, so the reset moves buildSince by minutes. Under
-- the older build's unscoped read every board of a feed stored every
-- requisition, so a real takedown closed it everywhere and no other portal's
-- copy remains to mark it by: the 30 minutes add no false mark through the
-- requisition test, and only the Exelon fallback's batch test can mark a real
-- takedown in them, listed and reversible like every other.
-- Reversible:
--   UPDATE public.job_board_closures c SET suspect = false
--     FROM public.job_board_closure_repairs r
--    WHERE r.event_id = c.event_id AND r.repair = 'icims_scope_trust_round_3';
--
-- RE-RUNNABLE: a second run finds nothing to move, nothing to mark and no row
-- to place. No table is created here (job_board_closure_repairs is
-- 20261025110000's, revoked from anon and authenticated).

SET LOCAL statement_timeout = '5min';

DO $$
DECLARE
  v_build   text;
  v_since   text;
  v_bound   timestamptz;
  v_ids     text[];
  v_moved   int := 0;
  v_marked  int := 0;
  v_placed  int := 0;
  v_left    int;
  v_now     timestamptz := now();
  -- Each board loses the rows that apply on another brand's or hirer's portal
  -- of its own feed; a row on a portal not named here stays.
  v_scope   jsonb := jsonb_build_object(
    'careers.delmarva.com', jsonb_build_array('careers-comed.icims.com', 'careers-bge.icims.com', 'careers-delmarva.icims.com',
                                              'careers-atlanticcityelectric.icims.com', 'careers-peco.icims.com', 'careers-pepco.icims.com'),
    'careers.comed.com', jsonb_build_array('careers-exeloncorp.icims.com', 'careers-bge.icims.com', 'careers-delmarva.icims.com',
                                           'careers-atlanticcityelectric.icims.com', 'careers-peco.icims.com', 'careers-pepco.icims.com'),
    'careers.baycenterfoods.com', jsonb_build_array('careers-cfasupply.icims.com'),
    'careers.chick-fil-a.com', jsonb_build_array('careers-chickfila.icims.com', 'canadacareers-chickfila.icims.com'),
    'careers.ynvgroup.com', jsonb_build_array('careers-teknowledge.icims.com'),
    'careers.monifai.com', jsonb_build_array('careers-ynvgroup.icims.com'));
  -- The boards that read each scoped board's feed, itself included: a closure's
  -- requisition is looked for on all of them.
  v_feed    jsonb := jsonb_build_object(
    'careers.delmarva.com', jsonb_build_array('careers.delmarva.com', 'careers.comed.com', 'careers.bge.com', 'careers.peco.com',
                                              'careers.pepco.com', 'careers.atlanticcityelectric.com'),
    'careers.comed.com', jsonb_build_array('careers.delmarva.com', 'careers.comed.com', 'careers.bge.com', 'careers.peco.com',
                                           'careers.pepco.com', 'careers.atlanticcityelectric.com'),
    'careers.baycenterfoods.com', jsonb_build_array('careers.baycenterfoods.com', 'careers.chick-fil-a.com'),
    'careers.chick-fil-a.com', jsonb_build_array('careers.baycenterfoods.com', 'careers.chick-fil-a.com'),
    'careers.ynvgroup.com', jsonb_build_array('careers.ynvgroup.com', 'careers.monifai.com'),
    'careers.monifai.com', jsonb_build_array('careers.ynvgroup.com', 'careers.monifai.com'));
  v_tokens  text[];
BEGIN
  SELECT m.v ->> 'build', m.v ->> 'buildSince' INTO v_build, v_since
    FROM public.job_board_meta m WHERE m.k = 'slice_stats';
  IF NOT (v_build ~ '^\d{4}-\d{2}-\d{2}\.\d{1,6}$' AND v_since ~ '^\d{4}-\d{2}-\d{2}T'
          AND (split_part(v_build, '.', 1) > '2026-09-09'
               OR (split_part(v_build, '.', 1) = '2026-09-09' AND split_part(v_build, '.', 2)::int >= 96))) THEN
    RAISE EXCEPTION 'self-check 20261026110000: job_board_meta.slice_stats names build %, not job-board 2026-09-09.96 or later (applied under an older build, its unscoped read puts the rows back). Wait until the job-board status action''s sliceStats.build reads 2026-09-09.96 (the first slice after the deploy writes it), then apply the same file again, unedited', coalesce(v_build, '(none)');
  END IF;
  -- 30 minutes before the first slice: an older slice stamping last can move
  -- buildSince later by minutes (WHY 30 MINUTES BEFORE THE FIRST SLICE, above).
  v_bound := v_since::timestamptz - interval '30 minutes';

  SELECT array_agg(k) INTO v_tokens FROM jsonb_object_keys(v_scope) k;

  -- The race closures, judged before the move while the evidence rows are stored.
  INSERT INTO public.job_board_closure_repairs (event_id, repair)
  SELECT c.event_id, 'icims_scope_trust_round_3'
    FROM public.job_board_closures c
   WHERE c.company_token = ANY (v_tokens)
     AND c.source = 'icims'
     AND c.closed_at >= v_bound
     AND c.suspect IS NOT TRUE
     AND (EXISTS (SELECT 1 FROM public.job_board_postings p
                   WHERE p.source = 'icims'
                     AND p.company_token IN (SELECT jsonb_array_elements_text(v_feed -> c.company_token))
                     AND split_part(p.id, ':', 3) = split_part(c.posting_id, ':', 3)
                     AND (v_scope -> c.company_token) ? coalesce(substring(p.apply_url from '^https?://([^/:?#]+)'), ''))
          OR (c.company_token IN ('careers.delmarva.com', 'careers.comed.com')
              AND NOT EXISTS (SELECT 1 FROM public.job_board_postings p
                               WHERE p.source = 'icims'
                                 AND p.company_token IN (SELECT jsonb_array_elements_text(v_feed -> c.company_token))
                                 AND split_part(p.id, ':', 3) = split_part(c.posting_id, ':', 3))
              AND c.batch_removed IS NOT NULL AND c.batch_live_before > 0
              AND c.batch_removed > 0.3 * c.batch_live_before))
  ON CONFLICT (event_id) DO NOTHING;

  UPDATE public.job_board_closures c
     SET suspect = true
    FROM public.job_board_closure_repairs r
   WHERE r.event_id = c.event_id
     AND r.repair = 'icims_scope_trust_round_3'
     AND c.suspect IS NOT TRUE;
  GET DIAGNOSTICS v_marked = ROW_COUNT;

  SELECT coalesce(array_agg(p.id), ARRAY[]::text[]) INTO v_ids
    FROM public.job_board_postings p
   WHERE p.source = 'icims'
     AND p.company_token = ANY (v_tokens)
     AND (v_scope -> p.company_token) ? coalesce(substring(p.apply_url from '^https?://([^/:?#]+)'), '');

  IF array_length(v_ids, 1) > 0 THEN
    INSERT INTO public.job_board_exits
      (posting_id, source, company_token, company, title, category, exit_reason,
       posted_at, days_on_board, origin_basis, exited_at,
       department, country, region_code, work_mode, employment_type,
       experience_band, min_years, salary_min_annual, salary_max_annual,
       salary_period, salary_currency)
    SELECT p.id, p.source, p.company_token, p.company, p.title,
           COALESCE(p.category, 'other'), 'untracked',
           p.posted_at,
           CASE WHEN p.posted_at IS NOT NULL
                  THEN round((extract(epoch FROM (v_now - p.posted_at)) / 86400.0)::numeric, 1)
                WHEN p.first_seen IS NOT NULL
                  THEN round((extract(epoch FROM (v_now - p.first_seen)) / 86400.0)::numeric, 1)
           END,
           CASE WHEN p.posted_at IS NOT NULL THEN 'stated'
                WHEN p.first_seen IS NOT NULL THEN 'discovered' END,
           v_now,
           p.department, p.country, p.region_code, p.work_mode, p.employment_type,
           p.experience_band, p.min_years, p.salary_min_annual, p.salary_max_annual,
           p.salary_period, p.salary_currency
      FROM public.job_board_postings p
     WHERE p.id = ANY (v_ids);
    DELETE FROM public.job_board_postings WHERE id = ANY (v_ids);
    v_moved := array_length(v_ids, 1);
  END IF;

  UPDATE public.job_board_postings
     SET country = 'US'
   WHERE source = 'workday'
     AND company_token = 'kohls~wd504~kohlscareers'
     AND location = 'Lake Wales (1250)'
     AND country = 'GB';
  GET DIAGNOSTICS v_placed = ROW_COUNT;

  -- SELF-CHECK. No row on the six boards applies on another portal of its
  -- feed, every listed closure is suspect, and no Kohl's row at the Lake Wales
  -- store is left GB.
  SELECT count(*) INTO v_left
    FROM public.job_board_postings p
   WHERE p.source = 'icims'
     AND p.company_token = ANY (v_tokens)
     AND (v_scope -> p.company_token) ? coalesce(substring(p.apply_url from '^https?://([^/:?#]+)'), '');
  IF v_left > 0 THEN
    RAISE EXCEPTION 'self-check 20261026110000: % row(s) on the six scoped iCIMS boards still apply on another portal of their feed', v_left;
  END IF;
  SELECT count(*) INTO v_left
    FROM public.job_board_closure_repairs r
    JOIN public.job_board_closures c ON c.event_id = r.event_id
   WHERE r.repair = 'icims_scope_trust_round_3' AND c.suspect IS NOT TRUE;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'self-check 20261026110000: % listed closure(s) are still not suspect', v_left;
  END IF;
  IF EXISTS (SELECT 1 FROM public.job_board_postings
              WHERE source = 'workday' AND company_token = 'kohls~wd504~kohlscareers'
                AND location = 'Lake Wales (1250)' AND country = 'GB') THEN
    RAISE EXCEPTION 'self-check 20261026110000: a Kohl''s row at Lake Wales (1250) is still filed GB';
  END IF;
  RAISE NOTICE 'self-check 20261026110000: % row(s) moved off the six iCIMS boards as untracked exits, % closure(s) marked suspect, % Kohl''s row(s) at the Lake Wales store placed in the US (build %, first slice %, closures judged from %)', v_moved, v_marked, v_placed, v_build, v_since, v_bound;
END $$;