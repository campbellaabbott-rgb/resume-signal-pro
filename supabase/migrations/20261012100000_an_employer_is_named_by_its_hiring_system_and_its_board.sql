-- AN EMPLOYER IS NAMED BY ITS HIRING SYSTEM AND ITS BOARD.
--
-- Company profiles, phase 0 (plan 2026-10-11, section 4). Two pure helpers
-- every per-employer reader will pool boards by, so one rule is written once.
--
-- employer_segment(token) is the layoff/LCA matcher's rule, copied from
-- layoff_matches_rebuild (20260918100400, re-issued 20260926143145, "WHO IS
-- ONE EMPLOYER"): the token's first '~' segment -- the tenant on Workday and
-- Oracle, the client id on ADP, the slug itself on every plain-slug vendor --
-- except where that segment is a vendor path every client shares. UKG tokens
-- are recruiting~CLIENT~uuid and recruiting2~CLIENT~uuid (1,291 boards under
-- two first segments), so their segment is the path plus the client; the EU
-- pods of Greenhouse and Lever are eu~slug (221 boards under one), so their
-- segment is the whole token. The pglite test evaluates the matcher's own CASE
-- beside this function over every catalogue token and holds them equal.
--
-- employer_key(source, token) = source || ':' || employer_segment(token). The
-- segment alone does not know the vendor: a plain slug on one hiring system
-- equals a Workday tenant on another. The catalogue holds 176 segments that
-- span two vendors (364 boards): 139 exact-token collisions, and 37 more that
-- are all a plain slug beside a Workday tenant -- blackstone (the Workable
-- board is Blackstone Shooting Sports, the Workday tenant is Blackstone Inc.),
-- dupont (duPont REGISTRY on BambooHR, DuPont on Workday), accenture, costar.
-- With the source in the key they are separate employers.
--
-- The TypeScript mirror is src/lib/employer-key.ts; the pglite test
-- an-employer-is-named-by-its-hiring-system-and-its-board.test.ts runs both
-- over the whole catalogue and the fixture pairs.
--
-- INLINABLE ON PURPOSE: LANGUAGE sql, IMMUTABLE, no SET clause, not STRICT
-- (a STRICT body holding a CASE is never inlined), so a reader's WHERE clause
-- costs an expression, not a call. pg_catalog is named outright, so no object
-- on the search path can stand in for split_part.
--
-- Private: EXECUTE is revoked from PUBLIC, anon and authenticated (Supabase
-- grants new functions to both client roles directly) and granted to
-- service_role. The client-callable readers run as their owner and reach the
-- helpers with the owner's rights.
--
-- Self-verifying, safe to re-run.

SET LOCAL statement_timeout = '1min';

CREATE OR REPLACE FUNCTION public.employer_segment(p_token text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $segment$
  SELECT CASE
    WHEN pg_catalog.split_part(p_token, '~', 1) IN ('recruiting', 'recruiting2')
      THEN pg_catalog.split_part(p_token, '~', 1) || '~' || pg_catalog.split_part(p_token, '~', 2)
    WHEN pg_catalog.split_part(p_token, '~', 1) = 'eu' THEN p_token
    ELSE pg_catalog.split_part(p_token, '~', 1)
  END
$segment$;

CREATE OR REPLACE FUNCTION public.employer_key(p_source text, p_token text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $key$
  SELECT p_source || ':' || public.employer_segment(p_token)
$key$;

COMMENT ON FUNCTION public.employer_segment(text) IS
  'The layoff/LCA matcher''s employer segment of a board token (20260918100400): first ''~'' segment, '
  'except recruiting~/recruiting2~ (path plus client) and eu~ (whole token). Not an employer by itself: '
  'pair it with the hiring system through employer_key. Mirror: src/lib/employer-key.ts.';
COMMENT ON FUNCTION public.employer_key(text, text) IS
  'source || '':'' || employer_segment(token): the unit every per-employer reader pools boards under. '
  'Mirror: src/lib/employer-key.ts.';

REVOKE ALL ON FUNCTION public.employer_segment(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.employer_key(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employer_segment(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.employer_key(text, text) TO service_role;

DO $verify$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('recruiting~OLL1000OLLIE~355913c1-206d-48a4-bb34-020064efe845', 'recruiting~OLL1000OLLIE'),
      ('recruiting2~TRO1001TROO~2b13054b-60bb-410d-9136-e52c1c7d9720', 'recruiting2~TRO1001TROO'),
      ('eu~lookers', 'eu~lookers'),
      ('blackstone~wd1~blackstone_careers', 'blackstone'),
      ('blackstone', 'blackstone'),
      ('ejwl~us2~CX', 'ejwl'),
      ('careers.petsmart.com', 'careers.petsmart.com')
    ) AS t(token, want)
  LOOP
    IF public.employer_segment(r.token) IS DISTINCT FROM r.want THEN
      RAISE EXCEPTION 'employer_segment(%) = %, want %', r.token, public.employer_segment(r.token), r.want;
    END IF;
  END LOOP;

  IF public.employer_key('workable', 'blackstone') = public.employer_key('workday', 'blackstone~wd1~blackstone_careers') THEN
    RAISE EXCEPTION 'employer_key pools the Workable board blackstone with the Workday tenant blackstone';
  END IF;
  IF public.employer_key('workday', 'blackstone~wd1~blackstone_careers') <> public.employer_key('workday', 'blackstone~wd1~Blackstone_Campus_Careers') THEN
    RAISE EXCEPTION 'employer_key splits two career sites of one Workday tenant';
  END IF;

  IF (SELECT p.provolatile FROM pg_proc p WHERE p.oid = 'public.employer_segment(text)'::regprocedure) <> 'i'
     OR (SELECT p.provolatile FROM pg_proc p WHERE p.oid = 'public.employer_key(text,text)'::regprocedure) <> 'i' THEN
    RAISE EXCEPTION 'employer_segment and employer_key must be IMMUTABLE';
  END IF;
  IF (SELECT p.prosecdef OR p.proconfig IS NOT NULL FROM pg_proc p WHERE p.oid = 'public.employer_segment(text)'::regprocedure) THEN
    RAISE EXCEPTION 'employer_segment must stay an inlinable INVOKER function with no SET clause';
  END IF;

  IF has_function_privilege('anon', 'public.employer_segment(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.employer_segment(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.employer_key(text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.employer_key(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a client role can execute employer_segment or employer_key';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.employer_key(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lost employer_key';
  END IF;
END
$verify$;
