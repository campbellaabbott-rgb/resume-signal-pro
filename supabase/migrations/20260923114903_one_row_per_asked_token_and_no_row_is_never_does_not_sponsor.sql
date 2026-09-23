-- ONE ROW PER ASKED TOKEN, AND NO ROW IS NEVER "DOES NOT SPONSOR".
--
-- The reader behind the filed-wage line on a posting. It takes up to 200
-- board tokens and returns EXACTLY ONE ROW PER DISTINCT TOKEN ASKED, from a
-- LEFT JOIN off unnest: a token with nothing that qualifies comes back with a
-- NULL source file. The client therefore never has to decide what a missing
-- row means, because there is no missing row -- and it must never decide,
-- because the wrong reading of an absence here is a statement about a person
-- rather than about a file. We hold one quarter of one country's
-- certifications; an employer absent from it may sponsor, may have filed in
-- another quarter, may have filed under another legal name our matcher
-- refuses to guess at. "No cell" means we have nothing to print. It never
-- means the employer does not sponsor, and no surface may render it as one.
-- (Same shape as the layoff-filings card reader, for the same reason.)
--
-- EVERY PREDICATE LIVES HERE, never in a client.
--
--   * THE MINIMUM. A cell prints only when the number of certified
--     applications behind it reaches the bar in the k block below, and an
--     employer's sponsorship figures print only when the employer's total
--     across all cells reaches the same bar. A range drawn from one or two
--     applications is two numbers wearing the word range, and one
--     application is one negotiation.
--   * THE NEARNESS. Asked with an occupation, the reader answers only from
--     that occupation or its major group -- never from an unrelated
--     occupation the employer happens to file more of. Asked without one, it
--     answers the employer's largest cell, in the asked state when one is
--     given, and names the occupation it belongs to so the reader of the page
--     can see what it is about.
--   * THE BASIS. Every row carries the file, its publication date and its
--     fiscal quarter, so a surface cannot print a figure from here without
--     printing what it is a figure of and when it was published. Those four
--     travel with the CELL, not with the employer: an aggregate taken across
--     an employer's cells would print an old cell under a new file's name the
--     moment two quarters coexisted, which is a published figure whose stated
--     basis is not the file it came from.
--   * THE ONE QUARTER. Everything below is scoped to the single latest
--     fiscal quarter resident in the table, chosen by publication date. The
--     writer's contract is that a quarter replaces itself whole, but an
--     interrupted run is exactly the state it plans for, and in that state an
--     employer total summed across every row would be two quarters added
--     together under one quarter's name -- in nine languages at once, because
--     the copy says "for that quarter". Scoping here makes the sentence true
--     whatever is resident.
--
-- WHAT IT IS NOT. Not a prediction, not an offer, not this posting's pay. The
-- column names say filed, the copy says filed, and no caller is handed a
-- figure that could be mistaken for a current salary without the quarter
-- attached to it.
--
-- CONSTANTS, named once in k and mirrored by the component that prints them;
-- the cross-runtime guard reads this file and the component and fails on
-- drift, which is the point of naming them twice in one commit.
--
-- DEFINER because the table has no policy; STABLE; five-second timeout
-- because it sits on the request path of a card. OUT names carry a prefix so
-- none is also a column of the table the body reads.

SET LOCAL statement_timeout = '1min';

CREATE OR REPLACE FUNCTION public.get_employer_lca_wages(
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
  ow_published_on        date
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
    COALESCE(n.cell_pub_on,  e.pub_on)   AS ow_published_on
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
  'to the single latest fiscal quarter resident in the table, so the employer total means what the '
  'copy says even while an interrupted load leaves two quarters present; the file, the publication '
  'date and the quarter come from the returned CELL and fall back to the employer only when no cell '
  'is returned. Filed wages for one quarter; never what an employer pays or will pay, and a null row '
  'never means the employer does not sponsor.';

REVOKE ALL ON FUNCTION public.get_employer_lca_wages(text[], text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_employer_lca_wages(text[], text, text) FROM anon;
REVOKE ALL ON FUNCTION public.get_employer_lca_wages(text[], text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_employer_lca_wages(text[], text, text) TO anon, authenticated, service_role;
