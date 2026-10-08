-- A TRACKER ROW READS THE CLOSURE LOG BY THE DAY, A SUSPECT CLOSURE IS NOT A
-- TAKEDOWN, AND A FREE ACCOUNT'S OWN TABLES HAVE BOUNDS.
--
-- WHAT WAS WRONG.
--   S8-018 (sweep 2026-10-08). get_application_lifecycle answers only for job
--     ids on the caller's own tracker rows (census 1d, 20261004110000), but a
--     tracker row's job_id is free text the owner may insert or PATCH: a free
--     account (auto-confirmed at once) wrote 500 posting ids, read their
--     outcome / closed_at / days_standing / relisted from the closure log,
--     rewrote the ids and read again, unmetered. The bulk read 1d claimed to
--     end was still open.
--   L13-14 (platform sweep 2026-10-04, 1.30). The cl CTE took the latest
--     closure with no suspect filter, so a board whose feed went dark once
--     read "Came down {date}" for roles still open, and Account wrote that
--     date to user_applications.posting_closed_at, permanently.
--   L11-08. The liv CTE read job_board_postings by id with no missing_since
--     filter: a posting already stamped missing (the grace window before its
--     closure is written) read "Still posted - N+ days" on Account while the
--     posting page already treated it as gone.
--   S8-103. The owner-writable user tables had no row cap and no length bound:
--     one free account could loop inserts of large text until the disk filled.
--
-- WHAT THIS DOES.
--   1. lifecycle_reads: the distinct posting ids each account has had answered
--      today. get_application_lifecycle (now plpgsql, VOLATILE because it
--      records) answers at most LIFECYCLE_IDS_PER_DAY distinct ids per account
--      per day; an id already answered today is answered again for free, so
--      a member reloading Account is never cut off, while rewriting ids costs
--      the day's allowance.
--   2. A tracker row's job_id cannot be changed by a client once written
--      (no page ever does; the trigger refuses it), so the allowance cannot
--      be recycled through PATCH.
--   3. cl drops superseded and suspect closures; liv and the relist probe read
--      only postings still served (missing_since IS NULL); a posting stamped
--      missing with no trusted closure answers 'going_down', which Account
--      renders as neither "still posted" nor a date. The page now persists a
--      closure date only for 'came_down'. Dates already written for postings
--      that are served again are cleared once, here.
--   4. Per-account row caps (a trigger) and length bounds (NOT VALID CHECKs:
--      new writes only) on the owner-writable tables; service_role is exempt.
--
-- The retroactive feed-dark proxy over closures logged before 2026-09-06
-- (when the collector began stamping suspect) is NOT applied here: it sizes
-- each batch against the board's open count, which is too expensive per
-- call. Those older rows read as they did.
--
-- Safe to re-run. Self-verifying at the end.

