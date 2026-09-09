-- TWELVE EMPLOYER CARDS CANNOT REACH THE BOARD, AND A FIELD TILE ALREADY DOES.
--
-- /explore opens on a section of twelve employer cards holding 1,812 open roles
-- against ~938,000 served. 0.19%. Twelve cards drawn from the pool
-- get_explore_denominators counts cannot exceed 11.09% of this board however
-- perfectly they are ranked, and in practice sit under 0.5%. The rigour was
-- never the problem -- the DENOMINATOR was.
--
-- The eighteen categories partition the whole serving population. Every
-- posting carries exactly one (`category text NOT NULL DEFAULT 'other'`), so
-- eighteen tiles reach 100% of what the board serves, and the seventeen named
-- fields plus the 'other' tile are the same set the /jobs facet already uses.
-- The 'other' tile is not a rounding error to hide: it is the largest single
-- bucket on the board, it is unreachable from any named field, and /jobs
-- already takes the parameter that opens it (`inclUncat`, which widens the
-- category predicate to include 'other').
--
-- WHAT THIS FUNCTION IS FOR. Section 1 needs a count per tile. Section 3 needs
-- a count AND a coverage for each constraint chip under the tile the reader
-- chose. Both are FILTER aggregates over one pass, so they are one function:
-- asking twice is how two numbers for one quantity get published.
--
-- IT IS A SERVING SURFACE, SO IT EXCLUDES NOTHING. No showcase_excluded, no
-- agency filter, nothing but the two predicates buildQuery applies. The rule
-- this repo drew once and keeps: an EDITORIAL claim ("who is hiring", "which
-- field is growing") excludes, because one franchise listing its stores is not
-- a market; a SERVING count answers "what is on the board" and must equal what
-- the click shows. Every number here has a link under it. If a tile said
-- 41,203 and the page it opened said 65,769, the tile would be lying about the
-- page it is a button for.
--
-- THE TILES DO NOT SUM TO THE BOARD, AND THAT IS PUBLISHED RATHER THAN HIDDEN.
-- `min_field_n` mirrors get_explore_denominators' `WHERE n >= 50`: a field
-- whose count is a handful is a tile that opens an almost-empty page. The
-- board row is the WHOLE serving population and `tiled_n` is the sum of the
-- tiles actually returned, so a caller can see the gap instead of inferring
-- one. Both floors live in two functions now and must move in one commit --
-- the same standing hazard get_explore_denominators already carries a
-- paragraph about.
--
-- REMOTE AND ONSITE ARE NOT TWO SIDES OF ONE COIN, and a chip pair that
-- implies they are is wrong in a way readers cannot see. `work_mode` is the
-- STATED mode and is NULL wherever nobody said, so BOTH chips are bounded by
-- work_mode_n -- about 30% of the board at the last scan.
--
-- AND THERE ARE TWO REMOTE COLUMNS, WHICH IS THE TRAP THIS FUNCTION FELL INTO.
-- `remote` is a boolean NOT NULL DEFAULT false on every row, so counting it
-- gives a figure with 100% coverage -- a fact about a column NO CHIP ON
-- /explore BINDS. The remote chip is `workMode: "remote"`, i.e.
-- `work_mode = 'remote'`, and the two are different populations: measured live,
-- work_mode = 'remote' is 43,773 rows and remote = true is 40,325, with
-- coverageDisclosure reporting workMode at about 0.28 rather than 1.0. Wiring
-- remote_n into that chip would have printed one query's count beside another
-- query's coverage over a third query's destination. So remote_mode_n exists
-- and IS WHAT THE CHIP READS; remote_n is retained for the boolean's own sake
-- and must never be quoted beside a work-mode control.
--
-- POSTED-THIS-WEEK IS COUNTED ON posted_at, NEVER ON effective_posted. The
-- serving window uses effective_posted = coalesce(posted_at, last_seen)
-- because an undated posting must still be servable; the FRESHNESS FILTER uses
-- posted_at alone, because our discovery date is not a posting age -- the
-- lesson this repo learned twice, most recently when a saved-search badge ran
-- fivefold high on rows whose age nobody knew. week_n is therefore bounded by
-- dated_n, not by n, and both are returned so the chip can say so.

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
           -- ONE-CLICK APPLY IS A HAND COPY OF ANOTHER RUNTIME'S LIST, and
           -- saying so is the only defence available in SQL. This array
           -- mirrors SENDABLE_VENDORS in
           -- supabase/functions/_shared/apply-automation.ts, which is itself a
           -- hand copy of the worker's ADAPTERS keys -- there is no import
           -- across Node, Deno and SQL. IF THAT LIST CHANGES, THIS CHANGES IN
           -- THE SAME COMMIT. A vendor listed here and not there prices a chip
           -- against roles the agent will refuse; a vendor there and not here
           -- undercounts the one feature that pins this board to a slice a
           -- person can actually reach. It is written ONCE, here, so a future
           -- guard has a single spelling to pin.
           (p.source = ANY (ARRAY['breezy','oracle','personio','pinpoint','teamtailor']::text[]))
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

COMMENT ON FUNCTION public.get_explore_field_grid() IS
  'Per-field served counts plus every constraint chip''s count AND its own '
  'denominator, from ONE pass. POPULATION: exactly what the board serves -- '
  'missing_since IS NULL AND effective_posted within 30 days, buildQuery''s own '
  'pair and nothing else. A SERVING SURFACE: it applies NO showcase_excluded '
  'and no agency exclusion, because every number it returns has a /jobs link '
  'under it and a tile that disagrees with the page it opens is lying about the '
  'button it is. Editorial rankings exclude; serving counts do not. DATE BASIS: '
  'point-in-time at `at`, over window_days. '
  'EACH CHIP CARRIES ITS OWN DENOMINATOR BECAUSE THEY DIFFER BY A FACTOR OF '
  'THREE. remote_mode_n and onsite_n both bind `work_mode`, which is NULL '
  'wherever nobody stated a mode, so BOTH have denominator work_mode_n -- '
  'roughly a third of n. Putting a chip beside a full-coverage number without '
  'that is what makes a NULL-discarding filter look like a census. '
  'THERE ARE TWO REMOTE COLUMNS AND ONLY ONE OF THEM IS A CHIP. remote_n '
  'counts the `remote` boolean, which is NOT NULL on every row and therefore '
  'reads as 100% coverage; NO CONTROL ON /explore BINDS IT (the remote chip '
  'sends workMode:"remote"), and quoting it beside that chip prints one '
  'query''s count against another query''s destination -- measured live, '
  'work_mode = ''remote'' is 43,773 rows against remote = true''s 40,325, under '
  'a coverage of about 0.28 rather than 1.0. remote_mode_n is the chip''s '
  'number. remote_n is retained only because /jobs'' own remote=1 parameter '
  'reads that column. '
  'THE THREE PAY COUNTS ARE THREE DIFFERENT QUESTIONS and nest exactly as '
  'get_filter_coverage documents: pay_text_n (salary, raw text, a TRANSPARENCY '
  'statistic that no filter binds) >= stated_pay_n (salary_min_annual, what the '
  'states-pay filter binds) >= pay_floor_n (salary_rank_usd, the only column a '
  'pay FLOOR can compare against, and the only one a "$80k+" chip may quote). '
  'week_n counts posted_at, the EMPLOYER''S stated date, never effective_posted '
  '-- our discovery date is not a posting age -- so its denominator is dated_n '
  'and undated postings can never match a freshness chip however new they are. '
  'one_click_n is a HAND MIRROR of SENDABLE_VENDORS in '
  'supabase/functions/_shared/apply-automation.ts, which is itself a hand mirror '
  'of the worker''s ADAPTERS keys; there is no import across the three runtimes, '
  'so the list must be edited in the same commit in all of them or the chip '
  'prices roles the agent refuses. '
  'THE TILES NEED NOT SUM TO THE BOARD. `fields` returns only categories at or '
  'above min_field_n (50, MIRRORING get_explore_denominators'' own `WHERE n >= '
  '50`, and moving with it in one commit); `board` is the whole serving '
  'population and `tiled_n` is the sum of the tiles returned, so a reach '
  'sentence divides two measured numbers instead of assuming a partition. Every '
  'posting carries exactly one category (NOT NULL DEFAULT ''other''), so the '
  '''other'' tile is the uncategorised bucket -- reachable only through /jobs'' '
  'inclUncat parameter and through no named field -- and it is a tile like any '
  'other, not a residue to hide. Cron-only.';

NOTIFY pgrst, 'reload schema';
