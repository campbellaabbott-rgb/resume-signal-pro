-- A STATE NOTICE KEEPS THE DAY WE FIRST READ IT, AND ONE THE STATE EDITED IN
-- PLACE RETIRES ITS OLD READING (S14X-036, S14X-069).
--
-- 1. FIRST READ (S14X-036). Maryland, Virginia, Arizona and Iowa publish a
--    notice date and no received or posted stamp, so their maps refused every
--    file and none of their notices was ever stored (Winnebago Industries'
--    Iowa notice of 2026-10-09, 51 workers, among them). layoff-filings now
--    reads them with public_basis 'our_first_fetch' (already admitted by the
--    table's CHECK): the public date is the day our read first saw the
--    notice. Every nightly read sends that day again, so the writer keeps the
--    EARLIEST one for such a row instead of overwriting it, and the Ghost
--    Index's published stamp lag (median days from notice to the state's
--    stamp) skips the basis: our read is not the state's stamp.
--
-- 2. AN EDITED NOTICE (S14X-069). A state that edits a notice in place
--    (Washington moved Alaska Airlines' notice from "SeaTac" to "Seattle,
--    Spokane, Renton") changes its dedupe key, so the edit was stored as a
--    second active filing beside the first. layoff_warn_retire_unseen sets
--    status 'superseded' on a (state, feed)'s active rows that a complete
--    read did not produce and whose event_date lies inside the read's own
--    span. A breaker retires nothing when one read would retire more than
--    20 rows, or more than 10% of the feed's active rows (above two): a
--    truncated file is a broken read, not a wave of withdrawn notices.
--    layoff-filings calls it after each changed, fully mapped read of a
--    whole-history feed, and calls it with no span first as the probe that
--    this migration is applied: until it answers, the new build stores no
--    our_first_fetch row (so no first-read date is ever overwritten).
--    Today's duplicates are retired once below, per whole-history feed: the
--    active rows the feed's latest read did not see (last_seen_at more than
--    an hour before that read), inside that read's span, through the same
--    breaker.
--
-- The writer and the partition are rewritten from the catalogue (one anchor
-- each, refused if the live body drifted). Grants unchanged; the new
-- function is service_role only. Self-verifying, safe to re-run.

SET LOCAL statement_timeout = '5min';

-- ── 1a. the writer keeps the first read's date ──────────────────────────────

DO $mig$
DECLARE
  v_def    text := pg_get_functiondef('public.layoff_filings_upsert(jsonb)'::regprocedure);
  v_anchor text := '        public_date        = EXCLUDED.public_date,';
  v_new    text := '        public_date        = CASE WHEN f.public_basis = ''our_first_fetch'' AND EXCLUDED.public_basis = ''our_first_fetch'''
                   || ' THEN LEAST(f.public_date, EXCLUDED.public_date) ELSE EXCLUDED.public_date END,';
BEGIN
  IF position('LEAST(f.public_date, EXCLUDED.public_date)' IN v_def) > 0 THEN
    RAISE NOTICE 'layoff_filings_upsert already keeps the first read''s date';
  ELSIF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'layoff_filings_upsert: the public_date anchor is not in the live definition; it drifted -- refusing to rewrite it';
  ELSE
    EXECUTE replace(v_def, v_anchor, v_new);
  END IF;
END
$mig$;

-- ── 1b. the published stamp lag skips our own read ──────────────────────────

DO $mig$
DECLARE
  v_def    text := pg_get_functiondef('public.refresh_layoff_partition()'::regprocedure);
  v_anchor text := E'     AND f.status = ''active''\n     AND f.event_date <= f.public_date\n     AND f.event_date >= current_date - 90;';
  v_new    text := E'     AND f.status = ''active''\n     AND f.public_basis <> ''our_first_fetch''\n     AND f.event_date <= f.public_date\n     AND f.event_date >= current_date - 90;';
BEGIN
  IF position('f.public_basis <> ''our_first_fetch''' IN v_def) > 0 THEN
    RAISE NOTICE 'refresh_layoff_partition already leaves our own read out of the stamp lag';
  ELSIF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'refresh_layoff_partition: the stamp-lag anchor is not in the live definition; it drifted -- refusing to rewrite it';
  ELSE
    EXECUTE replace(v_def, v_anchor, v_new);
  END IF;
END
$mig$;

