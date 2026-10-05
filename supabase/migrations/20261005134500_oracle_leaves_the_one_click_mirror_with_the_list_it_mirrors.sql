-- ORACLE LEFT THE ONE-CLICK MIRROR WITH THE LIST IT MIRRORS.
--
-- 20261005133000's branch took Oracle out of SENDABLE_VENDORS
-- (supabase/functions/_shared/apply-automation.ts) and out of the worker's
-- ADAPTERS, because its adapter never reaches a submit (register 1.12 / L13-04).
-- get_explore_field_grid's `one_click` flag is a hand copy of that list, and
-- its own note says it changes in the same commit. It did not, so the explore
-- cache's one_click_n went on counting every Oracle posting as one the agent
-- can send. No page reads one_click_n today; the published figure and the
-- mirror's contract were both wrong all the same.
--
-- THE LIST NOW LIVES IN ONE SQL PLACE, public.one_click_vendors(), and the
-- grid reads it. It is IMMUTABLE with no arguments, so the planner folds it to
-- a constant once per plan: the grid's full pass costs what the inline array
-- did. src/test/the-one-click-mirror-is-the-sendable-list.test.ts pins it to
-- SENDABLE_VENDORS and runs the grid over Oracle and Breezy postings; the
-- self-check below asks the function itself.
--
-- The grid's body is 20260909110000's, byte for byte, except that one
-- expression. Its COMMENT is untouched (CREATE OR REPLACE keeps it; the live
-- one is 20260927042251's).

CREATE OR REPLACE FUNCTION public.one_click_vendors()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  -- A HAND COPY OF ANOTHER RUNTIME'S LIST: SENDABLE_VENDORS in
  -- supabase/functions/_shared/apply-automation.ts, itself a copy of the
  -- worker's ADAPTERS keys. IF THAT LIST CHANGES, THIS CHANGES IN THE SAME
  -- COMMIT, and the mirror test fails until it does.
  SELECT ARRAY['breezy','personio','pinpoint','teamtailor']::text[];
$$;

REVOKE ALL ON FUNCTION public.one_click_vendors() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.one_click_vendors() TO service_role;

COMMENT ON FUNCTION public.one_click_vendors() IS
  'The vendors the apply agent can complete a form on: the SQL copy of SENDABLE_VENDORS (apply-automation.ts) and the worker ADAPTERS. get_explore_field_grid reads it for one_click_n. Oracle is not on it (its adapter never reaches a submit).';

CREATE OR REPLACE FUNCTION public.get_explore_field_grid()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  WITH
  served AS (
    SELECT p.category, p.remote, p.work_mode, p.salary, p.salary_min_annual,
           p.salary_rank_usd, p.experience_band, p.employment_type,
           p.posted_at,
           -- ONE-CLICK APPLY IS A HAND COPY OF ANOTHER RUNTIME'S LIST, kept
           -- in ONE SQL place: public.one_click_vendors() mirrors
           -- SENDABLE_VENDORS in supabase/functions/_shared/apply-automation.ts,
           -- which is itself a hand copy of the worker's ADAPTERS keys -- there
           -- is no import across Node, Deno and SQL. A vendor listed there and
           -- not in the worker prices a chip against roles the agent will
           -- refuse; a vendor in the worker and not there undercounts the one
           -- feature that pins this board to a slice a person can reach.
           (p.source = ANY (public.one_click_vendors()))
             AS one_click
    FROM public.job_board_postings p
    WHERE p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
  ),
  agg AS (
    SELECT
      s.category,
      -- n: served postings in this field. THE TILE'S OWN NUMBER, and the
      -- number /jobs?category=<field> will show. Point-in-time, 30-day window.
      count(*)::int AS n,
      -- remote_n: `remote = true`, a boolean that is NOT NULL on every row.
      -- NO CHIP BINDS THIS COLUMN. It is kept because /jobs' own `remote=1`
      -- URL parameter reads it, and it is labelled here so nobody quotes its
      -- full coverage beside a work-mode control.
      count(*) FILTER (WHERE s.remote)::int AS remote_n,
      -- remote_mode_n: `work_mode = 'remote'`, THE POPULATION THE REMOTE CHIP
      -- ACTUALLY OPENS. Free on this pass, and its denominator is work_mode_n
      -- exactly like onsite_n's -- which is the whole point: the pair is
      -- symmetric, and the boolean is not part of it.
      count(*) FILTER (WHERE s.work_mode = 'remote')::int AS remote_mode_n,
      -- onsite_n: `work_mode = 'onsite'`, the STATED mode. Its denominator is
      -- work_mode_n, not n.
      count(*) FILTER (WHERE s.work_mode = 'onsite')::int AS onsite_n,
      -- work_mode_n: postings that stated ANY mode. The onsite chip's real
      -- denominator; everything else is silence, never onsite.
      count(*) FILTER (WHERE s.work_mode IS NOT NULL)::int AS work_mode_n,
      -- pay_floor_n: `salary_rank_usd IS NOT NULL` -- a parsed figure in a
      -- currency we identified. THE ONLY POPULATION A PAY FLOOR CAN SEE, and
      -- the number a "$80k+" chip must quote. See 20260909100000.
      count(*) FILTER (WHERE s.salary_rank_usd IS NOT NULL)::int AS pay_floor_n,
      -- stated_pay_n: `salary_min_annual IS NOT NULL` -- a parsed figure in any
      -- currency. What the states-pay filter binds. Wider than pay_floor_n.
      count(*) FILTER (WHERE s.salary_min_annual IS NOT NULL)::int AS stated_pay_n,
      -- pay_text_n: `salary IS NOT NULL` -- the employer wrote SOMETHING in a
      -- pay field, parseable or not. A transparency statistic; no filter binds
      -- it, and no pay control may quote it.
      count(*) FILTER (WHERE s.salary IS NOT NULL)::int AS pay_text_n,
      -- experience_n: a stated band. 'unspecified' is a stated value meaning
      -- nothing was stated and is excluded here exactly as the filter excludes
      -- it, so this is the population a band chip can reach.
      count(*) FILTER (WHERE s.experience_band IS NOT NULL
                         AND s.experience_band <> 'unspecified')::int AS experience_n,
      -- employment_type_n: a stated employment type. Same NULL-discard shape.
      count(*) FILTER (WHERE s.employment_type IS NOT NULL)::int AS employment_type_n,
      -- dated_n: `posted_at IS NOT NULL` -- the employer stated a date. THE
      -- DENOMINATOR OF EVERY FRESHNESS CHIP, because an undated posting can
      -- never match one however new it is.
      count(*) FILTER (WHERE s.posted_at IS NOT NULL)::int AS dated_n,
      -- week_n: `posted_at >= now() - 7 days`, the employer's stated date and
      -- never effective_posted. Bounded by dated_n by construction.
      count(*) FILTER (WHERE s.posted_at >= now() - interval '7 days')::int AS week_n,
      -- one_click_n: postings on a vendor the apply agent can actually drive.
      -- A cross-runtime mirror -- see `one_click` in the `served` CTE above.
      count(*) FILTER (WHERE s.one_click)::int AS one_click_n
    FROM served s
    GROUP BY s.category
  ),
  tiles AS (SELECT * FROM agg WHERE n >= 50)
  SELECT jsonb_build_object(
    -- PROVENANCE, on the object rather than on each number: one scan, one
    -- instant, one window. A count with no date basis is a claim.
    'at',            now(),
    'window_days',   30,
    'week_days',     7,
    'min_field_n',   50,
    -- board: the WHOLE serving population, floors and all. This is the
    -- denominator a reach sentence divides by.
    'board', (SELECT jsonb_build_object(
                'n',                  COALESCE(sum(n), 0)::int,
                'remote_n',           COALESCE(sum(remote_n), 0)::int,
                'remote_mode_n',      COALESCE(sum(remote_mode_n), 0)::int,
                'onsite_n',           COALESCE(sum(onsite_n), 0)::int,
                'work_mode_n',        COALESCE(sum(work_mode_n), 0)::int,
                'pay_floor_n',        COALESCE(sum(pay_floor_n), 0)::int,
                'stated_pay_n',       COALESCE(sum(stated_pay_n), 0)::int,
                'pay_text_n',         COALESCE(sum(pay_text_n), 0)::int,
                'experience_n',       COALESCE(sum(experience_n), 0)::int,
                'employment_type_n',  COALESCE(sum(employment_type_n), 0)::int,
                'dated_n',            COALESCE(sum(dated_n), 0)::int,
                'week_n',             COALESCE(sum(week_n), 0)::int,
                'one_click_n',        COALESCE(sum(one_click_n), 0)::int,
                -- fields_n: how many categories exist at all, tiled or not.
                'fields_n',           count(*)::int
              ) FROM agg),
    -- tiled_n: the sum of the tiles ACTUALLY RETURNED. Published so a caller
    -- can state its reach as a measured fraction rather than assuming the
    -- tiles partition the board -- they do only while every category clears
    -- min_field_n.
    'tiled_n',  (SELECT COALESCE(sum(n), 0)::int FROM tiles),
    'tiles_n',  (SELECT count(*)::int FROM tiles),
    'fields',   (SELECT COALESCE(jsonb_object_agg(t.category, to_jsonb(t) - 'category'), '{}'::jsonb)
                 FROM tiles t)
  );
$$;

-- Cron-fed, like every other Explore aggregate: this is a full pass over the
-- serving population and an anon-callable exact scan of the whole corpus is a
-- load test anyone can run. It reaches the page through the explore cache,
-- which get_explore_cache() already serves to anon.
REVOKE ALL ON FUNCTION public.get_explore_field_grid() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_explore_field_grid() TO service_role;

-- ── self-check, exercised ───────────────────────────────────────────────────
DO $$
DECLARE
  v_fn oid := to_regprocedure('public.get_explore_field_grid()');
  v_list oid := to_regprocedure('public.one_click_vendors()');
  v_vendor text;
BEGIN
  IF v_fn IS NULL OR v_list IS NULL THEN
    RAISE EXCEPTION 'self-check: get_explore_field_grid or one_click_vendors is missing';
  END IF;
  -- The list itself, asked: every vendor the worker can send on, and Oracle
  -- not among them.
  FOREACH v_vendor IN ARRAY ARRAY['breezy', 'personio', 'pinpoint', 'teamtailor'] LOOP
    IF NOT (v_vendor = ANY (public.one_click_vendors())) THEN
      RAISE EXCEPTION 'self-check: % is sendable and one_click_vendors() leaves it out', v_vendor;
    END IF;
  END LOOP;
  IF 'oracle' = ANY (public.one_click_vendors()) OR cardinality(public.one_click_vendors()) <> 4 THEN
    RAISE EXCEPTION 'self-check: one_click_vendors() still counts Oracle, or holds a vendor the worker cannot send on';
  END IF;
  -- The grid reads that list and no copy of its own.
  IF (SELECT prosrc FROM pg_proc WHERE oid = v_fn) NOT LIKE '%public.one_click_vendors()%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = v_fn) LIKE '%''oracle''%' THEN
    RAISE EXCEPTION 'self-check: get_explore_field_grid keeps its own vendor list';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn)
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn AND proconfig::text LIKE '%search_path=public%') THEN
    RAISE EXCEPTION 'self-check: get_explore_field_grid lost SECURITY DEFINER or its search_path';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_list, 'EXECUTE') OR has_function_privilege('authenticated', v_list, 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: get_explore_field_grid or one_click_vendors is executable by a client role';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: service_role cannot execute get_explore_field_grid';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