-- ── 1. the daily allowance ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lifecycle_reads (
  user_id uuid NOT NULL,
  day date NOT NULL,
  job_id text NOT NULL,
  PRIMARY KEY (user_id, day, job_id)
);
ALTER TABLE public.lifecycle_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lifecycle_reads FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.lifecycle_reads TO service_role;
COMMENT ON TABLE public.lifecycle_reads IS
  'Posting ids get_application_lifecycle answered per account per day (its daily allowance). '
  'Rows older than two days are deleted by the function itself. 20261009131000.';

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
    SELECT DISTINCT ON (c.posting_id)
      c.posting_id, c.closed_at, c.posted_at, c.first_seen, c.company_token, c.title,
      c.absence_basis
    FROM public.job_board_closures c
    WHERE c.posting_id IN (SELECT ids.jid FROM ids)
      AND NOT COALESCE(c.superseded, false)
      AND NOT COALESCE(c.suspect, false)
    ORDER BY c.posting_id, c.closed_at DESC
  ),
  liv AS (
    -- Served now: stamped missing is going down, not standing.
    SELECT p.id, p.posted_at, p.first_seen, (p.missing_since IS NULL) AS served
    FROM public.job_board_postings p
    WHERE p.id IN (SELECT ids.jid FROM ids)
  )
  SELECT
    ids.jid AS job_id,
    CASE
      WHEN liv.served AND cl.posting_id IS NOT NULL THEN 'came_down_relisted'
      WHEN liv.served THEN 'still_standing'
      WHEN cl.posting_id IS NOT NULL THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM public.job_board_postings p2
          WHERE p2.company_token = cl.company_token
            AND lower(p2.title) = lower(cl.title)
            AND p2.missing_since IS NULL
            AND COALESCE(p2.posted_at, p2.first_seen) >= cl.closed_at
        ) THEN 'came_down_relisted' ELSE 'came_down' END
      WHEN liv.id IS NOT NULL THEN 'going_down'
      ELSE 'not_observed'
    END AS outcome,
    cl.closed_at,
    CASE
      WHEN cl.posting_id IS NOT NULL AND cl.absence_basis = 'lap_backfill' THEN NULL
      WHEN cl.posting_id IS NOT NULL AND COALESCE(cl.posted_at, cl.first_seen) IS NOT NULL
        THEN round((EXTRACT(epoch FROM (cl.closed_at - COALESCE(cl.posted_at, cl.first_seen))) / 86400.0)::numeric, 1)
      WHEN liv.served AND COALESCE(liv.posted_at, liv.first_seen) IS NOT NULL
        THEN round((EXTRACT(epoch FROM (now() - COALESCE(liv.posted_at, liv.first_seen))) / 86400.0)::numeric, 1)
      ELSE NULL
    END AS days_standing,
    (cl.posting_id IS NOT NULL AND COALESCE(liv.served, false)) AS relisted,
    COALESCE(cl.posting_id IS NOT NULL AND cl.absence_basis = 'lap_backfill', false) AS closed_at_is_observation
  FROM ids
  LEFT JOIN cl  ON cl.posting_id = ids.jid
  LEFT JOIN liv ON liv.id = ids.jid;
END
$fn$;

REVOKE ALL ON FUNCTION public.get_application_lifecycle(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_application_lifecycle(text[]) TO authenticated, service_role;

-- ── 2. a tracker row's posting is fixed once written ──────────────────────────
CREATE OR REPLACE FUNCTION public.user_applications_job_id_fixed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fx$
BEGIN
  IF NEW.job_id IS DISTINCT FROM OLD.job_id
     AND OLD.job_id IS NOT NULL
     AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'a tracker row''s posting cannot be changed; add a new row instead'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fx$;
REVOKE ALL ON FUNCTION public.user_applications_job_id_fixed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS user_applications_job_id_fixed_trg ON public.user_applications;
CREATE TRIGGER user_applications_job_id_fixed_trg
  BEFORE UPDATE OF job_id ON public.user_applications
  FOR EACH ROW EXECUTE FUNCTION public.user_applications_job_id_fixed();

-- ── 3. dates written from closures the log no longer trusts ───────────────────
-- A posting served again carries no closure date: Account now persists only
-- 'came_down', and what it wrote from a suspect closure (L13-14) or a relist
-- was wrong forever by design of its write-once column.
UPDATE public.user_applications a
   SET posting_closed_at = NULL
 WHERE a.posting_closed_at IS NOT NULL
   AND a.job_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.job_board_postings p WHERE p.id = a.job_id AND p.missing_since IS NULL);

-- ── 4. bounds on what one account can store ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.owner_row_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $cap$
DECLARE
  v_col text := TG_ARGV[0];
  v_cap integer := TG_ARGV[1]::integer;
  v_owner text := to_jsonb(NEW) ->> TG_ARGV[0];
  v_n integer;
