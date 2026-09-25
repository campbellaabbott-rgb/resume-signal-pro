-- THE PERIOD A FIGURE IS ABOUT IS TWO DATES, NOT A LABEL.
--
-- This replaces the reader defined in 20260923114903, unchanged except that it
-- hands back the two dates every cell now carries: the earliest and latest
-- decision date among the certified applications folded into the load.
--
-- WHY IT HAD TO CHANGE. The label those cells used to carry was read off the
-- Department's file name, and the Department's "quarterly" file is cumulative
-- year to date -- so a line reading "in FY2026 Q3" was printed over nine
-- months of certifications, overstating the density of that quarter by 1.86x
-- on certified applications. The label is now computed from these dates, and a
-- surface that prints a figure from here can print the span it is a figure of
-- instead of a label the reader of the page has to decode.
--
-- The OUT list grows, so this is a DROP and a CREATE rather than a REPLACE:
-- Postgres will not change the return type of an existing function. Everything
-- else -- the minimum-filings bar, the nearness rule, the one-row-per-asked-
-- token shape, the scoping to the single latest resident period, the DEFINER
-- and its grants -- is the same text as 20260923114903, and the guard that
-- reads the newest migration defining this function reads this one.
--
-- OUT names carry a prefix so none is also a column of the table the body
-- reads (the 42702 trap).

SET LOCAL statement_timeout = '1min';

DROP FUNCTION IF EXISTS public.get_employer_lca_wages(text[], text, text);

