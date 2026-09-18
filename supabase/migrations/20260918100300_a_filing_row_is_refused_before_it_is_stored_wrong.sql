-- A FILING ROW IS REFUSED BEFORE IT IS STORED WRONG.
--
-- The writer the layoff-filings poller calls with a batch of rows, one JSON
-- object per filing keyed by the layoff_filings column names, plus
-- filer_for_norm: the filer string after the source-specific pre-pass
-- (Deno strips the WARN parentheticals, dba splits, "UPDATE n" prefixes,
-- the Florida address and the Texas site) and BEFORE the strict normaliser,
-- which runs here in SQL so the filer side and the board side of every
-- comparison were stripped by the same function. filer_raw itself is
-- stored verbatim and is what every surface prints.
--
-- ONE BAD ROW DOES NOT LOSE THE BATCH. Each row is written in its own
-- sub-block: a malformed date, a source_url that is not https, a date after
-- the read, a form 8-K/A that is not status amendment, or any CHECK on the
-- table refuses that row alone, and the call returns the refused ids with a
-- reason each beside the inserted and updated counts. The batch RPC for
-- posting patches taught this: a single bad cast raised for two hundred
-- rows and the edge abandoned the board's corrections entirely.
--
-- A re-seen row updates the mutable fields and stamps last_seen_at;
-- first_seen_at is kept. Nothing here matches or surfaces anything: the
-- matcher runs after, and the readers join through its table.

