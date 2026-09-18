SET LOCAL statement_timeout = '1min';

CREATE OR REPLACE FUNCTION public.get_employer_layoff_filings(p_tokens text[])
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
  lf_more_n         int
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
    CASE WHEN q.tok IS NULL THEN 0 ELSE (q.n_all - 1)::int END AS lf_more_n
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
  'filer_raw, both dates with their bases, and our read time; no adjective, no verdict.';

GRANT EXECUTE ON FUNCTION public.get_employer_layoff_filings(text[]) TO anon, authenticated, service_role;