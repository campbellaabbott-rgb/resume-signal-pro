-- A WORKDAY SLICE READ AS A WHOLE BOARD WROTE CLOSURES NOBODY MADE.
--
-- Register L1-01 (platform debug sweep 2026-10-04), the mechanism behind
-- defect-sweep 1.17. job-board .89 fixes the cause; this file marks what the
-- cause already wrote. Apply it AFTER job-board answers status.version
-- 2026-09-09.89 (docs/job-board-deploy-notes.md, .89), or the old bundle keeps
-- writing rows of the same kind after it.
--
-- WHAT HAPPENED. Many Workday tenants state `total` only on the offset-0 page
-- and answer `total: 0` on every later page (measured 2026-10-05: 540 of the
-- 689 Workday boards whose verification stamp read 0 or over 250; Adobe 526,
-- Novartis 816, TD 1,521, T-Mobile 2,000 at offset 0, 0 past it). A visit is
-- capped at MAX_POSTINGS_PER_VISIT (500 from 2026-08-25, 250 from 2026-09-06),
-- so such a board is read over several visits and every visit after the first
-- starts mid-feed and sees a total of 0. The collector's windowed test
-- (`feedTotal > rows read`) was then false, the slice was taken for the whole
-- board, and every stored posting outside it was stamped missing and, after
-- the grace, deleted and logged here with absence_basis 'full_read' (NULL
-- before the basis column existed) as an employer takedown. 207 of those
-- boards served nothing on 2026-10-05.
--
-- WHICH ROWS. A Workday 'full_read' (or pre-basis) closure on a board whose
-- own advertised count exceeded the visit cap in force when it was logged:
-- such a board cannot be read whole in one visit, so a full read of it was
-- impossible and every such closure came from a mid-feed slice. The count is
-- the largest the board ever stated, from the daily board_state history
-- (which starts 2026-09-06) or the live verification stamp. The one way this
-- over-marks: a board that shrank under the cap and was then genuinely read
-- whole; those closures leave the estimator with the rest (suspect is read as
-- excluded everywhere), which is the cautious direction for a table that is
-- sold as "the employer took the role down".
--
-- REVERSIBLE. Every row this file marks is listed in
-- job_board_closure_repairs (service role only) under the repair name, so the
-- marking can be audited or undone exactly:
--   UPDATE public.job_board_closures c SET suspect = false
--     FROM public.job_board_closure_repairs r
--    WHERE r.event_id = c.event_id AND r.repair = 'workday_mid_feed_zero_l1_01';
-- Re-running the INSERT and UPDATE below is idempotent (ON CONFLICT DO
-- NOTHING, suspect = false guard): if this applied before .89 served, run
-- them again once it does.
--
-- NOT DONE HERE. The paired job_board_exits rows (exit_reason 'removed') have
-- no suspect column and stay. Postings stamped missing by the defect and not
-- yet deleted heal on their own under .89: a windowed visit unstamps every id
-- it serves, and only a proven lap may close one.