-- ── 2. the retire ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.layoff_warn_retire_unseen(
  p_state text,
  p_feed  text,
  p_seen  text[],
  p_from  date,
  p_to    date
)
RETURNS TABLE (lr_retired int, lr_candidates int, lr_active int, lr_refused boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '1min'
AS $$
DECLARE
  v_active int := 0;
  v_ids    text[];
  v_n      int := 0;
BEGIN
  -- No span (the build's readiness probe, or an empty read): nothing to retire.
  IF p_state IS NULL OR p_feed IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RETURN QUERY SELECT 0, 0, 0, false;
    RETURN;
  END IF;
  SELECT count(*)::int INTO v_active
    FROM public.layoff_filings f
   WHERE f.source = 'state_warn' AND f.state = upper(p_state) AND f.feed = p_feed AND f.status = 'active';
  SELECT array_agg(f.filing_id ORDER BY f.filing_id) INTO v_ids
    FROM public.layoff_filings f
   WHERE f.source = 'state_warn' AND f.state = upper(p_state) AND f.feed = p_feed AND f.status = 'active'
     AND f.event_date BETWEEN p_from AND p_to
     AND f.filing_id <> ALL (COALESCE(p_seen, '{}'::text[]));
  v_n := COALESCE(array_length(v_ids, 1), 0);
  IF v_n > 20 OR (v_n > 2 AND v_n * 10 > v_active) THEN
    RETURN QUERY SELECT 0, v_n, v_active, true;
    RETURN;
  END IF;
  IF v_n > 0 THEN
    UPDATE public.layoff_filings f SET status = 'superseded' WHERE f.filing_id = ANY (v_ids) AND f.status = 'active';
  END IF;
  RETURN QUERY SELECT v_n, v_n, v_active, false;
END;
$$;

COMMENT ON FUNCTION public.layoff_warn_retire_unseen(text, text, text[], date, date) IS
  'After a complete read of one state WARN feed: sets status superseded on that (state, feed)''s active '
  'rows the read did not produce (p_seen) whose event_date lies inside the read''s span [p_from, p_to] -- '
  'a notice the state edited in place, whose old reading kept its own dedupe key. Retires nothing when '
  'one read would retire more than 20 rows, or more than 10% of the feed''s active rows above two '
  '(lr_refused). With no span it retires nothing (layoff-filings'' readiness probe). service_role only.';

REVOKE ALL ON FUNCTION public.layoff_warn_retire_unseen(text, text, text[], date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.layoff_warn_retire_unseen(text, text, text[], date, date) FROM anon;
REVOKE ALL ON FUNCTION public.layoff_warn_retire_unseen(text, text, text[], date, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.layoff_warn_retire_unseen(text, text, text[], date, date) TO service_role;

-- ── 2b. today's duplicates, once ───────────────────────────────────────────

DO $once$
DECLARE
  g      record;
  r      record;
  v_seen text[];
  v_from date;
  v_to   date;
BEGIN
  FOR g IN
    SELECT f.state::text AS state, f.feed, max(f.last_seen_at) AS last_read
      FROM public.layoff_filings f
     WHERE f.source = 'state_warn' AND f.feed = 'bln_raw'
     GROUP BY f.state, f.feed
  LOOP
    SELECT array_agg(f.filing_id), min(f.event_date), max(f.event_date)
      INTO v_seen, v_from, v_to
      FROM public.layoff_filings f
     WHERE f.source = 'state_warn' AND f.state = g.state AND f.feed = g.feed
       AND f.last_seen_at >= g.last_read - interval '1 hour';
    SELECT * INTO r FROM public.layoff_warn_retire_unseen(g.state, g.feed, v_seen, v_from, v_to);
    RAISE NOTICE 'retire % %: % retired of % unseen (% active)%', g.state, g.feed, r.lr_retired, r.lr_candidates, r.lr_active,
      CASE WHEN r.lr_refused THEN ' -- breaker held, nothing retired' ELSE '' END;
  END LOOP;
END
$once$;

DO $verify$
DECLARE
  v_sig text := 'public.layoff_warn_retire_unseen(text, text, text[], date, date)';
BEGIN
  IF position('LEAST(f.public_date, EXCLUDED.public_date)' IN pg_get_functiondef('public.layoff_filings_upsert(jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'layoff_filings_upsert still overwrites the day we first read a notice';
  END IF;
  IF position('f.public_basis <> ''our_first_fetch''' IN pg_get_functiondef('public.refresh_layoff_partition()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'the published stamp lag still counts our own read as the state''s stamp';
  END IF;
  IF has_function_privilege('anon', v_sig, 'EXECUTE') OR has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'layoff_warn_retire_unseen is callable by a client role';
  END IF;
  IF NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'layoff_warn_retire_unseen: service_role cannot execute it';
  END IF;
  IF has_function_privilege('anon', 'public.layoff_filings_upsert(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'layoff_filings_upsert became callable by anon';
  END IF;
END
$verify$;
