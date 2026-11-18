-- lovable-cron-fallback-reviewed: no cron; this file schedules no job and changes none (reviewed 2026-11-18 in the API4 truth lane).
--
-- AN ACCOUNT ROW AGES FROM THE EMPLOYER'S DATE (API4 M16).
--
-- WHAT WAS WRONG. get_application_lifecycle (20261009131000) computed
-- days_standing from the employer's date OR, where the employer gave none,
-- from first_seen: our crawler's discovery stamp. Account printed it as
-- "Still posted - N+ days" and "came down ..., after at least N days posted".
-- A posting age is the employer's date or nothing (the posting-age rule):
-- first_seen has been mass-reset more than once (the 2.8-day-median
-- incident), so on an undated system the number was our discovery clock
-- published as the employer's. The check endpoint (posting_truth,
-- 20261206100000) states its age from the employer's date only; with this
-- file Account and the check cannot disagree about a posting's age.
--
-- WHAT THIS DOES. The function is re-issued exactly as 20261009131000 left
-- it (the daily allowance, the token-first closure read, the suspect and
-- superseded filters, going_down, lap_backfill keeping the row with no
-- duration), with four changes:
--   1. days_standing is measured from the employer's posted_at only. A
--      posting with no employer date has no days_standing (Account then
--      prints "Posting still open" with no count, and a came-down line with
--      no duration). A date in the future reads as today: never negative.
--   2. The closure and live reads no longer carry first_seen at all, so no
--      expression below can reach it.
--   3. The re-post probe is unchanged in meaning: a served posting with the
--      same title on the same board that we first saw (or the employer
--      dated) after the closure. It compares dates; it measures no age.
--      It is written as two comparisons instead of one coalesce so that a
--      reader of the age rule sees no age expression in it.
--   4. The same id come back is read by id, as the check reads it. The
--      collector deletes a posting's row as soon as it logs a closure, so a
--      row beside a trusted closure is that id listed again. Stamped missing
--      AFTER the closure, it is going down again: 20261009131000 answered
--      came_down with the OLD closure's date ("It has not reappeared"), and
--      Account then wrote that date to the tracker row for good. Now it is
--      going_down, with no closure date and no duration, and relisted says
--      the id came back. A row stamped missing BEFORE the closure is one the
--      closure's delete left behind: the closure stands, as before.
--
-- Grants are re-issued as 20261009131000 issued them: signed-in accounts
-- and the service role; never anon.
--
-- Safe to re-run. Self-verifying at the end.