CREATE TABLE IF NOT EXISTS public.job_board_closure_repairs (
  event_id  bigint PRIMARY KEY,
  repair    text NOT NULL,
  marked_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.job_board_closure_repairs IS
  'One row per job_board_closures event a data repair marked suspect, named by the repair, so the marking can be audited or reversed exactly. Service role only.';

ALTER TABLE public.job_board_closure_repairs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_board_closure_repairs FROM PUBLIC;
REVOKE ALL ON public.job_board_closure_repairs FROM anon;
REVOKE ALL ON public.job_board_closure_repairs FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.job_board_closure_repairs TO service_role;

SET LOCAL statement_timeout = '15min';

WITH big AS (
  SELECT t.company_token, max(t.feed_total) AS top
    FROM (
      SELECT company_token, feed_total
        FROM public.job_board_board_state
       WHERE source = 'workday' AND feed_total IS NOT NULL
      UNION ALL
      SELECT company_token, feed_total
        FROM public.job_board_verifications
       WHERE company_token LIKE '%~wd%' AND feed_total IS NOT NULL
    ) t
   GROUP BY t.company_token
  HAVING max(t.feed_total) > 250
)
INSERT INTO public.job_board_closure_repairs (event_id, repair)
SELECT c.event_id, 'workday_mid_feed_zero_l1_01'
  FROM public.job_board_closures c
  JOIN big b ON b.company_token = c.company_token
 WHERE c.source = 'workday'
   AND (c.absence_basis = 'full_read' OR c.absence_basis IS NULL)
   AND c.suspect = false
   AND (c.closed_at >= timestamptz '2026-09-06 00:00:00+00'
        OR (b.top > 500 AND c.closed_at >= timestamptz '2026-08-25 00:00:00+00'))
ON CONFLICT (event_id) DO NOTHING;

UPDATE public.job_board_closures c
   SET suspect = true
  FROM public.job_board_closure_repairs r
 WHERE r.event_id = c.event_id
   AND r.repair = 'workday_mid_feed_zero_l1_01'
   AND c.suspect = false;

DO $$
DECLARE
  v_marked  bigint;
  v_left    bigint;
  v_unmarked_listed bigint;
BEGIN
  IF to_regclass('public.job_board_closure_repairs') IS NULL THEN
    RAISE EXCEPTION 'self-verify 20261005100000: job_board_closure_repairs was not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.job_board_closure_repairs'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'self-verify 20261005100000: job_board_closure_repairs does not have row-level security on';
  END IF;
  IF has_table_privilege('anon', 'public.job_board_closure_repairs', 'SELECT')
     OR has_table_privilege('anon', 'public.job_board_closure_repairs', 'INSERT')
     OR has_table_privilege('authenticated', 'public.job_board_closure_repairs', 'SELECT')
     OR has_table_privilege('authenticated', 'public.job_board_closure_repairs', 'INSERT') THEN
    RAISE EXCEPTION 'self-verify 20261005100000: job_board_closure_repairs is readable or writable by anon or authenticated';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.job_board_closure_repairs', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.job_board_closure_repairs', 'INSERT') THEN
    RAISE EXCEPTION 'self-verify 20261005100000: service_role cannot read and write job_board_closure_repairs';
  END IF;

  -- Every listed event is marked.
  SELECT count(*) INTO v_unmarked_listed
    FROM public.job_board_closure_repairs r
    JOIN public.job_board_closures c ON c.event_id = r.event_id
   WHERE r.repair = 'workday_mid_feed_zero_l1_01' AND c.suspect = false;
  IF v_unmarked_listed > 0 THEN
    RAISE EXCEPTION 'self-verify 20261005100000: % listed closure(s) are still not suspect', v_unmarked_listed;
  END IF;

  -- And nothing the rule names was left unmarked.
  WITH big AS (
    SELECT t.company_token, max(t.feed_total) AS top
      FROM (
        SELECT company_token, feed_total FROM public.job_board_board_state
         WHERE source = 'workday' AND feed_total IS NOT NULL
        UNION ALL
        SELECT company_token, feed_total FROM public.job_board_verifications
         WHERE company_token LIKE '%~wd%' AND feed_total IS NOT NULL
      ) t
     GROUP BY t.company_token
    HAVING max(t.feed_total) > 250
  )
  SELECT count(*) INTO v_left
    FROM public.job_board_closures c
    JOIN big b ON b.company_token = c.company_token
   WHERE c.source = 'workday'
     AND (c.absence_basis = 'full_read' OR c.absence_basis IS NULL)
     AND c.suspect = false
     AND (c.closed_at >= timestamptz '2026-09-06 00:00:00+00'
          OR (b.top > 500 AND c.closed_at >= timestamptz '2026-08-25 00:00:00+00'));
  IF v_left > 0 THEN
    RAISE EXCEPTION 'self-verify 20261005100000: % Workday mid-feed closure(s) were left unmarked', v_left;
  END IF;

  SELECT count(*) INTO v_marked FROM public.job_board_closure_repairs WHERE repair = 'workday_mid_feed_zero_l1_01';
  RAISE NOTICE 'self-verify 20261005100000: % Workday closure(s) written by mid-feed slices are marked suspect and listed in job_board_closure_repairs; the table is service-role only', v_marked;
END $$;
