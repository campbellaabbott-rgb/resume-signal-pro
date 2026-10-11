-- A SERVED POSTING KEEPS NO CLOSURE DATE, AND THE TRACKER CAP COUNTS ONLY WHAT
-- ITS OWNER ADDED.
--
-- WHAT WAS WRONG.
--   S11-138. 20261009131000 cleared posting_closed_at, once, on tracker rows
--     whose posting is served again. The live Account page (main's
--     Account.tsx) writes closed_at back for any answer that carries one, and
--     get_application_lifecycle answers 'came_down_relisted' with the old
--     closure's date: during the deploy window, and on every later relist, the
--     row went back to "Came down on <date>" for a posting that is open. A row
--     with a date is never checked again, so it stayed that way.
--   S11-139. owner_row_cap (131000) counted every row, but service_role is
--     exempt from it: the agent's tracker mirror (apply-broker writes it as
--     service_role) filled the 2,000 rows a member may add, and then the
--     member's own Save, Apply and Keep were refused. It also fired on the
--     INSERT arm of an upsert to a row that already exists (agent_learned_answers
--     is saved with onConflict user_id,question_key), so at the cap an answer
--     could not even be changed. And since 20261009111000 only service_role
--     inserts shortlist_candidates, so that cap could never fire.
--
-- WHAT THIS DOES.
--   1. user_applications_served_posting_undated (BEFORE INSERT OR UPDATE OF
--      posting_closed_at): a client cannot give a tracker row a closure date
--      while its posting is served (job_board_postings.missing_since IS NULL),
--      whatever page version writes it.
--   2. undate_served_tracker_rows(), daily (pg_cron 'tracker-served-postings-
--      undated', 05:23 UTC, its own two-minute statement_timeout): a row whose
--      posting came back is undated, so the page checks it again.
--   3. user_applications.written_by ('client' or 'service'), stamped by the cap
--      trigger itself on every insert, so no client can claim either; the
--      mirror rows already written (matched to the agent's submitted sends)
--      are marked 'service'.
--   4. owner_row_cap(owner column, cap, natural key, scope) counts only rows
--      the owner added (written_by is not 'service', where the table has it),
--      skips an insert whose natural key already exists (the INSERT arm of an
--      upsert adds no row; a plain duplicate gets its 23505), and with scope
--      'all' applies to service_role too: shortlist_candidates, whose only
--      writer is shortlist-evaluate (which also checks before it scores).
-- Safe to re-run. Self-verifying at the end.

SET LOCAL statement_timeout = '2min';

-- ── 1. no closure date for a served posting ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.user_applications_served_posting_undated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.posting_closed_at IS NOT NULL
     AND NEW.job_id IS NOT NULL
     AND COALESCE(auth.role(), '') <> 'service_role'
     AND EXISTS (SELECT 1 FROM public.job_board_postings p WHERE p.id = NEW.job_id AND p.missing_since IS NULL) THEN
    NEW.posting_closed_at := NULL;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.user_applications_served_posting_undated() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS user_applications_served_posting_undated_trg ON public.user_applications;
CREATE TRIGGER user_applications_served_posting_undated_trg
  BEFORE INSERT OR UPDATE OF posting_closed_at ON public.user_applications
  FOR EACH ROW EXECUTE FUNCTION public.user_applications_served_posting_undated();

-- ── 2. a relisted posting's row is undated, daily ────────────────────────────
CREATE OR REPLACE FUNCTION public.undate_served_tracker_rows()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.user_applications a
     SET posting_closed_at = NULL
   WHERE a.posting_closed_at IS NOT NULL
     AND a.job_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.job_board_postings p WHERE p.id = a.job_id AND p.missing_since IS NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$fn$;
REVOKE ALL ON FUNCTION public.undate_served_tracker_rows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.undate_served_tracker_rows() TO service_role;
COMMENT ON FUNCTION public.undate_served_tracker_rows() IS
  'Clears posting_closed_at on tracker rows whose posting is served again, so Account checks them anew. '
  'Daily, pg_cron tracker-served-postings-undated. S11-138, 20261009134200. service_role only.';

SELECT public.undate_served_tracker_rows();

DO $cron$
DECLARE v_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron absent: no daily undating job';
    RETURN;
  END IF;
  SELECT j.jobid INTO v_id FROM cron.job j WHERE j.jobname = 'tracker-served-postings-undated';
  IF v_id IS NULL THEN
    PERFORM cron.schedule('tracker-served-postings-undated', '23 5 * * *',
      $job$SET statement_timeout = '2min'; SELECT public.undate_served_tracker_rows();$job$);
  ELSE
    PERFORM cron.alter_job(job_id := v_id, schedule := '23 5 * * *',
      command := $job$SET statement_timeout = '2min'; SELECT public.undate_served_tracker_rows();$job$);
  END IF;
END
$cron$;

-- ── 3. who wrote a tracker row ───────────────────────────────────────────────
ALTER TABLE public.user_applications ADD COLUMN IF NOT EXISTS written_by text;
ALTER TABLE public.user_applications DROP CONSTRAINT IF EXISTS user_applications_written_by_check;
ALTER TABLE public.user_applications
  ADD CONSTRAINT user_applications_written_by_check CHECK (written_by IS NULL OR written_by IN ('client', 'service'));
COMMENT ON COLUMN public.user_applications.written_by IS
  'Who added the row: client (the member) or service (the agent''s tracker mirror). Stamped by owner_row_cap on insert; '
  'the 2,000-row cap counts only client rows. NULL: written before 20261009134200, counted as client.';

DO $mark$
BEGIN
  IF to_regclass('public.agent_submissions') IS NOT NULL THEN
    UPDATE public.user_applications a
       SET written_by = 'service'
      FROM public.agent_submissions s
     WHERE a.written_by IS NULL
       AND s.user_id = a.user_id
       AND s.posting_id = a.job_id
       AND s.status = 'submitted';
  END IF;
END
$mark$;

-- ── 4. the cap counts what the owner added ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.owner_row_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $cap$
DECLARE
  v_col text := TG_ARGV[0];
  v_cap integer := TG_ARGV[1]::integer;
  v_key text[] := CASE WHEN COALESCE(TG_ARGV[2], '') = '' THEN ARRAY[]::text[] ELSE string_to_array(TG_ARGV[2], ',') END;
  v_all_roles boolean := COALESCE(TG_ARGV[3], '') = 'all';
  v_row jsonb := to_jsonb(NEW);
  v_owner text := v_row ->> TG_ARGV[0];
  v_service boolean := COALESCE(auth.role(), '') = 'service_role';
  v_has_writer boolean := v_row ? 'written_by';
  v_where text;
  v_type text;
  v_k text;
  v_exists boolean;
  v_n integer;
BEGIN
  -- Who wrote it, decided here and never by the writer.
  IF v_has_writer THEN
    NEW.written_by := CASE WHEN v_service THEN 'service' ELSE 'client' END;
  END IF;
  IF v_owner IS NULL OR (v_service AND NOT v_all_roles) THEN
    RETURN NEW;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_type
    FROM pg_attribute a WHERE a.attrelid = TG_RELID AND a.attname = v_col AND NOT a.attisdropped;
  v_where := format('%I = ($1 ->> %L)::%s', v_col, v_col, v_type);

  -- The insert arm of an upsert to a row that exists adds no row.
  IF cardinality(v_key) > 0 THEN
    DECLARE
      v_match text := v_where;
    BEGIN
      FOREACH v_k IN ARRAY v_key LOOP
        IF v_k = v_col THEN CONTINUE; END IF;
        IF v_row ->> v_k IS NULL THEN v_match := NULL; EXIT; END IF;
        SELECT format_type(a.atttypid, a.atttypmod) INTO v_type
          FROM pg_attribute a WHERE a.attrelid = TG_RELID AND a.attname = v_k AND NOT a.attisdropped;
        v_match := v_match || format(' AND %I = ($1 ->> %L)::%s', v_k, v_k, v_type);
      END LOOP;
      IF v_match IS NOT NULL THEN
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %s)', TG_TABLE_SCHEMA, TG_TABLE_NAME, v_match)
          INTO v_exists USING v_row;
        IF v_exists THEN
          RETURN NEW;
        END IF;
      END IF;
    END;
  END IF;

  IF v_has_writer THEN
    v_where := v_where || ' AND written_by IS DISTINCT FROM ''service''';
  END IF;
  EXECUTE format('SELECT count(*) FROM %I.%I WHERE %s', TG_TABLE_SCHEMA, TG_TABLE_NAME, v_where)
    INTO v_n USING v_row;
  IF v_n >= v_cap THEN
    RAISE EXCEPTION 'this account already holds % rows here, the most it can', v_cap
      USING ERRCODE = '54000';
  END IF;
  RETURN NEW;
END
$cap$;
REVOKE ALL ON FUNCTION public.owner_row_cap() FROM PUBLIC, anon, authenticated;

DO $caps$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('user_applications', 'user_id', 2000, 'user_id,job_id', ''),
    ('user_scans', 'user_id', 2000, '', ''),
    ('user_job_searches', 'user_id', 100, '', ''),
    ('agent_learned_answers', 'user_id', 2000, 'user_id,question_key', ''),
    ('shortlist_roles', 'owner_id', 500, '', ''),
    ('shortlist_candidates', 'owner_id', 10000, '', 'all')
  ) AS t(tbl, col, cap, natural_key, scope)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NULL THEN
      RAISE NOTICE 'owner_row_cap: no table %, skipped', r.tbl;
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', r.tbl || '_owner_row_cap_trg', r.tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.owner_row_cap(%L, %L, %L, %L)',
      r.tbl || '_owner_row_cap_trg', r.tbl, r.col, r.cap::text, r.natural_key, r.scope);
  END LOOP;
