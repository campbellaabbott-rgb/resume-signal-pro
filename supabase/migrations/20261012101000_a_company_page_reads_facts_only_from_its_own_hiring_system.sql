-- A COMPANY PAGE READS FACTS ONLY FROM ITS OWN HIRING SYSTEM.
--
-- Company profiles, phase 0 (plan 2026-10-11, sections 2, 4 and 9). The three
-- lander readers that pool boards -- get_company_intel, get_similar_companies
-- and get_company_financials -- pool them under employer_key(source, token)
-- (20261012100000) and nothing looser.
--
-- WHAT WAS WRONG, measured 2026-10-11 against the live readers:
--   * get_company_financials('blackstone') answered Blackstone Inc. (BX,
--     FY2025 revenue $14.45B). The token blackstone is the Workable board
--     "Blackstone Shooting Sports"; Blackstone Inc. is the Workday tenant
--     blackstone~wd1~... The reader matched company_financials.slug to the
--     token's first segment, which no vendor owns. 'costar' answered CoStar
--     Group (CSGP) for the Greenhouse board "Co-Star", the astrology app.
--     Six SEC slugs sit where two vendors share the segment: accenture,
--     blackstone, costar, lifestance, medline, samsara.
--   * 20261009160200 already stopped the intel and similar readers pooling
--     every UKG client under recruiting~ and every EU pod board under eu~
--     (1,249 landers), by making every non-Workday token its own employer.
--     That also split one UKG client's several career sites and one Oracle
--     tenant's several sites, which the matcher's rule keeps together, and it
--     still pooled any two vendors that carry the same exact token.
--
-- THE RULE NOW, in each reader's "same employer as p_token" predicate:
--   the first-segment equality is KEPT, because it is what the slug
--   expression index job_board_postings_slug_serving_idx serves (20260827140000
--   explains the 15-second sequential scan any other shape costs here);
--   AND employer_segment(company_token) = employer_segment(p_token);
--   AND source IN (the hiring systems p_token's own postings come from).
-- So a UKG client's sites pool and two UKG clients never do; every eu~ board
-- is its own; a Workday or Oracle tenant pools its own sites; and a plain slug
-- never pools with a Workday tenant of the same name on another vendor.
-- A token two vendors carry (139 in the catalogue) still answers both vendors'
-- postings here: the database cannot tell them apart by token. The company
-- page reads those tokens from the catalogue (src/lib/board-collisions.ts)
-- and shows no employer-level block on them, only the per-vendor split, which
-- get_company_intel now returns as open_by_source.
--
-- get_company_intel: the employer's postings carry the source rule; the
--   headcount join follows them (it took max(employee_count) over every
--   merged token); the snapshot series reads the boards those postings name
--   plus the lander's own board (snapshots carry no source); and the answer
--   gains open_by_source, open roles on THIS token per hiring system.
-- get_similar_companies: the dominant field is read from the employer's own
--   postings under the rule, and the exclusion names the employer's own
--   boards by token, so the category scan stays index-only on
--   job_board_postings_cat_token_serving_idx (company_token is in it; source
--   is not). A board of another vendor that only shares the segment is a
--   different employer and may be listed.
-- get_company_financials: a row attaches only where its new matched_source
--   is a hiring system the token's own postings come from, and the token's
--   employer segment is the slug.
--
-- company_financials.matched_source: the hiring system each SEC row was
-- matched for. Six slugs whose segment spans two vendors are decided by hand,
-- from the reads layoff_employer_aliases recorded (20260918200000) and the
-- live boards (2026-10-11): accenture workday (5,265 open; the Pinpoint board
-- of 24 is also Accenture's and loses the card -- one source per row),
-- blackstone workday (the Workable board was read and rejected), costar
-- workday (the Greenhouse board was read and rejected), lifestance lever
-- (1,042 open, "LifeStance Health"; the Workday tenant has 66), medline
-- workday (Medline in the US; the Teamtailor board is Medline Europe), samsara
-- greenhouse (Samsara Inc.'s 4 MB board; the Pinpoint board is unverified).
-- 170 more are derived: every catalogue board whose segment is the slug sits
-- on one hiring system. trustmark is NOT derived: 20260918200000 read both of
-- its Workday sites and rejected them (Trustmark Companies of Lake Forest, a
-- mutual, not Trustmark Corp, CIK 36146), so the row is matched to no board
-- and stays NULL. comcast left the catalogue and stays NULL. A NULL row
-- attaches nowhere.
--
-- REFUSES A DRIFTED LIVE DEFINITION. Each reader is replaced whole, so the
-- live body must be one this file knows: the 20260827140000 body, the body
-- 20261009160200 rewrote it to, or this file's own (a re-run). Known bodies are
-- matched by the md5 of their whitespace-collapsed source; anything else
-- raises with the hash it found rather than being overwritten.
--
-- Signatures, return types, SECURITY DEFINER, search_path and timeouts are
-- the live ones; grants are restated (EXECUTE for anon, authenticated and
-- service_role, nothing for PUBLIC). Self-verifying, safe to re-run: the
-- column is added if missing and matched_source is only ever filled where it
-- is NULL, so a re-run never overturns a value set by hand afterwards.

SET LOCAL statement_timeout = '2min';

DO $pre$
DECLARE
  r     record;
  v_h   text;
  v_src text;
BEGIN
  IF to_regprocedure('public.employer_segment(text)') IS NULL THEN
    RAISE EXCEPTION 'employer_segment(text) is missing: apply 20261012100000 first';
  END IF;
  FOR r IN
    SELECT * FROM (VALUES
      ('public.get_company_intel(text)',             ARRAY['45eba6aec461bcf96612f0f16e7dd465', 'f56ec1740cc89f7c6956bde42d0d8dbd']),
      ('public.get_similar_companies(text,integer)', ARRAY['a596b55855157d400f48521eb2d1f3b3', '5d4a494010a4e957a26fcf82ed825b6c']),
      ('public.get_company_financials(text)',        ARRAY['b7fdb96c5ffcd5e987ff452b40608d76'])
    ) AS t(fn, known)
  LOOP
    IF to_regprocedure(r.fn) IS NULL THEN
      RAISE EXCEPTION '% does not exist: this file replaces a live reader and creates none', r.fn;
    END IF;
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    IF position('public.employer_segment(' IN v_src) > 0 THEN
      RAISE NOTICE '% already pools by the employer key (a re-run)', r.fn;
      CONTINUE;
    END IF;
    v_h := md5(btrim(regexp_replace(v_src, '\s+', ' ', 'g')));
    IF NOT (v_h = ANY (r.known)) THEN
      RAISE EXCEPTION '% live body (md5 %) is none this file knows (20260827140000 or 20261009160200): it drifted -- read pg_get_functiondef and fold its change in rather than overwrite it', r.fn, v_h;
    END IF;
  END LOOP;
END
$pre$;

-- ── company_financials.matched_source ───────────────────────────────────────

ALTER TABLE public.company_financials ADD COLUMN IF NOT EXISTS matched_source text;

COMMENT ON COLUMN public.company_financials.matched_source IS
  'The hiring system (job_board_postings.source) of the board this SEC row was matched for. '
  'get_company_financials attaches the row only to a token whose own postings come from this system '
  'and whose employer_segment is the slug; NULL attaches nowhere (20261012101000).';

UPDATE public.company_financials f
   SET matched_source = d.source
  FROM (VALUES
    ('accenture', 'workday'), ('blackstone', 'workday'), ('costar', 'workday'),
    ('lifestance', 'lever'), ('medline', 'workday'), ('samsara', 'greenhouse')
  ) AS d(slug, source)
 WHERE f.slug = d.slug
   AND f.matched_source IS NULL;

UPDATE public.company_financials f
   SET matched_source = d.source
  FROM (VALUES
    ('AECOM2', 'smartrecruiters'), ('AbbVie', 'smartrecruiters'), ('Freshworks', 'smartrecruiters'), ('Grab', 'smartrecruiters'),
    ('Sandisk', 'smartrecruiters'), ('ServiceNow', 'smartrecruiters'), ('SonicAutomotive', 'smartrecruiters'), ('WesternDigital', 'smartrecruiters'),
    ('adobe', 'workday'), ('affirm', 'greenhouse'), ('airbnb', 'greenhouse'), ('alcon', 'workday'),
    ('allegion', 'workday'), ('allstate', 'workday'), ('amcor', 'workday'), ('andersen', 'workday'),
    ('appian', 'greenhouse'), ('aptiv', 'workday'), ('asml', 'workday'), ('assurant', 'workday'),
    ('astrazeneca', 'workday'), ('athene', 'workday'), ('att', 'workday'), ('autodesk', 'workday'),
    ('autolivgroup', 'teamtailor'), ('bakerhughes', 'workday'), ('barclays', 'workday'), ('bjswholesaleclub', 'workday'),
    ('blackrock', 'workday'), ('boeing', 'workday'), ('borgwarner', 'workday'), ('braze', 'greenhouse'),
    ('brinks', 'workday'), ('bristolmyerssquibb', 'workday'), ('broadcom', 'workday'), ('brunswick', 'workday'),
    ('campingworld', 'workday'), ('capri', 'workday'), ('cardinalhealth', 'workday'), ('carmax', 'workday'),
    ('carters', 'workday'), ('carvana', 'greenhouse'), ('cat', 'workday'), ('centene', 'workday'),
    ('ciandt', 'lever'), ('cigna', 'workday'), ('cinemark', 'workday'), ('clarivate', 'workday'),
    ('cloudflare', 'greenhouse'), ('copart', 'workday'), ('coreweave', 'greenhouse'), ('coupang', 'greenhouse'),
    ('crowdstrike', 'workday'), ('cvshealth', 'workday'), ('datadog', 'greenhouse'), ('davita', 'workday'),
    ('dexcom', 'workday'), ('diageo', 'workday'), ('dickssportinggoods', 'workday'), ('dollartree', 'workday'),
    ('donaldson', 'workday'), ('draftkings', 'workday'), ('ebay', 'workday'), ('ecolab', 'workday'),
    ('endava', 'smartrecruiters'), ('entegris', 'workday'), ('envista', 'workday'), ('equifax', 'workday'),
    ('equinix', 'workday'), ('expedia', 'workday'), ('fedex', 'workday'), ('fiserv', 'workday'),
    ('flextronics', 'workday'), ('flowserve', 'workday'), ('formfactor', 'workday'), ('fortrea', 'workday'),
    ('franklin-electric', 'pinpoint'), ('gartner', 'workday'), ('generac', 'workday'), ('generalmotors', 'workday'),
    ('genpact', 'workday'), ('genpt', 'workday'), ('gevernova', 'workday'), ('gitlab', 'greenhouse'),
    ('globalfoundries', 'workday'), ('greif', 'workday'), ('humana', 'workday'), ('huntsman', 'workday'),
    ('iheartmedia', 'workday'), ('insulet', 'workday'), ('integer', 'workday'), ('intel', 'workday'),
    ('invesco', 'workday'), ('iqvia', 'workday'), ('jabil', 'workday'), ('jj', 'workday'),
    ('kenvue', 'workday'), ('kyndryl', 'workday'), ('labcorp', 'workday'), ('lambweston', 'workday'),
    ('leidos', 'workday'), ('lennar', 'workday'), ('lumentum', 'workday'), ('mckesson', 'workday'),
    ('medtronic', 'workday'), ('millerknoll', 'workday'), ('mineralystherapeutics', 'greenhouse'), ('mongodb', 'greenhouse'),
    ('moog', 'workday'), ('morningstar', 'workday'), ('motorolasolutions', 'workday'), ('mtb', 'workday'),
    ('natera', 'greenhouse'), ('nice', 'greenhouse'), ('nike', 'workday'), ('novartis', 'workday'),
    ('nvidia', 'workday'), ('okta', 'greenhouse'), ('organon', 'workday'), ('oscar', 'greenhouse'),
    ('pacs', 'workday'), ('pae', 'workday'), ('paloaltonetworks', 'workday'), ('parsons', 'workday'),
    ('pfizer', 'workday'), ('pinterest', 'greenhouse'), ('publicstorage', 'smartrecruiters'), ('purestorage', 'greenhouse'),
    ('qualys', 'workday'), ('relx', 'workday'), ('resmed', 'workday'), ('revolutionmedicines', 'greenhouse'),
    ('rocketlab', 'greenhouse'), ('rockwellautomation', 'workday'), ('salesforce', 'workday'), ('sanofi', 'workday'),
    ('sbdinc', 'workday'), ('sentinellabs', 'greenhouse'), ('sharkninjaoperatingllc', 'greenhouse'), ('shell', 'workday'),
    ('snowflake', 'ashby'), ('stryker', 'workday'), ('sunbeltrentals', 'workday'), ('sunrun', 'workday'),
    ('sysco', 'workday'), ('tapestry', 'workday'), ('taskus', 'workday'), ('terex', 'workday'),
    ('thermofisher', 'workday'), ('toast', 'greenhouse'), ('townsquaremedia', 'greenhouse'), ('transunion', 'workday'),
    ('travelers', 'workday'), ('trimble', 'workday'), ('twilio', 'greenhouse'), ('tysonfoods', 'workday'),
    ('uhaul', 'workday'), ('unilever', 'workday'), ('unisys', 'workday'), ('urbancompass', 'greenhouse'),
    ('viatris', 'workday'), ('wasteconnections', 'workday'), ('westlake', 'workday'), ('williams', 'workday'),
    ('woodward', 'workday'), ('workday', 'workday'), ('xylem', 'workday'), ('zillow', 'workday'),
    ('zoetis', 'workday'), ('zscaler', 'greenhouse')
  ) AS d(slug, source)
 WHERE f.slug = d.slug
   AND f.matched_source IS NULL;

-- ── the readers ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_company_intel(p_token text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH own_sources AS MATERIALIZED (
    SELECT DISTINCT q.source FROM public.job_board_postings q WHERE q.company_token = p_token
  ),
  posts AS MATERIALIZED (
    SELECT p.company_token, p.source, p.category, p.country, p.salary_currency, p.salary_min_annual
    FROM public.job_board_postings p
    WHERE split_part(p_token, '~', 1) = split_part(p.company_token, '~', 1)
      AND public.employer_segment(p.company_token) = public.employer_segment(p_token)
      AND p.source IN (SELECT o.source FROM own_sources o)
      AND p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
  ),
  prof AS (
    SELECT max(pr.employee_count) AS employees,
           (array_agg(pr.employee_basis ORDER BY pr.employee_count DESC NULLS LAST))[1] AS employee_basis,
           (array_agg(pr.yc_batch ORDER BY pr.employee_count DESC NULLS LAST))[1] AS yc_batch
    FROM public.company_profiles pr
    WHERE pr.company_token IN (SELECT DISTINCT company_token FROM posts)
  ),
  sal AS (
    SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY salary_min_annual))::numeric, 0) AS median_usd_floor,
           count(*)::int AS usd_n
    FROM posts
    WHERE salary_currency = 'USD' AND salary_min_annual IS NOT NULL AND salary_min_annual > 0
  ),
  cats AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('category', category, 'n', n) ORDER BY n DESC), '[]'::jsonb) AS v
    FROM (
      SELECT category, count(*)::int AS n FROM posts
      WHERE category IS NOT NULL AND category <> '' AND category <> 'other'
      GROUP BY category ORDER BY n DESC LIMIT 3
    ) c
  ),
  countries AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('country', country, 'n', n) ORDER BY n DESC), '[]'::jsonb) AS v
    FROM (
      SELECT country, count(*)::int AS n FROM posts
      WHERE country IS NOT NULL AND country <> ''
      GROUP BY country ORDER BY n DESC LIMIT 3
    ) c
  ),
  snaps AS MATERIALIZED (
    SELECT s.snapshot_date, sum(s.open_roles)::int AS open_roles
    FROM public.job_board_company_snapshots s
    WHERE (s.company_token = p_token OR s.company_token IN (SELECT DISTINCT company_token FROM posts))
      AND s.snapshot_date >= current_date - 7
    GROUP BY s.snapshot_date
  ),
  trend AS (
    SELECT CASE WHEN (SELECT count(*) FROM snaps) >= 2 THEN
             (SELECT open_roles FROM snaps ORDER BY snapshot_date DESC LIMIT 1)
             - (SELECT open_roles FROM snaps ORDER BY snapshot_date ASC LIMIT 1)
           END::int AS net_7d
  ),
  by_source AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('source', b.source, 'open_roles', b.n) ORDER BY b.n DESC, b.source), '[]'::jsonb) AS v
    FROM (
      SELECT source, count(*)::int AS n FROM posts
      WHERE company_token = p_token
      GROUP BY source
    ) b
  )
  SELECT jsonb_build_object(
    'employees', prof.employees,
    'employee_basis', prof.employee_basis,
    'yc_batch', prof.yc_batch,
    'median_usd_floor', sal.median_usd_floor,
    'usd_n', sal.usd_n,
    'categories', cats.v,
    'countries', countries.v,
    'net_7d', trend.net_7d,
    'open_by_source', by_source.v
  )
  FROM prof, sal, cats, countries, trend, by_source;