SET LOCAL statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.layoff_filings_upsert(p_rows jsonb)
RETURNS TABLE (lu_inserted int, lu_updated int, lu_refused int, lu_refused_ids text[], lu_refused_reasons text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5min'
AS $$
DECLARE
  e            jsonb;
  v_inserted   int := 0;
  v_updated    int := 0;
  v_refused    int := 0;
  v_ids        text[] := '{}';
  v_reasons    text[] := '{}';
  v_id         text;
  v_source     text;
  v_form       text;
  v_status     text;
  v_url        text;
  v_was_insert boolean;
  v_norm       text;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'layoff_filings_upsert expects a JSON array of filing rows';
  END IF;

  FOR e IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_id     := e->>'filing_id';
    v_source := e->>'source';
    v_form   := e->>'form';
    v_status := COALESCE(e->>'status', 'active');
    v_url    := e->>'source_url';
    BEGIN
      IF v_id IS NULL OR btrim(v_id) = '' THEN
        RAISE EXCEPTION USING MESSAGE = 'filing_id missing';
      END IF;
      IF v_source IS NULL OR v_source NOT IN ('sec_8k_205', 'state_warn') THEN
        RAISE EXCEPTION USING MESSAGE = 'source must be sec_8k_205 or state_warn';
      END IF;
      IF v_url IS NULL OR v_url !~ '^https://' THEN
        RAISE EXCEPTION USING MESSAGE = 'source_url must start with https://';
      END IF;
      IF (e->>'event_date') IS NULL OR (e->>'event_date') !~ '^\d{4}-\d{2}-\d{2}$'
         OR (e->>'public_date') IS NULL OR (e->>'public_date') !~ '^\d{4}-\d{2}-\d{2}$' THEN
        RAISE EXCEPTION USING MESSAGE = 'event_date and public_date must be YYYY-MM-DD';
      END IF;
      IF (e->>'event_date')::date > current_date OR (e->>'public_date')::date > current_date THEN
        RAISE EXCEPTION USING MESSAGE = 'a date after today is refused';
      END IF;
      IF v_form = '8-K/A' AND v_status <> 'amendment' THEN
        RAISE EXCEPTION USING MESSAGE = 'an 8-K/A must carry status amendment';
      END IF;
      IF NULLIF(btrim(COALESCE(e->>'filer_raw', '')), '') IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'filer_raw missing';
      END IF;
      v_norm := public.layoff_norm(COALESCE(NULLIF(btrim(e->>'filer_for_norm'), ''), e->>'filer_raw'));

      INSERT INTO public.layoff_filings AS f (
        filing_id, source, filer_raw, filer_norm,
        event_date, event_basis, public_date, public_basis,
        source_read_at, source_url, source_name, status, supersedes_id,
        cik, adsh, form, amends_adsh, amend_unresolved, section_text, excerpt, pct, headcount,
        headcount_basis, timing_text, is_workforce_event, parse_confidence, parser_version,
        state, feed, bln_hash_id, site_raw, site_city, site_county, workers, effective_date, effective_raw,
        event_type, is_temporary, notice_pdf_url
      ) VALUES (
        v_id, v_source, e->>'filer_raw', v_norm,
        (e->>'event_date')::date, e->>'event_basis', (e->>'public_date')::date, e->>'public_basis',
        COALESCE((e->>'source_read_at')::timestamptz, now()), v_url, e->>'source_name', v_status, e->>'supersedes_id',
        (e->>'cik')::bigint, e->>'adsh', v_form, e->>'amends_adsh', COALESCE((e->>'amend_unresolved')::boolean, false),
        e->>'section_text', e->>'excerpt', (e->>'pct')::numeric, (e->>'headcount')::int,
        e->>'headcount_basis', e->>'timing_text', (e->>'is_workforce_event')::boolean, (e->>'parse_confidence')::numeric, e->>'parser_version',
        NULLIF(e->>'state', ''), e->>'feed', e->>'bln_hash_id', e->>'site_raw', e->>'site_city', e->>'site_county',
        (e->>'workers')::int, (e->>'effective_date')::date, e->>'effective_raw',
        e->>'event_type', (e->>'is_temporary')::boolean, e->>'notice_pdf_url'
      )
      ON CONFLICT (filing_id) DO UPDATE SET
        filer_raw          = EXCLUDED.filer_raw,
        filer_norm         = EXCLUDED.filer_norm,
        event_date         = EXCLUDED.event_date,
        event_basis        = EXCLUDED.event_basis,
        public_date        = EXCLUDED.public_date,
        public_basis       = EXCLUDED.public_basis,
        source_read_at     = EXCLUDED.source_read_at,
        source_url         = EXCLUDED.source_url,
        source_name        = EXCLUDED.source_name,
        status             = EXCLUDED.status,
        supersedes_id      = EXCLUDED.supersedes_id,
        amends_adsh        = EXCLUDED.amends_adsh,
        amend_unresolved   = EXCLUDED.amend_unresolved,
        section_text       = COALESCE(EXCLUDED.section_text, f.section_text),
        excerpt            = COALESCE(EXCLUDED.excerpt, f.excerpt),
        pct                = EXCLUDED.pct,
        headcount          = EXCLUDED.headcount,
        headcount_basis    = EXCLUDED.headcount_basis,
        timing_text        = EXCLUDED.timing_text,
        is_workforce_event = EXCLUDED.is_workforce_event,
        parse_confidence   = EXCLUDED.parse_confidence,
        parser_version     = EXCLUDED.parser_version,
        state              = EXCLUDED.state,
        feed               = EXCLUDED.feed,
        bln_hash_id        = COALESCE(EXCLUDED.bln_hash_id, f.bln_hash_id),
        site_raw           = EXCLUDED.site_raw,
        site_city          = EXCLUDED.site_city,
        site_county        = EXCLUDED.site_county,
        workers            = EXCLUDED.workers,
        effective_date     = EXCLUDED.effective_date,
        effective_raw      = EXCLUDED.effective_raw,
        event_type         = EXCLUDED.event_type,
        is_temporary       = EXCLUDED.is_temporary,
        notice_pdf_url     = EXCLUDED.notice_pdf_url,
        last_seen_at       = now()
      RETURNING (xmax = 0) INTO v_was_insert;

      IF v_was_insert THEN v_inserted := v_inserted + 1; ELSE v_updated := v_updated + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      v_refused := v_refused + 1;
      v_ids     := v_ids || COALESCE(v_id, '(no id)');
      v_reasons := v_reasons || SQLERRM;
    END;
  END LOOP;

  RETURN QUERY SELECT v_inserted, v_updated, v_refused, v_ids, v_reasons;
END;
$$;

COMMENT ON FUNCTION public.layoff_filings_upsert(jsonb) IS
  'Writes a batch of layoff_filings rows from the poller, one sub-block per row so a refused row '
  'names itself and its reason without losing the batch. Refuses a source outside the two, a '
  'source_url that is not https, a date after today, an 8-K/A that is not status amendment, and '
  'anything the table''s own CHECKs refuse. filer_norm is computed here with layoff_norm from '
  'filer_for_norm (the pre-passed string) or filer_raw. service_role only.';

REVOKE ALL ON FUNCTION public.layoff_filings_upsert(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.layoff_filings_upsert(jsonb) TO service_role;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'layoff_filings_upsert'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;
