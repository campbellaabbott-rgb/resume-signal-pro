-- THE LOAD CAN BE ASKED WHETHER IT FINISHED.
--
-- WHY THIS EXISTS. The only post-deploy evidence that the wage cells reached
-- the table read ONE board token and printed four passes. A load that had gone
-- wrong in any way that spared that token -- and the token it read sat in the
-- middle of the chunk sequence -- printed exactly the same four passes as a
-- load that worked. There was no way, from outside the database, to ask how
-- many cells are resident, how many employers they cover, or whether more than
-- one period is present, because the table has no policy and the per-employer
-- reader answers one employer at a time by design.
--
-- WHAT IT ANSWERS. One row of aggregates over public.oflc_lca_wages: the cell
-- count, the distinct token count, how many distinct labels are resident (more
-- than one means a load left a mixture and the answer is not about one period),
-- the label and its provenance, the measured span, and the extremes of the
-- filed figures. The last three are the plausibility bound the stat-provenance
-- rule asks for, moved to where a deploy can check it: a band the loader
-- enforces on an operator's machine and the bundle re-checks before posting is
-- worth nothing if nobody looks at what actually landed.
--
-- WHAT IT DOES NOT ANSWER. Nothing about any employer. No token, no
-- occupation, no state, no cell. It is the shape of the load, not its content,
-- so it is safe for the anon key that runs the post-deploy proof -- while the
-- table itself stays unreadable and the per-employer reader keeps its bars.
--
-- An empty table answers a row of zeroes and nulls, never no row: "the load has
-- not been fired yet" is an answer, and a caller that had to interpret an
-- absence would be interpreting it as a failure.
--
-- DEFINER because the table has no policy; STABLE; five-second timeout. OUT
-- names carry a prefix so none is also a column of the table the body reads
-- (the 42702 trap).

SET LOCAL statement_timeout = '1min';

CREATE OR REPLACE FUNCTION public.get_lca_load_state()
RETURNS TABLE (
  ls_cells           int,
  ls_tokens          int,
  ls_periods         int,
  ls_filings         bigint,
  ls_fiscal_quarter  text,
  ls_source_file     text,
  ls_published_on    date,
  ls_coverage_from   date,
  ls_coverage_to     date,
  ls_wage_low        numeric,
  ls_wage_high       numeric,
  ls_max_spread      numeric,
  ls_loaded_at       timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
  SELECT
    count(*)::int                                   AS ls_cells,
    count(DISTINCT w.company_token)::int            AS ls_tokens,
    count(DISTINCT w.fiscal_quarter)::int           AS ls_periods,
    COALESCE(sum(w.filings_n), 0)::bigint           AS ls_filings,
    (array_agg(w.fiscal_quarter ORDER BY w.published_on DESC, w.fiscal_quarter))[1] AS ls_fiscal_quarter,
    (array_agg(w.source_file    ORDER BY w.published_on DESC, w.fiscal_quarter))[1] AS ls_source_file,
    max(w.published_on)                             AS ls_published_on,
    min(w.coverage_from)                            AS ls_coverage_from,
    max(w.coverage_to)                              AS ls_coverage_to,
    min(w.wage_low_annual)                          AS ls_wage_low,
    max(w.wage_high_annual)                         AS ls_wage_high,
    max(round(w.wage_high_annual / NULLIF(w.wage_low_annual, 0), 2)) AS ls_max_spread,
    max(w.loaded_at)                                AS ls_loaded_at
  FROM public.oflc_lca_wages w;
$$;

COMMENT ON FUNCTION public.get_lca_load_state() IS
  'One row describing the wage-cell load as it stands: how many cells and board tokens are '
  'resident, how many distinct labelled periods (anything but one means a load left a mixture), the '
  'total filings behind them, the label with the file, publication date and measured span it came '
  'from, and the extremes of the filed figures. Aggregates only -- no employer, occupation, state '
  'or cell -- so a post-deploy check can prove the whole load landed without the table being '
  'readable. An empty table answers zeroes and nulls rather than no row.';

REVOKE ALL ON FUNCTION public.get_lca_load_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_lca_load_state() FROM anon;
REVOKE ALL ON FUNCTION public.get_lca_load_state() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_lca_load_state() TO anon, authenticated, service_role;
