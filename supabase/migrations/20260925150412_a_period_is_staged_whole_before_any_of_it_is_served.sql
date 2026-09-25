-- A PERIOD IS STAGED WHOLE BEFORE ANY OF IT IS SERVED.
--
-- WHAT WAS WRONG. The writer this replaces upserted every chunk straight into
-- public.oflc_lca_wages and deleted the leftovers on the last call. Its own
-- comment, the module that drives it and the guard beside that module all said
-- that a chunk which errors "leaves the previous quarter whole". It does not.
-- The table is keyed on (company_token, soc_code, worksite_state), so a landed
-- chunk OVERWRITES the previous period's row for every key it carries, in
-- place, immediately. A run that died at chunk four of six left three
-- thousand cells of the new period beside two and a half thousand of the old
-- one -- and because the reader scopes to whichever label has the newest
-- publication date resident, the half that landed became THE served period.
-- Every employer whose cells straddled the failure then answered a confident
-- row with its total understated, and every employer in the chunks that never
-- arrived answered a null row, which the reader's own header says never means
-- the employer does not sponsor. No alarm: the once-a-quarter kind is
-- correctly not watched by the heartbeat, and the post-deploy proof read one
-- token, which might well be in a chunk that landed.
--
-- WHAT THIS DOES INSTEAD. Every call stages its rows into
-- public.oflc_lca_wages_stage under the run stamp it was handed. Only the call
-- carrying p_prune touches the live table, and it does the whole replacement
-- in one transaction: delete the resident period, insert this run's staged
-- rows, clear the stage of this run and of any older run that never finished.
-- So an interrupted run leaves the live table exactly as it found it, and
-- there is no moment at which a reader can see half of one period and half of
-- another.
--
-- THE RUN STAMP STILL HAS NO DEFAULT, for a sharper reason than before: the
-- swap inserts the rows carrying the stamp it is handed, so a stamp that
-- defaulted to the clock would swap in the last chunk alone and the run would
-- have loaded a period of thousands of cells holding the last few hundred.
--
-- AN EMPTY SWAP IS REFUSED. A run whose stage holds nothing under its stamp is
-- a well-formed request to delete the period and put nothing in its place, and
-- it is raised rather than performed.
--
-- WHAT lo_upserted AND lo_total MEAN NOW. lo_upserted is rows STAGED by this
-- call. lo_total and lo_tokens are the LIVE table after it -- which, until the
-- swap lands, is the previous period. That is the honest answer to "what can
-- the reader answer with right now", and it is what the read-log row records.
--
-- Service-role only, like the table: a caller who could write these cells
-- could put any figure under any employer's name. OUT names carry a prefix so
-- none of them is also a column of the tables the body writes (the 42702
-- trap).

SET LOCAL statement_timeout = '5min';

-- The staging area. Same shape as the live table plus the run stamp, and the
-- same refusals, so a defective row fails while it is being staged rather than
-- during the one statement that replaces what the public can read.
CREATE TABLE IF NOT EXISTS public.oflc_lca_wages_stage (
  run_started_at     timestamptz NOT NULL,
  company_token      text        NOT NULL,
  soc_code           text        NOT NULL,
  worksite_state     text        NOT NULL,
  soc_title          text,
  wage_low_annual    numeric(14, 2) NOT NULL,
  wage_high_annual   numeric(14, 2) NOT NULL,
  wage_median_annual numeric(14, 2) NOT NULL,
  filings_n          integer     NOT NULL,
  source_file        text        NOT NULL,
  source_url         text        NOT NULL,
  fiscal_quarter     text        NOT NULL,
  published_on       date        NOT NULL,
  coverage_from      date,
  coverage_to        date,
  staged_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oflc_lca_wages_stage_pkey PRIMARY KEY (run_started_at, company_token, soc_code, worksite_state),
  CONSTRAINT oflc_lca_wages_stage_soc_shape CHECK (soc_code ~ '^[0-9]{2}-[0-9]{4}$'),
  CONSTRAINT oflc_lca_wages_stage_state_shape CHECK (worksite_state ~ '^[A-Z]{2}$'),
  CONSTRAINT oflc_lca_wages_stage_low_positive CHECK (wage_low_annual > 0),
  CONSTRAINT oflc_lca_wages_stage_ordered CHECK (wage_high_annual >= wage_low_annual),
  CONSTRAINT oflc_lca_wages_stage_median_inside CHECK (wage_median_annual >= wage_low_annual AND wage_median_annual <= wage_high_annual),
  CONSTRAINT oflc_lca_wages_stage_counted CHECK (filings_n > 0),
  CONSTRAINT oflc_lca_wages_stage_source_https CHECK (source_url LIKE 'https://%'),
  CONSTRAINT oflc_lca_wages_stage_file_named CHECK (btrim(source_file) <> ''),
  CONSTRAINT oflc_lca_wages_stage_quarter_named CHECK (btrim(fiscal_quarter) <> ''),
  CONSTRAINT oflc_lca_wages_stage_coverage_ordered CHECK (coverage_from IS NULL OR coverage_to IS NULL OR coverage_from <= coverage_to)
);