$$;

CREATE OR REPLACE FUNCTION public.get_similar_companies(p_token text, p_limit int DEFAULT 6)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH own_sources AS MATERIALIZED (
    SELECT DISTINCT q.source FROM public.job_board_postings q WHERE q.company_token = p_token
  ),
  own AS MATERIALIZED (
    SELECT p.company_token, p.category
    FROM public.job_board_postings p
    WHERE split_part(p_token, '~', 1) = split_part(p.company_token, '~', 1)
      AND public.employer_segment(p.company_token) = public.employer_segment(p_token)
      AND p.source IN (SELECT o.source FROM own_sources o)
      AND p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
  ),
  dom AS MATERIALIZED (
    SELECT w.category
    FROM own w
    WHERE w.category IS NOT NULL AND w.category <> '' AND w.category <> 'other'
    GROUP BY w.category ORDER BY count(*) DESC LIMIT 1
  ),
  own_boards AS MATERIALIZED (
    SELECT p_token AS company_token
    UNION
    SELECT w.company_token FROM own w
  ),
  agg AS MATERIALIZED (
    SELECT p.company_token,
           max(p.company) AS company,
           count(*)::int  AS open_roles
    FROM public.job_board_postings p
    WHERE p.category = (SELECT category FROM dom)
      AND p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
      AND NOT EXISTS (SELECT 1 FROM own_boards b WHERE b.company_token = p.company_token)
      AND p.company <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.showcase_excluded x WHERE x.company_token = p.company_token
      )
    GROUP BY p.company_token
    HAVING count(*) >= 3
    ORDER BY count(*) DESC
    LIMIT GREATEST(p_limit, 1)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'company', a.company, 'company_token', a.company_token,
           'open_roles', a.open_roles, 'employees', pr.employee_count,
           'employee_basis', pr.employee_basis,
           'category', (SELECT category FROM dom))
           ORDER BY a.open_roles DESC), '[]'::jsonb)
  FROM agg a
  LEFT JOIN public.company_profiles pr ON pr.company_token = a.company_token;