CREATE OR REPLACE FUNCTION public.get_application_lifecycle(p_job_ids text[])
RETURNS TABLE (
  job_id text,
  outcome text,
  closed_at timestamptz,
  days_standing numeric,
  relisted boolean,
  closed_at_is_observation boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10s'
AS $fn$
#variable_conflict use_column
DECLARE
  -- The distinct posting ids one account may have answered in a day.
  c_per_day constant integer := 1000;
  v_uid uuid := auth.uid();
  v_mine text[];
  v_seen text[];
  v_room integer;
  v_allowed text[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT a.job_id) INTO v_mine
    FROM public.user_applications a
    WHERE a.user_id = auth.uid()
      AND a.job_id = ANY (p_job_ids[1:500]);
  IF v_mine IS NULL THEN
    RETURN;
  END IF;

  IF random() < 0.01 THEN
    DELETE FROM public.lifecycle_reads WHERE day < current_date - 2;
  END IF;

  -- Already answered today: free. New ids: only while the day has room.
  SELECT array_agg(r.job_id) INTO v_seen
    FROM public.lifecycle_reads r
    WHERE r.user_id = v_uid AND r.day = current_date AND r.job_id = ANY (v_mine);
  SELECT c_per_day - count(*) INTO v_room
    FROM public.lifecycle_reads r
    WHERE r.user_id = v_uid AND r.day = current_date;
  WITH fresh AS (
    SELECT x AS jid FROM unnest(v_mine) AS x
    WHERE NOT (x = ANY (COALESCE(v_seen, '{}'::text[])))
    ORDER BY x
    LIMIT GREATEST(v_room, 0)
  ), kept AS (
    INSERT INTO public.lifecycle_reads (user_id, day, job_id)
    SELECT v_uid, current_date, fresh.jid FROM fresh
    ON CONFLICT DO NOTHING
    RETURNING lifecycle_reads.job_id
  )
  SELECT array_agg(k.job_id) INTO v_allowed FROM kept k;
  v_allowed := COALESCE(v_seen, '{}'::text[]) || COALESCE(v_allowed, '{}'::text[]);

  RETURN QUERY
  WITH ids AS (
    SELECT DISTINCT x AS jid FROM unnest(v_allowed) AS x
  ),
  cl AS (
    -- A takedown is a closure the collector trusted: never superseded, never
    -- stamped suspect (a feed that went dark at once).
    -- BY THE BOARD FIRST (S11-024). The ledger (~5M rows, ~10k more a day)
    -- has no posting_id index, so `posting_id IN (...)` read all of it on
    -- every Account load, inside this function's 10 s. A posting id is
    -- source:token:native, so its token reaches job_board_closures_curve_idx
    -- (company_token, closed_at DESC) and the posting id filters that board.
    SELECT DISTINCT ON (c.posting_id)
      c.posting_id, c.closed_at, c.posted_at, c.company_token, c.title,
      c.absence_basis
    FROM ids
    JOIN public.job_board_closures c
      ON c.company_token = split_part(ids.jid, ':', 2)
     AND c.posting_id = ids.jid
    WHERE NOT COALESCE(c.superseded, false)
      AND NOT COALESCE(c.suspect, false)
    ORDER BY c.posting_id, c.closed_at DESC
  ),
  liv AS (
    -- Served now: stamped missing is going down, not standing.
    SELECT p.id, p.posted_at, p.missing_since, (p.missing_since IS NULL) AS served
    FROM public.job_board_postings p
    WHERE p.id IN (SELECT ids.jid FROM ids)
  )
  SELECT
    ids.jid AS job_id,
    CASE
      WHEN liv.served AND cl.posting_id IS NOT NULL THEN 'came_down_relisted'
      WHEN liv.served THEN 'still_standing'
      WHEN b.back_going THEN 'going_down'
      WHEN cl.posting_id IS NOT NULL THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM public.job_board_postings p2
          WHERE p2.company_token = cl.company_token
            AND lower(p2.title) = lower(cl.title)
            AND p2.missing_since IS NULL
            AND (p2.posted_at >= cl.closed_at
                 OR (p2.posted_at IS NULL AND p2.first_seen >= cl.closed_at))
        ) THEN 'came_down_relisted' ELSE 'came_down' END
      WHEN liv.id IS NOT NULL THEN 'going_down'
      ELSE 'not_observed'
    END AS outcome,
    CASE WHEN b.back_going THEN NULL ELSE cl.closed_at END AS closed_at,
    -- The employer's date or nothing.
    CASE
      WHEN b.back_going THEN NULL
      WHEN cl.posting_id IS NOT NULL AND cl.absence_basis = 'lap_backfill' THEN NULL
      WHEN cl.posting_id IS NOT NULL AND cl.posted_at IS NOT NULL
        THEN GREATEST(round((EXTRACT(epoch FROM (cl.closed_at - cl.posted_at)) / 86400.0)::numeric, 1), 0)
      WHEN liv.served AND liv.posted_at IS NOT NULL
        THEN GREATEST(round((EXTRACT(epoch FROM (now() - liv.posted_at)) / 86400.0)::numeric, 1), 0)
      ELSE NULL
    END AS days_standing,
    b.back AS relisted,
    COALESCE(cl.posting_id IS NOT NULL AND cl.absence_basis = 'lap_backfill' AND NOT b.back_going, false) AS closed_at_is_observation
  FROM ids
  LEFT JOIN cl  ON cl.posting_id = ids.jid
  LEFT JOIN liv ON liv.id = ids.jid
  CROSS JOIN LATERAL (
    -- The same id, listed again after its newest trusted closure (served
    -- now, or stamped missing after that closure), and the second case alone.
    SELECT
      COALESCE(cl.posting_id IS NOT NULL AND liv.id IS NOT NULL
               AND (liv.served OR liv.missing_since > cl.closed_at), false) AS back,
      COALESCE(cl.posting_id IS NOT NULL AND liv.id IS NOT NULL
               AND NOT liv.served AND liv.missing_since > cl.closed_at, false) AS back_going
  ) b;
END
$fn$;

REVOKE ALL ON FUNCTION public.get_application_lifecycle(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_application_lifecycle(text[]) TO authenticated, service_role;

-- ── self-check ───────────────────────────────────────────────────────────────
DO $check$
DECLARE
  v_def text := pg_get_functiondef(to_regprocedure('public.get_application_lifecycle(text[])'));
BEGIN
  IF v_def IS NULL OR v_def NOT LIKE '%lifecycle_reads%' OR v_def NOT LIKE '%missing_since IS NULL%' OR v_def NOT LIKE '%c.suspect%' THEN
    RAISE EXCEPTION 'get_application_lifecycle is not the metered, suspect-free, served-only definition';
  END IF;
  IF v_def LIKE '%cl.first_seen%' OR v_def LIKE '%liv.first_seen%' OR v_def LIKE '%c.first_seen%' OR v_def LIKE '%p.first_seen%' THEN
    RAISE EXCEPTION 'get_application_lifecycle still carries our discovery stamp into a posting''s age';
  END IF;
  IF has_function_privilege('anon', 'public.get_application_lifecycle(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_application_lifecycle is callable by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_application_lifecycle(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_application_lifecycle no longer answers a signed-in account';
  END IF;
END
$check$;