CREATE FUNCTION public.get_employer_lca_wages(
  p_tokens         text[],
  p_soc_code       text DEFAULT NULL,
  p_worksite_state text DEFAULT NULL
)
RETURNS TABLE (
  ow_company_token       text,
  ow_soc_code            text,
  ow_soc_title           text,
  ow_worksite_state      text,
  ow_wage_low            numeric,
  ow_wage_high           numeric,
  ow_wage_median         numeric,
  ow_filings_n           int,
  ow_match_basis         text,
  ow_employer_filings_n  int,
  ow_employer_cells_n    int,
  ow_fiscal_quarter      text,
  ow_source_file         text,
  ow_source_url          text,
  ow_published_on        date,
  ow_coverage_from       date,
  ow_coverage_to         date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
  WITH k AS (
    SELECT 3 AS lca_min_filings
  ),
  p AS (
    SELECT substring(btrim(COALESCE(p_soc_code, '')) FROM '^[0-9]{2}-[0-9]{4}') AS soc,
           NULLIF(upper(regexp_replace(btrim(COALESCE(p_worksite_state, '')), '^US-', '')), '') AS st
  ),
  q AS (
    SELECT w.fiscal_quarter AS fq
    FROM public.oflc_lca_wages w
    ORDER BY w.published_on DESC, w.fiscal_quarter DESC
    LIMIT 1
  ),
  toks AS (
    SELECT DISTINCT t.tok
    FROM unnest((COALESCE(p_tokens, '{}'::text[]))[1:200]) AS t(tok)
    WHERE t.tok IS NOT NULL AND t.tok <> ''
  ),
  emp AS (
    SELECT w.company_token AS tok,
           w.fiscal_quarter AS quarter,
           sum(w.filings_n)::int AS n_all,
           count(*)::int          AS cells_n,
           (array_agg(w.source_file ORDER BY w.published_on DESC, w.company_token))[1] AS src_file,
           (array_agg(w.source_url  ORDER BY w.published_on DESC, w.company_token))[1] AS src_url,
           (array_agg(w.coverage_from ORDER BY w.published_on DESC, w.company_token))[1] AS cov_from,
           (array_agg(w.coverage_to   ORDER BY w.published_on DESC, w.company_token))[1] AS cov_to,
           max(w.published_on) AS pub_on
    FROM public.oflc_lca_wages w
    WHERE w.company_token IN (SELECT t.tok FROM toks t)
      AND w.fiscal_quarter = (SELECT qq.fq FROM q qq)
    GROUP BY w.company_token, w.fiscal_quarter
    HAVING sum(w.filings_n) >= (SELECT kk.lca_min_filings FROM k kk)
  ),
  cand AS (
    SELECT w.company_token AS tok, w.soc_code, w.soc_title, w.worksite_state,
           w.wage_low_annual, w.wage_high_annual, w.wage_median_annual, w.filings_n,
           w.fiscal_quarter AS cell_quarter, w.source_file AS cell_file,
           w.source_url AS cell_url, w.published_on AS cell_pub_on,
           w.coverage_from AS cell_cov_from, w.coverage_to AS cell_cov_to,
           CASE
             WHEN pp.soc IS NOT NULL AND w.soc_code = pp.soc AND pp.st IS NOT NULL AND w.worksite_state = pp.st THEN 1
             WHEN pp.soc IS NOT NULL AND w.soc_code = pp.soc THEN 2
             WHEN pp.soc IS NOT NULL AND left(w.soc_code, 2) = left(pp.soc, 2) AND pp.st IS NOT NULL AND w.worksite_state = pp.st THEN 3
             WHEN pp.soc IS NOT NULL AND left(w.soc_code, 2) = left(pp.soc, 2) THEN 4
             WHEN pp.st IS NOT NULL AND w.worksite_state = pp.st THEN 5
             ELSE 6
           END AS nearness
    FROM public.oflc_lca_wages w
    JOIN emp e ON e.tok = w.company_token
    CROSS JOIN p pp
    WHERE w.filings_n >= (SELECT kk.lca_min_filings FROM k kk)
      AND w.fiscal_quarter = (SELECT qq.fq FROM q qq)
  ),
  near AS (
    SELECT c.*,
           row_number() OVER (PARTITION BY c.tok ORDER BY c.nearness, c.filings_n DESC, c.soc_code, c.worksite_state) AS rn
    FROM cand c
    CROSS JOIN p pp
    WHERE (pp.soc IS NOT NULL AND c.nearness <= 4)
       OR (pp.soc IS NULL     AND c.nearness >= 5)
  )
  SELECT
    t.tok                    AS ow_company_token,
    n.soc_code               AS ow_soc_code,
    n.soc_title              AS ow_soc_title,
    n.worksite_state         AS ow_worksite_state,
    n.wage_low_annual        AS ow_wage_low,
    n.wage_high_annual       AS ow_wage_high,
    n.wage_median_annual     AS ow_wage_median,
    n.filings_n              AS ow_filings_n,
    CASE n.nearness
      WHEN 1 THEN 'soc_and_state'
      WHEN 2 THEN 'soc'
      WHEN 3 THEN 'soc_group_and_state'
      WHEN 4 THEN 'soc_group'
      WHEN 5 THEN 'state_top'
      WHEN 6 THEN 'employer_top'
    END                      AS ow_match_basis,
    e.n_all                  AS ow_employer_filings_n,
    e.cells_n                AS ow_employer_cells_n,
    COALESCE(n.cell_quarter, e.quarter)  AS ow_fiscal_quarter,
    COALESCE(n.cell_file,    e.src_file) AS ow_source_file,
    COALESCE(n.cell_url,     e.src_url)  AS ow_source_url,
    COALESCE(n.cell_pub_on,  e.pub_on)   AS ow_published_on,
    COALESCE(n.cell_cov_from, e.cov_from) AS ow_coverage_from,
    COALESCE(n.cell_cov_to,   e.cov_to)   AS ow_coverage_to
  FROM toks t
  LEFT JOIN emp e ON e.tok = t.tok
  LEFT JOIN near n ON n.tok = t.tok AND n.rn = 1
  ORDER BY t.tok;
$$;

COMMENT ON FUNCTION public.get_employer_lca_wages(text[], text, text) IS
  'One row per distinct board token asked (up to 200): the employer certified LCA filing totals and '
  'the nearest qualifying wage cell for the asked occupation and worksite state, or a row of nulls '
  'when nothing qualifies. Asked with an occupation it answers only from that occupation or its '
  'major group; asked without one it answers the largest cell and names it, and ow_match_basis says '
  'which of those happened so a surface can print why this cell is on this posting. A cell and an '
  'employer total must both reach the minimum number of certified applications. Everything is scoped '
  'to the single latest labelled period resident in the table; the file, the publication date, the '
  'label and the coverage dates come from the returned CELL and fall back to the employer only when '
  'no cell is returned. Filed wages for one quarter; never what an employer pays or will pay, and a null row '
  'never means the employer does not sponsor.';

REVOKE ALL ON FUNCTION public.get_employer_lca_wages(text[], text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_employer_lca_wages(text[], text, text) FROM anon;
REVOKE ALL ON FUNCTION public.get_employer_lca_wages(text[], text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_employer_lca_wages(text[], text, text) TO anon, authenticated, service_role;
