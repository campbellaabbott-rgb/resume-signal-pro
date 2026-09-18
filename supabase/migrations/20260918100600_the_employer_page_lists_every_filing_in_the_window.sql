-- THE EMPLOYER PAGE LISTS EVERY FILING IN THE WINDOW.
--
-- The lander-only companion of get_employer_layoff_filings: the same
-- predicates, spelled the same way, for ONE token, returning every
-- qualifying filing newest first (at most 20) instead of the newest one
-- with a count. The Hiring Health card prints each as its own line with
-- its own link under "Also on record". Nothing here is a verdict about the
-- employer; the growth verdict and the takedown record are computed
-- elsewhere and this list sits beside them.
--
-- Zero rows here means nothing qualified under the predicates; the card
-- prints no line and no absence -- no surface ever prints "no filings".
--
-- Same constants as the per-token reader (k), mirrored by
-- src/config/layoffs.ts.

SET LOCAL statement_timeout = '1min';

CREATE OR REPLACE FUNCTION public.get_employer_layoff_filings_all(p_token text)
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
  la_total_n        int
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
    q.n_all::int      AS la_total_n
  FROM q
  ORDER BY q.event_date DESC, q.public_date DESC, q.filing_id
  LIMIT 20;
$$;

COMMENT ON FUNCTION public.get_employer_layoff_filings_all(text) IS
  'Every qualifying layoff filing joined to one board token, newest first, at most 20, under exactly '
  'the predicates get_employer_layoff_filings uses (alias or exact_multitoken match, status active, a '
  'source_url, the display window, not after our read, the WARN worker bar, never an 8-K/A). '
  'la_total_n is the count before the limit. Lander only; zero rows prints nothing.';

GRANT EXECUTE ON FUNCTION public.get_employer_layoff_filings_all(text) TO anon, authenticated, service_role;