BEGIN
  IF v_owner IS NULL OR COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I::text = $1', TG_TABLE_SCHEMA, TG_TABLE_NAME, v_col)
    INTO v_n USING v_owner;
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
    ('user_applications', 'user_id', 2000),
    ('user_scans', 'user_id', 2000),
    ('user_job_searches', 'user_id', 100),
    ('agent_learned_answers', 'user_id', 2000),
    ('shortlist_roles', 'owner_id', 500),
    ('shortlist_candidates', 'owner_id', 10000)
  ) AS t(tbl, col, cap)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NULL THEN
      RAISE NOTICE 'owner_row_cap: no table %, skipped', r.tbl;
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', r.tbl || '_owner_row_cap_trg', r.tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.owner_row_cap(%L, %L)',
      r.tbl || '_owner_row_cap_trg', r.tbl, r.col, r.cap::text);
  END LOOP;
END
$caps$;

DO $lens$
DECLARE
  r record;
  v_name text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('user_applications', 'company', 1000), ('user_applications', 'role', 1000), ('user_applications', 'label', 1000),
    ('user_applications', 'location', 1000), ('user_applications', 'status', 200), ('user_applications', 'job_id', 1000),
    ('user_applications', 'apply_url', 4000), ('user_applications', 'job_posting', 50000),
    ('user_applications', 'fit_missing', 20000), ('user_applications', 'kit', 500000),
    ('user_scans', 'resume_text', 200000), ('user_scans', 'fix_plan', 200000), ('user_scans', 'label', 1000),
    ('user_scans', 'verdict', 20000), ('user_scans', 'industry', 1000), ('user_scans', 'report_id', 1000),
    ('user_profiles', 'matching_resume_text', 200000), ('user_profiles', 'target_role', 1000),
    ('user_profiles', 'situation', 1000), ('user_profiles', 'confirmed_industry', 1000), ('user_profiles', 'confirmed_experience', 1000),
    ('user_job_searches', 'name', 1000), ('user_job_searches', 'params', 50000),
    ('agent_learned_answers', 'question_key', 2000), ('agent_learned_answers', 'question_label', 5000),
    ('agent_learned_answers', 'answer_value', 20000), ('agent_learned_answers', 'answer_kind', 200),
    ('shortlist_roles', 'jd_text', 100000), ('shortlist_roles', 'title', 1000),
    ('shortlist_candidates', 'redacted_text', 200000), ('shortlist_candidates', 'file_name', 1000),
    ('shortlist_candidates', 'parsed_fields', 500000), ('shortlist_candidates', 'signals', 500000),
    ('shortlist_candidates', 'flags', 500000), ('shortlist_candidates', 'interview_questions', 500000)
  ) AS t(tbl, col, max_len)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.col) THEN
      RAISE NOTICE 'length bound: no column %.%, skipped', r.tbl, r.col;
      CONTINUE;
    END IF;
    v_name := left(r.tbl || '_' || r.col || '_len', 63);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = v_name AND conrelid = ('public.' || r.tbl)::regclass) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I IS NULL OR length(%I::text) <= %s) NOT VALID',
        r.tbl, v_name, r.col, r.col, r.max_len);
    END IF;
  END LOOP;
END
$lens$;

-- ── self-check ───────────────────────────────────────────────────────────────
DO $check$
DECLARE
  v_def text := pg_get_functiondef(to_regprocedure('public.get_application_lifecycle(text[])'));
BEGIN
  IF v_def IS NULL OR v_def NOT LIKE '%lifecycle_reads%' OR v_def NOT LIKE '%missing_since IS NULL%' OR v_def NOT LIKE '%c.suspect%' THEN
    RAISE EXCEPTION 'get_application_lifecycle is not the metered, suspect-free, served-only definition';
  END IF;
  IF has_function_privilege('anon', 'public.get_application_lifecycle(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_application_lifecycle is callable by anon';
  END IF;
  IF has_table_privilege('authenticated', 'public.lifecycle_reads', 'SELECT') THEN
    RAISE EXCEPTION 'lifecycle_reads is readable by a client role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'user_applications_job_id_fixed_trg') THEN
    RAISE EXCEPTION 'the job_id trigger is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'user_applications_owner_row_cap_trg') THEN
    RAISE EXCEPTION 'the tracker row cap is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_applications_job_posting_len') THEN
    RAISE EXCEPTION 'the tracker length bounds are missing';
  END IF;
END
$check$;
