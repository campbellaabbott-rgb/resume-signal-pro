-- AN EXIT-COST FILING IS NOT PRINTED AS A WORKFORCE REDUCTION (sweep S8-026).
--
-- Item 2.05 of an 8-K is "costs associated with exit or disposal
-- activities": a product-line exit, a lease, a segment, or a status update on
-- a plan announced months earlier. The parser records whether the section
-- describes a workforce event (is_workforce_event, edgar.ts) and nothing read
-- it: both readers returned every active 2.05 row, the card printed "reported
-- a workforce reduction", and the Ghost Index's filed arm counted the
-- employer. 9 of the 68 Item 2.05 full-text hits from July to October parse
-- as is_workforce_event = false (Vital Farms' butter-line exit, no employees,
-- shown May to July); Freshworks' 2026-08-04 earnings 8-K, a status update on
-- its May plan, re-dated that cut as new.
--
-- 1. Both readers return the flag (lf_workforce / la_workforce): TRUE for a
--    state WARN notice (a notice is a workforce event by statute), the
--    parser's flag for an 8-K. The page prints neutral copy when it is not
--    TRUE. A RETURNS TABLE change cannot be CREATE OR REPLACE'd, so each is
--    dropped and created with its body otherwise unchanged from
--    20260918100500 / 20260918100600, then granted exactly as before
--    (anon, authenticated, service_role: both are client-callable readers on
--    the census allowlist; neither gains a caller).
-- 2. refresh_layoff_partition's filed arm admits an 8-K only when the flag is
--    TRUE. Rewritten FROM THE CATALOGUE (pg_get_functiondef, one anchor
--    replaced), never from a hand-copied body, so a live definition that
--    drifted from the files is refused rather than overwritten.
--
-- Self-verifying, safe to re-run.

SET LOCAL statement_timeout = '2min';