COMMENT ON TABLE public.oflc_lca_wages_stage IS
  'Where a load accumulates until it is complete. One row per (run stamp, board token, SOC code, '
  'worksite state); the swap on the last chunk moves the whole run into public.oflc_lca_wages and '
  'clears this table of that run and of any older one that never finished. Nothing reads it but the '
  'writer: it exists so that an interrupted load cannot be served.';

ALTER TABLE public.oflc_lca_wages_stage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.oflc_lca_wages_stage FROM PUBLIC;
REVOKE ALL ON TABLE public.oflc_lca_wages_stage FROM anon;
REVOKE ALL ON TABLE public.oflc_lca_wages_stage FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.oflc_lca_wages_stage TO service_role;

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
  v_staged   int := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'oflc_lca_wages_load expects a JSON array of wage cells';
  END IF;
  IF p_run_started_at IS NULL THEN
    RAISE EXCEPTION 'oflc_lca_wages_load needs the run stamp every chunk of this run shares; a null stamp would swap in the last chunk alone';
  END IF;

  INSERT INTO public.oflc_lca_wages_stage AS s (
    run_started_at, company_token, soc_code, worksite_state, soc_title,
    wage_low_annual, wage_high_annual, wage_median_annual, filings_n,
    source_file, source_url, fiscal_quarter, published_on, coverage_from, coverage_to
  )
  SELECT DISTINCT ON (e.value->>'company_token', e.value->>'soc_code', e.value->>'worksite_state')
         p_run_started_at,
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
         (NULLIF(btrim(COALESCE(e.value->>'coverage_from', '')), ''))::date,
         (NULLIF(btrim(COALESCE(e.value->>'coverage_to', '')), ''))::date
  FROM jsonb_array_elements(p_rows) AS e(value)
  WHERE NULLIF(btrim(COALESCE(e.value->>'company_token', '')), '') IS NOT NULL
    AND NULLIF(btrim(COALESCE(e.value->>'soc_code', '')), '') IS NOT NULL
    AND NULLIF(btrim(COALESCE(e.value->>'worksite_state', '')), '') IS NOT NULL
  ON CONFLICT (run_started_at, company_token, soc_code, worksite_state) DO UPDATE SET
    soc_title          = EXCLUDED.soc_title,
    wage_low_annual    = EXCLUDED.wage_low_annual,
    wage_high_annual   = EXCLUDED.wage_high_annual,
    wage_median_annual = EXCLUDED.wage_median_annual,
    filings_n          = EXCLUDED.filings_n,
    source_file        = EXCLUDED.source_file,
    source_url         = EXCLUDED.source_url,
    fiscal_quarter     = EXCLUDED.fiscal_quarter,
    published_on       = EXCLUDED.published_on,
    coverage_from      = EXCLUDED.coverage_from,
    coverage_to        = EXCLUDED.coverage_to,
    staged_at          = now();
  GET DIAGNOSTICS v_upserted = ROW_COUNT;

  IF p_prune THEN
    SELECT count(*)::int INTO v_staged
      FROM public.oflc_lca_wages_stage s
     WHERE s.run_started_at = p_run_started_at;
    IF v_staged = 0 THEN
      RAISE EXCEPTION 'oflc_lca_wages_load was asked to complete a run that staged no rows; that is a request to delete the period and put nothing in its place';
    END IF;

    DELETE FROM public.oflc_lca_wages;
    GET DIAGNOSTICS v_pruned = ROW_COUNT;

    INSERT INTO public.oflc_lca_wages (
      company_token, soc_code, worksite_state, soc_title,
      wage_low_annual, wage_high_annual, wage_median_annual, filings_n,
      source_file, source_url, fiscal_quarter, published_on, coverage_from, coverage_to, loaded_at
    )
    SELECT s.company_token, s.soc_code, s.worksite_state, s.soc_title,
           s.wage_low_annual, s.wage_high_annual, s.wage_median_annual, s.filings_n,
           s.source_file, s.source_url, s.fiscal_quarter, s.published_on, s.coverage_from, s.coverage_to,
           p_run_started_at
      FROM public.oflc_lca_wages_stage s
     WHERE s.run_started_at = p_run_started_at;

    DELETE FROM public.oflc_lca_wages_stage s WHERE s.run_started_at <= p_run_started_at;
  END IF;

  SELECT count(*)::int, count(DISTINCT w.company_token)::int
    INTO v_total, v_tokens
    FROM public.oflc_lca_wages w;
  RETURN QUERY SELECT v_upserted, v_pruned, v_total, v_tokens;
END;
$$;

COMMENT ON FUNCTION public.oflc_lca_wages_load(jsonb, timestamptz, boolean) IS
  'Stages certified LCA wage cells under one run stamp and, on the call that passes p_prune, '
  'replaces public.oflc_lca_wages from that stage in a single transaction. No call before that one '
  'touches the live table, so an interrupted load leaves the resident period exactly as it was and '
  'no reader can ever see half of one period beside half of another. The run stamp is REQUIRED and '
  'has no default: the swap takes the rows carrying the stamp it is handed. A completing call whose '
  'stage is empty is refused. lo_upserted counts rows staged by this call; lo_total and lo_tokens '
  'describe the live table as it stands after it. Row shape is enforced by both tables. '
  'service_role only.';

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