END
$caps$;

-- ── self-check ───────────────────────────────────────────────────────────────
DO $check$
DECLARE
  v_def text := pg_get_functiondef(to_regprocedure('public.owner_row_cap()'));
BEGIN
  IF v_def IS NULL OR v_def NOT LIKE '%written_by IS DISTINCT FROM%' OR v_def NOT LIKE '%v_all_roles%' THEN
    RAISE EXCEPTION 'owner_row_cap is not the definition that counts only the owner''s rows';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'user_applications_served_posting_undated_trg') THEN
    RAISE EXCEPTION 'the served-posting trigger is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'user_applications_owner_row_cap_trg') THEN
    RAISE EXCEPTION 'the tracker row cap is missing';
  END IF;
  IF has_function_privilege('anon', 'public.undate_served_tracker_rows()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.undate_served_tracker_rows()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.user_applications_served_posting_undated()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.user_applications_served_posting_undated()', 'EXECUTE') THEN
    RAISE EXCEPTION 'a tracker maintenance function is callable by a client role';
  END IF;
  -- Nested: the cron table is planned only where pg_cron exists.
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF NOT EXISTS (
         SELECT 1 FROM cron.job j
          WHERE j.jobname = 'tracker-served-postings-undated'
            AND j.command LIKE '%statement_timeout = ''2min''%'
            AND j.command LIKE '%undate_served_tracker_rows()%') THEN
      RAISE EXCEPTION 'the daily undating job does not carry its statement_timeout';
    END IF;
  END IF;
END
$check$;
