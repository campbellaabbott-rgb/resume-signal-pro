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

    DELETE FROM public.oflc_lca_wages WHERE loaded_at IS DISTINCT FROM p_run_started_at;
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