$$;

CREATE OR REPLACE FUNCTION public.get_company_financials(p_token text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
       'ticker', f.ticker, 'exchange', f.exchange, 'sec_name', f.sec_name,
       'cik', f.cik, 'currency', f.currency, 'series', f.series)
     FROM public.company_financials f
     WHERE f.slug = split_part(p_token, '~', 1)
       AND f.slug = public.employer_segment(p_token)
       AND f.matched_source IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.job_board_postings q
          WHERE q.company_token = p_token AND q.source = f.matched_source
       )
     LIMIT 1),
    'null'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.get_company_intel(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_similar_companies(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_company_financials(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_intel(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_similar_companies(text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_company_financials(text) TO anon, authenticated, service_role;

-- ── self-check ──────────────────────────────────────────────────────────────

DO $verify$
DECLARE
  r       record;
  v_src   text;
  v_null  int;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.get_company_intel(text)'),
      ('public.get_similar_companies(text,integer)'),
      ('public.get_company_financials(text)')
    ) AS t(fn)
  LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    IF position('public.employer_segment(' IN v_src) = 0 THEN
      RAISE EXCEPTION '% does not pool by the employer segment', r.fn;
    END IF;
    IF position('split_part(p_token, ''~'', 1) = split_part(p.company_token, ''~'', 1)' IN v_src) = 0
       AND position('f.slug = split_part(p_token, ''~'', 1)' IN v_src) = 0 THEN
      RAISE EXCEPTION '% lost the first-segment predicate the slug index serves', r.fn;
    END IF;
    IF position('p.source IN (SELECT o.source FROM own_sources o)' IN v_src) = 0
       AND position('q.source = f.matched_source' IN v_src) = 0 THEN
      RAISE EXCEPTION '% does not name the hiring system', r.fn;
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn)) THEN
      RAISE EXCEPTION '% is no longer SECURITY DEFINER: anon would read job_board_postings with its own rights', r.fn;
    END IF;
    IF NOT has_function_privilege('anon', r.fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% lost its anon grant: every company lander would lose it', r.fn;
    END IF;
  END LOOP;

  IF position('open_by_source' IN (SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.get_company_intel(text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'get_company_intel does not return open_by_source: a shared token''s page has no per-vendor count';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'company_financials' AND column_name = 'matched_source') THEN
    RAISE EXCEPTION 'company_financials.matched_source is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_financials WHERE slug = 'blackstone' AND matched_source = 'workable') THEN
    RAISE EXCEPTION 'blackstone is matched to the Workable board, which 20260918200000 read and rejected';
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_financials WHERE slug = 'costar' AND matched_source = 'greenhouse') THEN
    RAISE EXCEPTION 'costar is matched to the Greenhouse board, which 20260918200000 read and rejected';
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_financials
              WHERE slug IN ('accenture', 'blackstone', 'costar', 'lifestance', 'medline', 'samsara')
                AND matched_source IS NULL) THEN
    RAISE EXCEPTION 'a hand-decided slug was left unmatched';
  END IF;
  -- Whatever the data holds, a token that is not the board a row was matched
  -- for gets no row: the Workable board blackstone and the Greenhouse board
  -- costar answer null.
  IF public.get_company_financials('blackstone') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'get_company_financials(blackstone) still answers %: Blackstone Inc.''s figures on Blackstone Shooting Sports', public.get_company_financials('blackstone') ->> 'ticker';
  END IF;
  IF public.get_company_financials('costar') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'get_company_financials(costar) still answers %: CoStar Group''s figures on Co-Star', public.get_company_financials('costar') ->> 'ticker';
  END IF;

  SELECT count(*)::int INTO v_null FROM public.company_financials WHERE matched_source IS NULL;
  RAISE NOTICE 'company_financials rows matched to no board (attach nowhere): % (expected 2: comcast, trustmark)', v_null;
END
$verify$;
