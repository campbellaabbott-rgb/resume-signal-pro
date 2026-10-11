-- A FEDERAL WAGE FILING NEEDS AN EMPLOYER HIRING IN THE US (sweep S8-024).
--
-- H-1B LCA cells attach to a board by an exact match of the filer's
-- normalised name, with no corroboration. "SIGMA SOFTWARE LLC/INC" (US
-- consultancies, 43 filings) attached to smartrecruiters:sigmasoftware2, a
-- Ukrainian and Polish firm: get_employer_lca_wages printed TX
-- $105,976-$134,971 (n=11) under its name while a list probe for its US
-- postings returned total 0. A US labor condition application belongs to an
-- employer that hires in the US.
--
-- So the reader now answers only for a token with at least one live US
-- posting on this board (missing_since IS NULL, country 'US'); any other token
-- comes back as the no-cell row, exactly as a token with no filings does. One
-- index probe per asked token (job_board_postings' company_token btree).
-- The rest of the corroboration lives where the cells are made: the deploy
-- refuses the rejected-pair ledger (socialfinance, sigmasoftware2) and every
-- token the catalogue carries under two vendors before it posts a cell
-- (layoff-filings 2026-10-09.1, lca-cells.ts), and the operator loader
-- refuses a name two filers stand behind (two legal forms or two FEINs).
-- NOT DONE: a US posting IN THE CELL'S WORKSITE STATE per cell -- region_code
-- is not stated on enough postings to tell "no posting in that state" from
-- "the location named no state", and a check that cannot tell them apart
-- would hide real cells.
--
-- Rewritten from the catalogue (one anchor, refused if the live body drifted
-- from 20260925150733). Signature, DEFINER, search_path, timeout and grants
-- are unchanged. Self-verifying, safe to re-run.

SET LOCAL statement_timeout = '1min';

DO $mig$
DECLARE
  v_def    text := pg_get_functiondef('public.get_employer_lca_wages(text[], text, text)'::regprocedure);
  v_anchor text := E'      AND w.fiscal_quarter = (SELECT qq.fq FROM q qq)\n    GROUP BY w.company_token, w.fiscal_quarter';
  v_gate   text := E'      AND EXISTS (SELECT 1 FROM public.job_board_postings jp\n                   WHERE jp.company_token = w.company_token AND jp.missing_since IS NULL AND jp.country = ''US'')\n';
BEGIN
  IF position('jp.country = ''US''' IN v_def) > 0 THEN
    RAISE NOTICE 'get_employer_lca_wages already requires a live US posting';
  ELSIF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'get_employer_lca_wages: the employer CTE anchor is not in the live definition; it drifted -- refusing to rewrite it';
  ELSE
    EXECUTE replace(v_def, v_anchor, replace(v_anchor, E'\n    GROUP BY', E'\n' || v_gate || '    GROUP BY'));
  END IF;
END
$mig$;

DO $verify$
BEGIN
  IF position('jp.country = ''US''' IN pg_get_functiondef('public.get_employer_lca_wages(text[], text, text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'get_employer_lca_wages still prints federal filings for a board with no US posting';
  END IF;
  IF NOT has_function_privilege('anon', 'public.get_employer_lca_wages(text[], text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_employer_lca_wages lost its anon grant';
  END IF;
END
$verify$;
