-- /v1 NAMES THE EMPLOYERS WHOSE ROWS IT WITHHOLDS.
--
-- OWNER DECISION 2026-10-08 (4): SmartRecruiters postings are withheld from the
-- paid /v1 API and the MCP connector until SmartRecruiters (SAP) grants
-- permission. public-api binds `source NOT IN (...)` on every row it returns,
-- but /v1/companies lists employers from the board's cached facet, which
-- carries a company_token and no source. The federal feed's one token IS its
-- vendor code; a SmartRecruiters employer has its own token, so the directory
-- kept listing employers whose postings /v1/jobs can never return, and
-- ?company_token=<one of them> answered an empty 200.
--
-- v1_withheld_company_tokens(p_sources) returns the distinct company_token of
-- the postings from those sources as one jsonb array. public-api reads it once
-- an hour per isolate. It walks job_board_postings_source_posted_idx on the
-- named sources only (about 79,000 rows for SmartRecruiters).
--
-- SECURITY DEFINER like every function that reads the corpus (the key-wall
-- lockdown, 20260827130000, holds that an invoker reader of
-- job_board_postings returns blank rows to a client instead of an error),
-- and executable by service_role only: it is a reader for one edge function,
-- not a client RPC, so no client role can call it. Safe to re-run.

CREATE OR REPLACE FUNCTION public.v1_withheld_company_tokens(p_sources text[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(t.company_token ORDER BY t.company_token), '[]'::jsonb)
    FROM (
      SELECT DISTINCT p.company_token
        FROM public.job_board_postings p
       WHERE p.source = ANY(coalesce(p_sources, '{}'::text[]))
         AND p.company_token IS NOT NULL
    ) t;
$$;

REVOKE ALL ON FUNCTION public.v1_withheld_company_tokens(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v1_withheld_company_tokens(text[]) TO service_role;

COMMENT ON FUNCTION public.v1_withheld_company_tokens(text[]) IS
  'Service-role reader for public-api: the distinct company_token of postings from the sources /v1 may not redistribute (owner decision 2026-10-08: usajobs, smartrecruiters), as a jsonb array, so /v1/companies omits their employers and ?company_token= refuses them with 451 (20261009122000).';

DO $$
DECLARE
  v_fn oid := to_regprocedure('public.v1_withheld_company_tokens(text[])');
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION '20261009122000: v1_withheld_company_tokens(text[]) is missing';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn) THEN
    RAISE EXCEPTION '20261009122000: v1_withheld_company_tokens must be SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '20261009122000: v1_withheld_company_tokens is executable by a client role';
  END IF;
  IF public.v1_withheld_company_tokens('{}'::text[]) <> '[]'::jsonb THEN
    RAISE EXCEPTION '20261009122000: an empty source list must name no employer';
  END IF;
  IF jsonb_typeof(public.v1_withheld_company_tokens(ARRAY['zz-not-a-vendor'])) <> 'array' THEN
    RAISE EXCEPTION '20261009122000: the reader must answer a jsonb array';
  END IF;
END
$$;
