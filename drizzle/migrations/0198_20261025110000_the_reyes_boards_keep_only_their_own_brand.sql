-- THE REYES BOARDS KEEP ONLY THEIR OWN BRAND.
--
-- The last D7 pair (docs/company-profiles/name-gate-dry-run.md, table 1,
-- SEO-036). talent.reyesholdings.com ("Reyes Beverage Group") and
-- jobportal.martinbrower.com ("Martin Brower") both read one Reyes Holdings
-- iCIMS feed, unfiltered: measured 2026-10-25, the two hosts' /api/jobs
-- answers were byte-identical (673 postings) and both boards served the same
-- 497 rows, so each company page printed the other's roles under its own name
-- and the board's search returned one requisition twice under two employers.
-- Every posting names its own brand, and each brand applies on its own iCIMS
-- portal: Reyes Beverage Group on careers-reyesbeveragegroup, Reyes Coca-Cola
-- Bottling on careers-reyescocacola, Reyes Fleet Management on
-- careers-reyesfleetmanagement, Reyes Holdings on careers-reyesholdings, and
-- Martin Brower on its four *martinbrower portals and nzcareers-reyesholdings.
--
-- job-board 2026-09-09.95 reads each board as one brand (&brand= on the feed
-- URL) and adds boards for the other three brands. This file moves the rows
-- that are now another board's off the two carried boards:
--   - talent.reyesholdings.com keeps the rows that apply on Reyes Beverage
--     Group's portal, and nothing else;
--   - jobportal.martinbrower.com loses the rows that apply on the other four
--     brands' portals, and keeps the rest.
-- They leave through job_board_exits as 'untracked', the reason for a row
-- that left by OUR action (the shape of 20260909216000), and never through
-- job_board_closures: each is still open, on its own brand's board.
--
-- APPLY AFTER job-board 2026-09-09.95 SERVES (docs/deploy-ledger.json
-- migrationOrder), and after its first slice. Run while an older build
-- serves, the unscoped read puts the rows back on its next visit, so the file
-- refuses unless job_board_meta.slice_stats names .95 or later (the job-board
-- status action's sliceStats.build), which the first slice after the deploy
-- writes, minutes after an OPTIONS request already answers the build. If it
-- refuses, wait for that slice and apply this same file again, unedited.
--
-- THE RACE THE ORDER LEAVES. Between the deploy and this file, a scoped read
-- that reaches either board stamps the other brands' rows missing and, after
-- the grace, closes them as takedowns. Those closures are marked suspect and
-- listed in job_board_closure_repairs under 'reyes_brand_scope_trust_pages':
-- a closure on either board, written since 30 minutes before the first slice
-- slice_stats names (buildSince), in a batch that took more than 30% of the
-- board at once (the scoped read removes about 47% of
-- talent.reyesholdings.com and 78% of jobportal.martinbrower.com; a real
-- day's takedowns are a few rows).
--
-- WHY 30 MINUTES BEFORE IT. job-board keeps buildSince only while the build
-- that wrote slice_stats last is its own (firstSliceOf): a slice of the older
-- build that began before the deploy and stamps after the new build's first
-- slice flips the record back, and the new build's next slice restarts
-- buildSince at its own start. Closures the new build wrote in between would
-- fall before that later bound (land/all recheck, 2026-10-27). Such a slice
-- stops its board loop at 120 s (SLICE_WALL_BUDGET_MS) and stamps right after
-- it, and the two refresh crons start a slice every 5 minutes (4-59/10 and
-- 9-59/10), so the reset moves buildSince by minutes; 30 minutes covers that
-- several times over. The cost is the 30 minutes before the first slice: a
-- real takedown batch of more than 30% of either board then would be marked
-- too, and is listed and reversible like every other. Reversible:
--   UPDATE public.job_board_closures c SET suspect = false
--     FROM public.job_board_closure_repairs r
--    WHERE r.event_id = c.event_id AND r.repair = 'reyes_brand_scope_trust_pages';
--
-- RE-RUNNABLE: a second run finds nothing to move and nothing left unmarked.

SET LOCAL statement_timeout = '5min';

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

DO $$
DECLARE
  v_build   text;
  v_since   text;
  v_bound   timestamptz;
  v_ids     text[];
  v_moved   int := 0;
  v_marked  int := 0;
  v_left    int;
  v_now     timestamptz := now();
  v_others  text[] := ARRAY['careers-reyesbeveragegroup.icims.com', 'careers-reyescocacola.icims.com',
                            'careers-reyesfleetmanagement.icims.com', 'careers-reyesholdings.icims.com'];
BEGIN
  SELECT m.v ->> 'build', m.v ->> 'buildSince' INTO v_build, v_since
    FROM public.job_board_meta m WHERE m.k = 'slice_stats';
  IF NOT (v_build ~ '^\d{4}-\d{2}-\d{2}\.\d{1,6}$' AND v_since ~ '^\d{4}-\d{2}-\d{2}T'
          AND (split_part(v_build, '.', 1) > '2026-09-09'
               OR (split_part(v_build, '.', 1) = '2026-09-09' AND split_part(v_build, '.', 2)::int >= 95))) THEN
    RAISE EXCEPTION 'self-check 20261025110000: job_board_meta.slice_stats names build %, not job-board 2026-09-09.95 or later (applied under an older build, its unscoped read puts the rows back). Wait until the job-board status action''s sliceStats.build reads 2026-09-09.95 or later (the first slice after the deploy writes it), then apply the same file again, unedited', coalesce(v_build, '(none)');
  END IF;
  -- 30 minutes before the first slice: an older slice stamping last can move
  -- buildSince later by minutes (WHY 30 MINUTES BEFORE IT, above).
  v_bound := v_since::timestamptz - interval '30 minutes';

  SELECT coalesce(array_agg(p.id), ARRAY[]::text[]) INTO v_ids
    FROM public.job_board_postings p
   WHERE (p.company_token = 'talent.reyesholdings.com'
          AND coalesce(substring(p.apply_url from '^https?://([^/:?#]+)'), '') <> 'careers-reyesbeveragegroup.icims.com')
      OR (p.company_token = 'jobportal.martinbrower.com'
          AND substring(p.apply_url from '^https?://([^/:?#]+)') = ANY (v_others));

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

  INSERT INTO public.job_board_closure_repairs (event_id, repair)
  SELECT c.event_id, 'reyes_brand_scope_trust_pages'
    FROM public.job_board_closures c
   WHERE c.company_token IN ('talent.reyesholdings.com', 'jobportal.martinbrower.com')
     AND c.source = 'icims'
     AND c.closed_at >= v_bound
     AND c.batch_removed IS NOT NULL AND c.batch_live_before > 0
     AND c.batch_removed > 0.3 * c.batch_live_before
     AND c.suspect IS NOT TRUE
  ON CONFLICT (event_id) DO NOTHING;

  UPDATE public.job_board_closures c
     SET suspect = true
    FROM public.job_board_closure_repairs r
   WHERE r.event_id = c.event_id
     AND r.repair = 'reyes_brand_scope_trust_pages'
     AND c.suspect IS NOT TRUE;
  GET DIAGNOSTICS v_marked = ROW_COUNT;

  -- SELF-CHECK. No row on either board applies on another brand's portal,
  -- and every listed closure is suspect.
  SELECT count(*) INTO v_left
    FROM public.job_board_postings p
   WHERE (p.company_token = 'talent.reyesholdings.com'
          AND coalesce(substring(p.apply_url from '^https?://([^/:?#]+)'), '') <> 'careers-reyesbeveragegroup.icims.com')
      OR (p.company_token = 'jobportal.martinbrower.com'
          AND substring(p.apply_url from '^https?://([^/:?#]+)') = ANY (v_others));
  IF v_left > 0 THEN
    RAISE EXCEPTION 'self-check 20261025110000: % row(s) on the two Reyes boards still apply on another brand''s portal', v_left;
  END IF;
  SELECT count(*) INTO v_left
    FROM public.job_board_closure_repairs r
    JOIN public.job_board_closures c ON c.event_id = r.event_id
   WHERE r.repair = 'reyes_brand_scope_trust_pages' AND c.suspect IS NOT TRUE;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'self-check 20261025110000: % listed closure(s) are still not suspect', v_left;
  END IF;
  RAISE NOTICE 'self-check 20261025110000: % row(s) moved off the two Reyes boards as untracked exits, % closure(s) marked suspect (build %, first slice %, closures judged from %)', v_moved, v_marked, v_build, v_since, v_bound;
END $$;