DROP FUNCTION IF EXISTS public.get_employer_layoff_filings(text[]);
CREATE FUNCTION public.get_employer_layoff_filings(p_tokens text[])
RETURNS TABLE (
  lf_company_token  text,
  lf_source         text,
  lf_relation       text,
  lf_filer          text,
  lf_event_date     date,
  lf_event_basis    text,
  lf_public_date    date,
  lf_public_basis   text,
  lf_state          text,
  lf_site           text,
  lf_workers        int,
  lf_event_type     text,
  lf_effective_date date,
  lf_pct            numeric,
  lf_headcount      int,
  lf_form           text,
  lf_source_url     text,
  lf_source_name    text,
  lf_read_at        timestamptz,
  lf_more_n         int,
  lf_workforce      boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
  WITH k AS (
    SELECT 90 AS layoff_display_max_age_days,
           50 AS layoff_warn_min_workers
  ),
  toks AS (
    SELECT DISTINCT t.tok
    FROM unnest((COALESCE(p_tokens, '{}'::text[]))[1:200]) AS t(tok)
    WHERE t.tok IS NOT NULL AND t.tok <> ''
  ),
  q AS (
    SELECT m.company_token AS tok,
           m.relation      AS rel,
           f.source, f.filer_raw, f.event_date, f.event_basis, f.public_date, f.public_basis,
           f.state, COALESCE(NULLIF(f.site_raw, ''), f.site_city) AS site_text, f.workers, f.event_type, f.effective_date,
           f.pct, f.headcount, f.form, f.source_url, f.source_name, f.source_read_at,
           CASE WHEN f.source = 'state_warn' THEN true ELSE f.is_workforce_event END AS workforce,
           row_number() OVER (PARTITION BY m.company_token ORDER BY f.event_date DESC, f.public_date DESC, f.filing_id) AS rn,
           count(*)     OVER (PARTITION BY m.company_token) AS n_all
    FROM public.layoff_matches m
    JOIN public.layoff_filings f ON f.filing_id = m.filing_id
    WHERE m.company_token IN (SELECT t.tok FROM toks t)
      AND m.matched_via IN ('exact_multitoken', 'alias')
      AND f.status = 'active'
      AND f.source_url IS NOT NULL
      AND f.event_date >= current_date - (SELECT kk.layoff_display_max_age_days FROM k kk)
      AND f.event_date <= f.source_read_at::date
      AND (f.source <> 'state_warn' OR f.workers >= (SELECT kk.layoff_warn_min_workers FROM k kk))
      AND f.form IS DISTINCT FROM '8-K/A'
  )
  SELECT
    t.tok             AS lf_company_token,
    q.source          AS lf_source,
    q.rel             AS lf_relation,
    q.filer_raw       AS lf_filer,
    q.event_date      AS lf_event_date,
    q.event_basis     AS lf_event_basis,
    q.public_date     AS lf_public_date,
    q.public_basis    AS lf_public_basis,
    q.state::text     AS lf_state,
    q.site_text       AS lf_site,
    q.workers         AS lf_workers,
    q.event_type      AS lf_event_type,
    q.effective_date  AS lf_effective_date,
    q.pct             AS lf_pct,
    q.headcount       AS lf_headcount,
    q.form            AS lf_form,
    q.source_url      AS lf_source_url,
    q.source_name     AS lf_source_name,
    q.source_read_at  AS lf_read_at,
    CASE WHEN q.tok IS NULL THEN 0 ELSE (q.n_all - 1)::int END AS lf_more_n,
    q.workforce       AS lf_workforce
  FROM toks t
  LEFT JOIN q ON q.tok = t.tok AND q.rn = 1
  ORDER BY t.tok;
$$;

COMMENT ON FUNCTION public.get_employer_layoff_filings(text[]) IS
  'One row per distinct board token asked (up to 200): the newest qualifying layoff filing joined to '
  'that token by layoff_matches, or a row with lf_source NULL when nothing qualifies -- a row is an '
  'answer and no row is never no filing. Qualifying means matched via alias or exact_multitoken, '
  'status active, a source_url, event_date within the display window and not after our read, a WARN '
  'row stating at least the single-site worker bar (NULL never prints), and never an 8-K/A. Prints '
  'filer_raw, both dates with their bases, and our read time; no adjective, no verdict. lf_workforce: '
  'TRUE for a WARN notice, the parser''s is_workforce_event for an 8-K (NULL/FALSE = an exit-cost '
  'filing that describes no workforce event we could read).';

REVOKE ALL ON FUNCTION public.get_employer_layoff_filings(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_employer_layoff_filings(text[]) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.get_employer_layoff_filings_all(text);
CREATE FUNCTION public.get_employer_layoff_filings_all(p_token text)
RETURNS TABLE (
  la_company_token  text,
  la_source         text,
  la_relation       text,
  la_filer          text,
  la_event_date     date,
  la_event_basis    text,
  la_public_date    date,
  la_public_basis   text,
  la_state          text,
  la_site           text,
  la_workers        int,
  la_event_type     text,
  la_effective_date date,
  la_pct            numeric,
  la_headcount      int,
  la_form           text,
  la_source_url     text,
  la_source_name    text,
  la_read_at        timestamptz,
  la_total_n        int,
  la_workforce      boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
  WITH k AS (
    SELECT 90 AS layoff_display_max_age_days,
           50 AS layoff_warn_min_workers
  ),
  q AS (
    SELECT m.company_token AS tok,
           m.relation      AS rel,
           f.source, f.filer_raw, f.event_date, f.event_basis, f.public_date, f.public_basis,
           f.state, COALESCE(NULLIF(f.site_raw, ''), f.site_city) AS site_text, f.workers, f.event_type, f.effective_date,
           f.pct, f.headcount, f.form, f.source_url, f.source_name, f.source_read_at, f.filing_id,
           CASE WHEN f.source = 'state_warn' THEN true ELSE f.is_workforce_event END AS workforce,
           count(*) OVER () AS n_all
    FROM public.layoff_matches m
    JOIN public.layoff_filings f ON f.filing_id = m.filing_id
    WHERE m.company_token = p_token
      AND m.matched_via IN ('exact_multitoken', 'alias')
      AND f.status = 'active'
      AND f.source_url IS NOT NULL
      AND f.event_date >= current_date - (SELECT kk.layoff_display_max_age_days FROM k kk)
      AND f.event_date <= f.source_read_at::date
      AND (f.source <> 'state_warn' OR f.workers >= (SELECT kk.layoff_warn_min_workers FROM k kk))
      AND f.form IS DISTINCT FROM '8-K/A'
  )
  SELECT
    q.tok             AS la_company_token,
    q.source          AS la_source,
    q.rel             AS la_relation,
    q.filer_raw       AS la_filer,
    q.event_date      AS la_event_date,
    q.event_basis     AS la_event_basis,
    q.public_date     AS la_public_date,
    q.public_basis    AS la_public_basis,
    q.state::text     AS la_state,
    q.site_text       AS la_site,
    q.workers         AS la_workers,
    q.event_type      AS la_event_type,
    q.effective_date  AS la_effective_date,
    q.pct             AS la_pct,
    q.headcount       AS la_headcount,
    q.form            AS la_form,
    q.source_url      AS la_source_url,
    q.source_name     AS la_source_name,
    q.source_read_at  AS la_read_at,
    q.n_all::int      AS la_total_n,
    q.workforce       AS la_workforce
  FROM q
  ORDER BY q.event_date DESC, q.public_date DESC, q.filing_id
  LIMIT 20;
$$;

COMMENT ON FUNCTION public.get_employer_layoff_filings_all(text) IS
  'Every qualifying layoff filing joined to one board token, newest first, at most 20, under exactly '
  'the predicates get_employer_layoff_filings uses (alias or exact_multitoken match, status active, a '
  'source_url, the display window, not after our read, the WARN worker bar, never an 8-K/A). '
  'la_total_n is the count before the limit. Lander only; zero rows prints nothing. la_workforce as '
  'lf_workforce.';

REVOKE ALL ON FUNCTION public.get_employer_layoff_filings_all(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_employer_layoff_filings_all(text) TO anon, authenticated, service_role;

-- 2. The partition's filed arm, from the catalogue.
DO $mig$
DECLARE
  v_def    text := pg_get_functiondef('public.refresh_layoff_partition()'::regprocedure);
  v_anchor text := E'  ),\n  filed_by_tok AS (';
  v_gate   text := E'      AND (f.source <> ''sec_8k_205'' OR f.is_workforce_event IS TRUE)\n';
BEGIN
  IF position(v_gate IN v_def) > 0 THEN
    RAISE NOTICE 'refresh_layoff_partition already admits an 8-K only as a workforce event';
  ELSIF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'refresh_layoff_partition: the filed CTE anchor is not in the live definition; it drifted from 20261002122309 -- refusing to rewrite it';
  ELSE
    EXECUTE replace(v_def, v_anchor, v_gate || v_anchor);
  END IF;
END
$mig$;

-- Self-verification.
DO $verify$
DECLARE
  v_def text := pg_get_functiondef('public.refresh_layoff_partition()'::regprocedure);
BEGIN
  IF position('f.is_workforce_event IS TRUE' IN v_def) = 0 THEN
    RAISE EXCEPTION 'refresh_layoff_partition still counts every 8-K as a workforce reduction';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'get_employer_layoff_filings'
       AND 'lf_workforce' = ANY (p.proargnames) AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'get_employer_layoff_filings does not return lf_workforce';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'get_employer_layoff_filings_all'
       AND 'la_workforce' = ANY (p.proargnames) AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'get_employer_layoff_filings_all does not return la_workforce';
  END IF;
  IF NOT has_function_privilege('anon', 'public.get_employer_layoff_filings(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_employer_layoff_filings lost its anon grant: every card would stop reading filings';
  END IF;
END
$verify$;
