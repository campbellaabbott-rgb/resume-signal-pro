-- A QUARTER REPLACES ITSELF AND NEVER HALF OF ITSELF.
--
-- The only writer for public.oflc_lca_wages. The operator loader streams the
-- Department's disclosure file, joins the employer names to board tokens and
-- posts the folded cells here in chunks -- every chunk of one run carrying
-- ONE p_run_started_at, and only the LAST chunk passing p_prune, so a run
-- that dies half way leaves the previous quarter whole rather than a mixture
-- of two. That is the contract the mirror writer already uses, and it exists
-- because a half-pruned table is a table whose numbers are from no file at
-- all.
--
-- THE RUN STAMP HAS NO DEFAULT, AND THAT IS THE WHOLE SAFETY OF THE PRUNE.
-- The sweep deletes every row loaded before the stamp it is handed, so a
-- stamp that defaults to the clock would be a DIFFERENT stamp on every chunk
-- of one run: the last chunk's prune would then delete the run's own earlier
-- chunks and leave a quarter of thousands of cells holding the last few
-- hundred, with every employer figure read off it silently wrong rather than
-- absent. That is the shape of the stale-bundle orphan prune that deleted
-- newly merged boards' postings. The chunk sequence is driven by hand through
-- PostgREST, and the party driving it is exactly the one who would take a
-- default, so there is none: a call that omits the stamp is refused by name
-- resolution before any row moves, and a call that passes null is refused in
-- the body with a sentence saying why.
--
-- Service-role only. These cells decide what a wage line prints beside an
-- employer's postings, so a caller who could write them could put any figure
-- under any employer's name.
--
-- The row shape is refused by the TABLE, not by taste: the ordering of the
-- range, the positive floor, the median inside the range, the count above
-- zero, the https link, the SOC and state spellings. This function's own job
-- is the batch contract -- an array, one stamp, prune last -- and reporting
-- what it did. OUT names carry a prefix so none of them is also a column of
-- the table the body writes (the 42702 trap).

SET LOCAL statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.oflc_lca_wages_load(
  p_rows           jsonb,
  p_run_started_at timestamptz,
  p_prune          boolean DEFAULT false
)
RETURNS TABLE (lo_upserted int, lo_pruned int, lo_total int, lo_tokens int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5min'
AS $$
DECLARE
  v_upserted int := 0;
  v_pruned   int := 0;
  v_total    int := 0;
  v_tokens   int := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'oflc_lca_wages_load expects a JSON array of wage cells';
  END IF;
  IF p_run_started_at IS NULL THEN
    RAISE EXCEPTION 'oflc_lca_wages_load needs the run stamp every chunk of this run shares; a null stamp would let the pruning chunk delete the run''s own earlier chunks';
  END IF;

  INSERT INTO public.oflc_lca_wages AS w (
    company_token, soc_code, worksite_state, soc_title,
    wage_low_annual, wage_high_annual, wage_median_annual, filings_n,
    source_file, source_url, fiscal_quarter, published_on, loaded_at
  )
  SELECT DISTINCT ON (e.value->>'company_token', e.value->>'soc_code', e.value->>'worksite_state')
         e.value->>'company_token',
         e.value->>'soc_code',
         upper(e.value->>'worksite_state'),
         NULLIF(btrim(COALESCE(e.value->>'soc_title', '')), ''),
         (e.value->>'wage_low_annual')::numeric,
         (e.value->>'wage_high_annual')::numeric,
         (e.value->>'wage_median_annual')::numeric,
         (e.value->>'filings_n')::int,
         e.value->>'source_file',
         e.value->>'source_url',
         e.value->>'fiscal_quarter',
         (e.value->>'published_on')::date,
         p_run_started_at
  FROM jsonb_array_elements(p_rows) AS e(value)
  WHERE NULLIF(btrim(COALESCE(e.value->>'company_token', '')), '') IS NOT NULL
    AND NULLIF(btrim(COALESCE(e.value->>'soc_code', '')), '') IS NOT NULL
    AND NULLIF(btrim(COALESCE(e.value->>'worksite_state', '')), '') IS NOT NULL
  ON CONFLICT (company_token, soc_code, worksite_state) DO UPDATE SET
    soc_title          = EXCLUDED.soc_title,
    wage_low_annual    = EXCLUDED.wage_low_annual,
    wage_high_annual   = EXCLUDED.wage_high_annual,
    wage_median_annual = EXCLUDED.wage_median_annual,
    filings_n          = EXCLUDED.filings_n,
    source_file        = EXCLUDED.source_file,
    source_url         = EXCLUDED.source_url,
    fiscal_quarter     = EXCLUDED.fiscal_quarter,
    published_on       = EXCLUDED.published_on,
    loaded_at          = EXCLUDED.loaded_at;
  GET DIAGNOSTICS v_upserted = ROW_COUNT;

  IF p_prune THEN
    DELETE FROM public.oflc_lca_wages w WHERE w.loaded_at < p_run_started_at;
    GET DIAGNOSTICS v_pruned = ROW_COUNT;
  END IF;

  SELECT count(*)::int, count(DISTINCT w.company_token)::int
    INTO v_total, v_tokens
    FROM public.oflc_lca_wages w;
  RETURN QUERY SELECT v_upserted, v_pruned, v_total, v_tokens;
END;
$$;

COMMENT ON FUNCTION public.oflc_lca_wages_load(jsonb, timestamptz, boolean) IS
  'Upserts certified LCA wage cells keyed by (company_token, soc_code, worksite_state). Chunked: '
  'every chunk of one run carries the same p_run_started_at and only the last chunk passes p_prune, '
  'so an interrupted run leaves the previous quarter whole. The run stamp is REQUIRED and has no '
  'default: a per-call clock would make the pruning chunk delete the run''s own earlier chunks. Row '
  'shape is enforced by the table. service_role only.';

REVOKE ALL ON FUNCTION public.oflc_lca_wages_load(jsonb, timestamptz, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.oflc_lca_wages_load(jsonb, timestamptz, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.oflc_lca_wages_load(jsonb, timestamptz, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.oflc_lca_wages_load(jsonb, timestamptz, boolean) TO service_role;

-- An overload left behind by a staged edit would be reachable under the same
-- name; lock every signature this name resolves to, whatever its arguments.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'oflc_lca_wages_load'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;
