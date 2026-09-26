-- THE SAME LANDMINE, IN THE FUNCTION THAT HAS BEEN GETTING AWAY WITH IT
--
-- layoff_matches_rebuild clears the match table and rebuilds it, and it does
-- that clearing with no predicate. It has never failed, because pg_cron calls
-- it and the refusal only applies to the session PostgREST hands a definer
-- function -- which is exactly how the wage load failed on 2026-09-26, on the
-- last of six chunks, having staged everything and swapped nothing.
--
-- So this function is one caller away from the same failure, and the caller
-- that would trigger it is the obvious one: any action, in any edge function,
-- that rebuilds matches on demand rather than waiting for the nightly cron.
-- The clause is added now, while the cost is one word, rather than during the
-- deploy that first calls it from an edge function.
--
-- WHERE true, not a narrower predicate: the rebuild genuinely replaces every
-- row, and writing a predicate that implied otherwise would be a lie about
-- what the statement does. The behaviour is identical -- the same rows are
-- deleted in the same order -- and the guard
-- a-delete-inside-a-function-body-names-what-it-deletes.test.ts fails the
-- suite if either of these two ever loses its clause again.
--
-- Nothing else in the function changes.

CREATE OR REPLACE FUNCTION public.layoff_matches_rebuild()
RETURNS TABLE (
  lm_filings             int,
  lm_alias               int,
  lm_exact_multitoken    int,
  lm_refused_single      int,
  lm_refused_ambiguous   int,
  lm_refused_state_gate  int,
  lm_refused_rejected    int,
  lm_unmatched           int,
  lm_ms                  int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5min'
AS $$
DECLARE
  v_t0        timestamptz := clock_timestamp();
  v_from      date := current_date - 365;
  v_filings   int := 0;
  v_alias     int := 0;
  v_exact     int := 0;
  v_single    int := 0;
  v_ambiguous int := 0;
  v_gate      int := 0;
  v_rejected  int := 0;
  v_unmatched int := 0;
  v_ms        int := 0;
BEGIN
  DELETE FROM public.layoff_matches m WHERE true;

  -- Rule 1: alias.
  INSERT INTO public.layoff_matches (filing_id, company_token, matched_via, matched_norm, alias_id, relation)
  SELECT DISTINCT ON (f.filing_id, a.company_token)
         f.filing_id, a.company_token, 'alias', COALESCE(a.alias_norm, f.filer_norm), a.alias_id, a.relation
  FROM public.layoff_filings f
  JOIN public.layoff_employer_aliases a
    ON a.decision = 'accepted'
   AND (
        (f.source = 'state_warn' AND a.alias_norm IS NOT NULL AND a.alias_norm = f.filer_norm
           AND (a.state_scope IS NULL OR f.state = ANY (a.state_scope)))
     OR (f.source = 'sec_8k_205' AND a.cik IS NOT NULL AND a.cik = f.cik)
       )
  WHERE f.event_date >= v_from
  ORDER BY f.filing_id, a.company_token, a.alias_id;
  GET DIAGNOSTICS v_alias = ROW_COUNT;

  -- Rule 2: exact multi-token, one employer, state-gated for WARN, never a rejected pair.
  WITH cand AS (
    SELECT f.filing_id, f.source, f.state, f.filer_norm, f.cik,
           b.company_token, CASE WHEN split_part(b.company_token, '~', 1) IN ('recruiting', 'recruiting2')
                  THEN split_part(b.company_token, '~', 1) || '~' || split_part(b.company_token, '~', 2)
                WHEN split_part(b.company_token, '~', 1) = 'eu' THEN b.company_token
                ELSE split_part(b.company_token, '~', 1) END AS employer
    FROM public.layoff_filings f
    JOIN public.layoff_board_names b ON b.display_norm = f.filer_norm
    WHERE f.event_date >= v_from
      AND (SELECT count(*) FROM unnest(string_to_array(f.filer_norm, ' ')) AS tk(t) WHERE length(tk.t) >= 2) >= 2
  ),
  one AS (
    SELECT c.filing_id FROM cand c GROUP BY c.filing_id HAVING count(DISTINCT c.employer) = 1
  ),
  gated AS (
    SELECT c.filing_id, c.company_token, c.filer_norm
    FROM cand c
    JOIN one o ON o.filing_id = c.filing_id
    WHERE NOT EXISTS (
            SELECT 1 FROM public.layoff_employer_aliases a
             WHERE a.decision = 'rejected' AND a.company_token = c.company_token
               AND ((a.alias_norm IS NOT NULL AND a.alias_norm = c.filer_norm)
                 OR (a.cik IS NOT NULL AND a.cik = c.cik)))
      AND (c.source <> 'state_warn' OR EXISTS (
            SELECT 1 FROM public.job_board_postings p
             WHERE p.company_token = c.company_token
               AND p.country = 'US'
               AND p.region_code = 'US-' || c.state
               AND p.missing_since IS NULL))
  )
  INSERT INTO public.layoff_matches (filing_id, company_token, matched_via, matched_norm, alias_id, relation)
  SELECT DISTINCT g.filing_id, g.company_token, 'exact_multitoken', g.filer_norm, NULL::bigint, 'filer'
  FROM gated g
  ON CONFLICT (filing_id, company_token) DO NOTHING;
  GET DIAGNOSTICS v_exact = ROW_COUNT;

  -- Rule 3: the refusals, counted per filing (per pair for rejected).
  SELECT count(*)::int INTO v_filings FROM public.layoff_filings f WHERE f.event_date >= v_from;

  SELECT count(DISTINCT f.filing_id)::int INTO v_single
  FROM public.layoff_filings f
  JOIN public.layoff_board_names b ON b.display_norm = f.filer_norm
  WHERE f.event_date >= v_from
    AND (SELECT count(*) FROM unnest(string_to_array(f.filer_norm, ' ')) AS tk(t) WHERE length(tk.t) >= 2) < 2
    AND NOT EXISTS (SELECT 1 FROM public.layoff_matches m WHERE m.filing_id = f.filing_id);

  WITH cand AS (
    SELECT f.filing_id, CASE WHEN split_part(b.company_token, '~', 1) IN ('recruiting', 'recruiting2')
                  THEN split_part(b.company_token, '~', 1) || '~' || split_part(b.company_token, '~', 2)
                WHEN split_part(b.company_token, '~', 1) = 'eu' THEN b.company_token
                ELSE split_part(b.company_token, '~', 1) END AS employer
    FROM public.layoff_filings f
    JOIN public.layoff_board_names b ON b.display_norm = f.filer_norm
    WHERE f.event_date >= v_from
      AND (SELECT count(*) FROM unnest(string_to_array(f.filer_norm, ' ')) AS tk(t) WHERE length(tk.t) >= 2) >= 2
  )
  SELECT count(*)::int INTO v_ambiguous
  FROM (SELECT c.filing_id FROM cand c GROUP BY c.filing_id HAVING count(DISTINCT c.employer) >= 2) x
  WHERE NOT EXISTS (SELECT 1 FROM public.layoff_matches m WHERE m.filing_id = x.filing_id);

  WITH cand AS (
    SELECT f.filing_id, f.source, f.state, f.filer_norm, f.cik, b.company_token,
           CASE WHEN split_part(b.company_token, '~', 1) IN ('recruiting', 'recruiting2')
                  THEN split_part(b.company_token, '~', 1) || '~' || split_part(b.company_token, '~', 2)
                WHEN split_part(b.company_token, '~', 1) = 'eu' THEN b.company_token
                ELSE split_part(b.company_token, '~', 1) END AS employer
    FROM public.layoff_filings f
    JOIN public.layoff_board_names b ON b.display_norm = f.filer_norm
    WHERE f.event_date >= v_from
      AND (SELECT count(*) FROM unnest(string_to_array(f.filer_norm, ' ')) AS tk(t) WHERE length(tk.t) >= 2) >= 2
  ),
  one AS (
    SELECT c.filing_id FROM cand c GROUP BY c.filing_id HAVING count(DISTINCT c.employer) = 1
  )
  SELECT
    count(DISTINCT c.filing_id) FILTER (
      WHERE c.source = 'state_warn'
        AND NOT EXISTS (SELECT 1 FROM public.layoff_matches m WHERE m.filing_id = c.filing_id)
        AND NOT EXISTS (
              SELECT 1 FROM public.layoff_employer_aliases a
               WHERE a.decision = 'rejected' AND a.company_token = c.company_token
                 AND ((a.alias_norm IS NOT NULL AND a.alias_norm = c.filer_norm)
                   OR (a.cik IS NOT NULL AND a.cik = c.cik))))::int,
    count(*) FILTER (
      WHERE EXISTS (
              SELECT 1 FROM public.layoff_employer_aliases a
               WHERE a.decision = 'rejected' AND a.company_token = c.company_token
                 AND ((a.alias_norm IS NOT NULL AND a.alias_norm = c.filer_norm)
                   OR (a.cik IS NOT NULL AND a.cik = c.cik))))::int
  INTO v_gate, v_rejected
  FROM cand c
  JOIN one o ON o.filing_id = c.filing_id;

  SELECT count(*)::int INTO v_unmatched
  FROM public.layoff_filings f
  WHERE f.event_date >= v_from
    AND NOT EXISTS (SELECT 1 FROM public.layoff_matches m WHERE m.filing_id = f.filing_id);

  v_ms := (extract(epoch FROM (clock_timestamp() - v_t0)) * 1000)::int;

  INSERT INTO public.layoff_read_log (kind, fetched, kept, new_rows, ok, ms, note)
  VALUES ('matcher', v_filings, v_alias + v_exact, v_alias + v_exact, true, v_ms,
          format('alias=%s exact_multitoken=%s refused_single=%s refused_ambiguous=%s refused_state_gate=%s refused_rejected=%s unmatched=%s',
                 v_alias, v_exact, v_single, v_ambiguous, v_gate, v_rejected, v_unmatched));

  RETURN QUERY SELECT v_filings, v_alias, v_exact, v_single, v_ambiguous, v_gate, v_rejected, v_unmatched, v_ms;
END;
$$;
