-- A PERK IS SHOWN ONLY FROM THE EXTRACTOR OUTPUT ITS AUDIT JUDGED (S13-121).
--
-- 20261012110000 published a perk key on a launch audit of 60 drawn claim
-- rows, and the publish row kept no record of WHICH extractor's output those
-- rows were. When the extractor is bumped (EXTRACTOR_VERSION in
-- _shared/perks-extract.ts), the sweep re-reads every posting and the nightly
-- rollup rebuilds the claim rows from the new output; the key stayed
-- published, so rows nobody had judged went on every page until its 45 days
-- ran out. And employer_perk_audit_record took any counts it was handed: an
-- audit file of any age or build, or none at all, could publish a key or
-- restart its 45 days (reproduced in pglite against 20261012110000 alone,
-- 2026-11-01: a v2 launch kept serving the v3 rebuild, and a reaudit with no
-- draw behind it restarted the clock).
--
-- WHAT CHANGES.
--   employer_perk_rollups.extractor_version: the version every one of a claim
--     row's n postings was read by; NULL when they were read by more than one
--     (a lap that met a bump half way). The rollup tick is restated from
--     20261012110000 with that one column added.
--   employer_perk_audit_draws: every draw, with its key, the extractor version
--     it drew, how many rows, when, and whether it has been recorded. Private.
--   employer_perk_audit_draw(p_perk, p_version, p_rows): draws only claim rows
--     of that version (employer-profiles passes its EXTRACTOR_VERSION), records
--     the draw, and returns its id and time with the rows.
--   employer_perk_audit_record(p_perk, p_mode, p_judged, p_correct, p_draw_id,
--     p_version, p_note): a launch or re-audit names its draw. The draw must be
--     of that key, at most 14 days old, never recorded before, drawn under the
--     version the sweep reads with now, and hold at least the rows judged. The
--     key's audit is dated from the draw, not from the record, and carries the
--     draw's version. A re-audit keeps a key published only when it judged the
--     version the key was published on. Withdraw needs no draw.
--   get_employer_perks: a key is live only with an audited version, and shows
--     only claim rows of that version. The status says both, per key.
--
-- NOTHING LIVE IS SWITCHED OFF. On 2026-11-01 the reader answered
-- published_keys [] (no key had passed a launch audit). A key not live under
-- 20261012110000's rule gets audited_version NULL and needs a launch audit
-- under these rules to show anything, which it needed already. A key that IS
-- live under it when this applies (published, audited in the last 45 days,
-- publishing not paused) is carried: audited_version is the one extractor
-- version every stored posting holds, its audit dated as before, its claim
-- rows stamped with that version until the next lap restates them. That needs
-- one version, already read before the key's audit; otherwise this RAISEs,
-- nothing changes, and the key goes on serving under the old rule (owner
-- rule: no pause without a current yes).
--
-- Old signatures go by the catalogue, every overload of the two names but the
-- versioned one, never by a hand-listed signature (the live database may hold
-- one no migration wrote). Fresh functions inherit Supabase's default EXECUTE
-- for anon and authenticated, so each is revoked from them by name, and a
-- pg_proc loop closes every overload too.
--
-- Self-verifying, safe to re-run: columns ADD IF NOT EXISTS, the table IF NOT
-- EXISTS, every other overload of the two audit functions dropped from the
-- catalogue, every function OR REPLACE; the self-check RAISEs on any failure.

SET LOCAL statement_timeout = '2min';

-- ── 1. what each row was read by, and what each audit judged ──────────────

ALTER TABLE public.employer_perk_rollups ADD COLUMN IF NOT EXISTS extractor_version smallint;
ALTER TABLE public.employer_profile_perk_publish ADD COLUMN IF NOT EXISTS audited_version smallint;
ALTER TABLE public.employer_profile_perk_publish ADD COLUMN IF NOT EXISTS audit_draw_id bigint;
ALTER TABLE public.employer_profile_perk_publish ADD COLUMN IF NOT EXISTS audit_drawn_at timestamptz;

CREATE TABLE IF NOT EXISTS public.employer_perk_audit_draws (
  id                bigserial PRIMARY KEY,
  perk              text NOT NULL,
  extractor_version smallint NOT NULL,
  drawn_rows        integer NOT NULL CHECK (drawn_rows >= 0),
  drawn_at          timestamptz NOT NULL DEFAULT now(),
  recorded_at       timestamptz,
  recorded_mode     text CHECK (recorded_mode IS NULL OR recorded_mode IN ('launch', 'reaudit'))
);
COMMENT ON TABLE public.employer_perk_audit_draws IS
  'Every owner draw of perk claim rows: the key, the extractor version of the rows drawn, how many, when, and when it was '
  'recorded (once only). employer_perk_audit_record publishes or re-dates a key only from a draw of that key and version at '
  'most 14 days old. Private: service_role only.';
ALTER TABLE public.employer_perk_audit_draws ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.employer_perk_audit_draws FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.employer_perk_audit_draws_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.employer_perk_audit_draws TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.employer_perk_audit_draws_id_seq TO service_role;

COMMENT ON COLUMN public.employer_perk_rollups.extractor_version IS
  'The extractor version every one of the row''s n postings was read by; NULL when they were read by more than one.';
COMMENT ON COLUMN public.employer_profile_perk_publish.audited_version IS
  'The extractor version of the rows the key''s last launch or re-audit judged; the reader shows only rows of this version.';

-- ── 1b. a key live under the old rule is carried, or nothing applies ──────

DO $carry$
DECLARE
  v_keys     text[];
  v_versions smallint[];
  v_late     text[];
BEGIN
  SELECT array_agg(pp.perk ORDER BY pp.perk) INTO v_keys
    FROM public.employer_profile_perk_publish pp
   WHERE pp.audited_version IS NULL
     AND pp.published
     AND pp.perk IN ('health', 'dental', 'vision', 'life_dis', 'retire', 'pto', 'parental', 'equity', 'visa_not_offered')
     AND pp.last_audited_at IS NOT NULL
     AND pp.last_audited_at >= now() - interval '45 days'
     AND NOT COALESCE((SELECT c.publish_paused FROM public.employer_profile_config c WHERE c.id), true);
  IF v_keys IS NULL THEN
    RETURN;
  END IF;
  SELECT array_agg(DISTINCT e.extractor_version ORDER BY e.extractor_version) INTO v_versions
    FROM public.employer_perk_postings e;
  IF COALESCE(cardinality(v_versions), 0) <> 1 THEN
    RAISE EXCEPTION 'perk keys % are live under 20261012110000 and the stored postings hold extractor versions %: no single extractor version to carry them on. Nothing changed and they keep serving; apply once the sweep has read every posting with one version, or after the owner withdraws them',
      v_keys, COALESCE(v_versions::text, '(none)');
  END IF;
  SELECT array_agg(pp.perk ORDER BY pp.perk) INTO v_late
    FROM public.employer_profile_perk_publish pp
   WHERE pp.perk = ANY (v_keys)
     AND NOT EXISTS (SELECT 1 FROM public.employer_perk_postings e WHERE e.extracted_at <= pp.last_audited_at);
  IF v_late IS NOT NULL THEN
    RAISE EXCEPTION 'perk keys % are live under 20261012110000 and extractor v% was first read after their audit (no stored posting it read is older than the audit), so it is not the output they were judged on. Nothing changed and they keep serving; a launch audit of v% under these rules, or a withdraw, settles it',
      v_late, v_versions[1], v_versions[1];
  END IF;
  UPDATE public.employer_profile_perk_publish pp
     SET audited_version = v_versions[1], audit_drawn_at = pp.last_audited_at
   WHERE pp.perk = ANY (v_keys);
  UPDATE public.employer_perk_rollups r
     SET extractor_version = v_versions[1]
   WHERE r.perk = ANY (v_keys) AND r.extractor_version IS NULL;
  RAISE NOTICE 'perk keys % were live under 20261012110000: carried on extractor v%, the one version every stored posting holds and in use before their audit; their 45 days run from that audit as before',
    v_keys, v_versions[1];
END
$carry$;

-- ── 2. the rollup, restated from 20261012110000 with the version column ────

CREATE OR REPLACE FUNCTION public.employer_perk_rollup_tick(p_budget_ms integer DEFAULT 90000)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '110s'
AS $$
DECLARE
  v_started  timestamptz := clock_timestamp();
  v_deadline timestamptz := clock_timestamp() + make_interval(secs => LEAST(GREATEST(COALESCE(p_budget_ms, 90000), 1000), 100000) / 1000.0);
  v_chunk    integer := COALESCE((SELECT c.rollup_chunk FROM public.employer_profile_config c WHERE c.id), 50000);
  v_cursor   text;
  v_lap_started timestamptz;
  v_lap_finished timestamptz;
  v_tokens   text[];
  v_last     text;
  v_n        integer;
  v_chunks   integer := 0;
  v_boards   integer := 0;
  v_rows     integer := 0;
  v_pruned   integer := 0;
  v_state    text := 'budget';
  v_budget   numeric := LEAST(GREATEST(COALESCE(p_budget_ms, 90000), 1000), 100000);
  v_est      numeric;
  v_slowest  numeric := 0;
  v_t0       timestamptz;
  v_work     integer;
BEGIN
  INSERT INTO public.employer_perk_rollup_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
  SELECT s.lap_cursor, s.lap_started_at, s.lap_finished_at, COALESCE(s.ms_per_krow, 0)
    INTO v_cursor, v_lap_started, v_lap_finished, v_est
    FROM public.employer_perk_rollup_state s WHERE s.id FOR UPDATE;
  -- One chunk is expected to take at most a third of the budget.
  IF v_est > 0 THEN
    v_chunk := GREATEST(1000, LEAST(v_chunk, floor((v_budget / 3.0) / v_est * 1000)::integer));
  END IF;

  IF v_cursor IS NULL AND v_lap_finished IS NOT NULL AND v_lap_finished >= date_trunc('day', now()) THEN
    RETURN jsonb_build_object('ok', true, 'state', 'lap_done_today', 'lap_finished_at', v_lap_finished);
  END IF;
  IF v_cursor IS NULL THEN
    v_cursor := '';
    v_lap_started := now();
    UPDATE public.employer_perk_rollup_state s
       SET lap_started_at = v_lap_started, lap_cursor = '', lap_finished_at = NULL, chunks = 0, boards = 0, rows_written = 0
     WHERE s.id;
  END IF;

  LOOP
    IF clock_timestamp() >= v_deadline THEN
      v_state := 'budget';
      EXIT;
    END IF;
    -- Never start a chunk the slowest one seen would carry past the budget.
    IF v_chunks > 0
       AND clock_timestamp() + make_interval(secs => 1.5 * GREATEST(v_est, v_slowest) * v_chunk / 1000.0 / 1000.0) > v_deadline THEN
      v_state := 'budget';
      EXIT;
    END IF;
    v_t0 := clock_timestamp();

    SELECT array_agg(DISTINCT w.company_token), max(w.company_token) INTO v_tokens, v_last
      FROM (SELECT e.company_token FROM public.employer_perk_postings e
             WHERE e.company_token > v_cursor
             ORDER BY e.company_token
             LIMIT v_chunk) w;

    IF v_last IS NULL THEN
      DELETE FROM public.employer_perk_rollups r WHERE r.company_token > v_cursor;
      DELETE FROM public.employer_perk_board_flags f WHERE f.company_token > v_cursor;
      DELETE FROM public.employer_perk_lines l
       WHERE l.line_hash IN (SELECT o.line_hash FROM public.employer_perk_lines o
                              WHERE o.last_seen_at < now() - interval '45 days' LIMIT 50000);
      DELETE FROM public.employer_profile_runs r WHERE r.started_at < now() - interval '30 days';
      v_lap_finished := now();
      v_cursor := NULL;
      v_state := 'lap_finished';
      EXIT;
    END IF;

    SELECT count(*)::integer INTO v_work FROM public.employer_perk_postings e WHERE e.company_token = ANY (v_tokens);

    -- Rows whose posting left the serving set are not "open postings".
    DELETE FROM public.employer_perk_postings e
     WHERE e.company_token = ANY (v_tokens)
       AND NOT EXISTS (SELECT 1 FROM public.job_board_postings p
                        WHERE p.id = e.posting_id
                          AND p.missing_since IS NULL
                          AND p.effective_posted >= now() - interval '30 days');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_pruned := v_pruned + v_n;

    DELETE FROM public.employer_perk_rollups r WHERE r.company_token > v_cursor AND r.company_token <= v_last;
    DELETE FROM public.employer_perk_board_flags f WHERE f.company_token > v_cursor AND f.company_token <= v_last;

    -- A franchisee sets its own benefits: a board where 30% or more of the
    -- readable postings say so shows none. An agency board's perks are the
    -- agency's, never its clients'.
    INSERT INTO public.employer_perk_board_flags (source, company_token, flag, share, postings, as_of)
    SELECT e.source, e.company_token, 'franchise',
           round((count(*) FILTER (WHERE e.franchise))::numeric / count(*), 3), count(*)::integer, now()
      FROM public.employer_perk_postings e
     WHERE e.company_token = ANY (v_tokens) AND e.readable
     GROUP BY e.source, e.company_token
    HAVING (count(*) FILTER (WHERE e.franchise)) * 10 >= 3 * count(*)
    ON CONFLICT DO NOTHING;
    INSERT INTO public.employer_perk_board_flags (source, company_token, flag, share, postings, as_of)
    SELECT e.source, e.company_token, 'agency',
           round((count(*) FILTER (WHERE e.agency))::numeric / count(*), 3), count(*)::integer, now()
      FROM public.employer_perk_postings e
     WHERE e.company_token = ANY (v_tokens)
     GROUP BY e.source, e.company_token
    HAVING (count(*) FILTER (WHERE e.agency)) * 2 >= count(*)
    ON CONFLICT DO NOTHING;

    WITH base AS (
      SELECT e.posting_id, e.source, e.company_token, e.country, e.perks_y, e.perks_q, e.perks_n, e.quote_line_hash, e.extracted_at,
             e.extractor_version
        FROM public.employer_perk_postings e
       WHERE e.company_token = ANY (v_tokens)
         AND e.readable AND e.english AND NOT e.franchise AND NOT e.agency
         AND e.country IS NOT NULL AND e.country <> ''
         AND NOT EXISTS (SELECT 1 FROM public.employer_perk_board_flags f
                          WHERE f.company_token = e.company_token AND f.source = e.source)
    ),
    grp AS (
      SELECT b.source, b.company_token, b.country, count(*)::integer AS n, min(b.extracted_at) AS read_from,
             CASE WHEN min(b.extractor_version) = max(b.extractor_version) THEN min(b.extractor_version) END AS version
        FROM base b
       GROUP BY b.source, b.company_token, b.country
      HAVING count(*) >= 5
    ),
    hits AS (
      SELECT b.source, b.company_token, b.country, k.perk, b.posting_id,
             (k.counts = 'positive' AND ((b.perks_q >> k.bit) & 1) = 1) AS hedged,
             b.quote_line_hash[k.bit + 1] AS qh
        FROM base b
        JOIN grp g ON g.source = b.source AND g.company_token = b.company_token AND g.country = b.country
       CROSS JOIN public.employer_profile_perk_publish k
       WHERE CASE WHEN k.counts = 'negation' THEN ((b.perks_n >> k.bit) & 1) = 1
                  ELSE (((b.perks_y | b.perks_q) >> k.bit) & 1) = 1 END
    ),
    agg AS (
      SELECT h.source, h.company_token, h.country, h.perk, count(*)::integer AS k,
             (count(*) FILTER (WHERE h.hedged))::integer AS q
        FROM hits h
       GROUP BY h.source, h.company_token, h.country, h.perk
    ),
    modal AS (
      SELECT DISTINCT ON (x.source, x.company_token, x.country, x.perk)
             x.source, x.company_token, x.country, x.perk, x.qh, x.cnt, x.pid
        FROM (SELECT h.source, h.company_token, h.country, h.perk, h.qh, count(*)::integer AS cnt, min(h.posting_id) AS pid
                FROM hits h WHERE h.qh IS NOT NULL
               GROUP BY h.source, h.company_token, h.country, h.perk, h.qh) x
       ORDER BY x.source, x.company_token, x.country, x.perk, x.cnt DESC, x.qh
    )
    INSERT INTO public.employer_perk_rollups
      (source, company_token, country, perk, k, n, standard_text, qualified_share, quote_hash, quote_posting_id, as_of, extractor_version)
    SELECT a.source, a.company_token, a.country, a.perk, a.k, g.n,
           COALESCE(m.cnt * 5 >= a.k * 4, false),
           round(a.q::numeric / a.k, 3),
           m.qh, m.pid, g.read_from, g.version
      FROM agg a
      JOIN grp g ON g.source = a.source AND g.company_token = a.company_token AND g.country = a.country
      LEFT JOIN modal m ON m.source = a.source AND m.company_token = a.company_token AND m.country = a.country AND m.perk = a.perk
     WHERE a.k >= 2 AND a.k * 10 >= g.n
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    v_rows := v_rows + v_n;
    v_chunks := v_chunks + 1;
    v_boards := v_boards + COALESCE(cardinality(v_tokens), 0);
    v_cursor := v_last;
    v_slowest := GREATEST(v_slowest,
      extract(epoch FROM clock_timestamp() - v_t0) * 1000.0 * 1000.0 / GREATEST(v_work, 1));
  END LOOP;

  UPDATE public.employer_perk_rollup_state s
     SET lap_cursor = v_cursor, lap_started_at = v_lap_started, lap_finished_at = v_lap_finished,
         chunks = s.chunks + v_chunks, boards = s.boards + v_boards, rows_written = s.rows_written + v_rows,
         ms_per_krow = CASE WHEN v_chunks > 0 THEN round(v_slowest, 3) ELSE s.ms_per_krow END,
         updated_at = now()
   WHERE s.id;
  INSERT INTO public.employer_profile_runs (kind, started_at, finished_at, ok, boards, postings_written, note)
  VALUES ('rollup', v_started, clock_timestamp(), true, v_boards, v_rows,
          format('state=%s chunks=%s pruned=%s cursor=%s', v_state, v_chunks, v_pruned, COALESCE(v_cursor, '(lap done)')));
  RETURN jsonb_build_object('ok', true, 'state', v_state, 'chunks', v_chunks, 'boards', v_boards, 'rows', v_rows,
                            'pruned', v_pruned, 'cursor', v_cursor, 'chunk_rows', v_chunk, 'ms_per_krow', round(v_slowest, 3),
                            'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000));
END;
$$;


-- ── 3. the owner's draw and record, tied to a version and a draw ───────────

-- Every overload that is not the versioned one, whatever the catalogue holds:
-- one name, one signature (PostgREST refuses to choose between two).
DO $drop_draw$
DECLARE
  keep CONSTANT text := 'p_perk text, p_version smallint, p_rows integer';
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname = 'employer_perk_audit_draw'
       AND pg_get_function_identity_arguments(p.oid) IS DISTINCT FROM keep
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig::text;
  END LOOP;
END
$drop_draw$;

DO $drop_record$
DECLARE
  keep CONSTANT text := 'p_perk text, p_mode text, p_judged integer, p_correct integer, p_draw_id bigint, p_version smallint, p_note text';
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname = 'employer_perk_audit_record'
       AND pg_get_function_identity_arguments(p.oid) IS DISTINCT FROM keep
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig::text;
  END LOOP;
END
$drop_record$;

-- As 20261012110000 drew (a negation stratum first, then random rows, each
-- with its quote and a 3-posting spot check), from claim rows of p_version
-- only, and recorded: the answer carries the draw's id, version and time.
CREATE OR REPLACE FUNCTION public.employer_perk_audit_draw(p_perk text, p_version smallint, p_rows integer DEFAULT 60)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
DECLARE
  k record;
  v_skip text[] := COALESCE((SELECT c.suppressed_sources FROM public.employer_profile_config c WHERE c.id), '{}'::text[]);
  v_out jsonb;
  v_draw public.employer_perk_audit_draws%ROWTYPE;
BEGIN
  SELECT pp.perk, pp.bit, pp.counts INTO k FROM public.employer_profile_perk_publish pp WHERE pp.perk = p_perk;
  IF k.perk IS NULL OR p_perk NOT IN ('health', 'dental', 'vision', 'life_dis', 'retire', 'pto', 'parental', 'equity', 'visa_not_offered') THEN
    RAISE EXCEPTION 'not a candidate key: %', p_perk USING ERRCODE = '22023';
  END IF;
  IF p_version IS NULL OR p_version < 1 THEN
    RAISE EXCEPTION 'a draw names the extractor version it judges' USING ERRCODE = '22023';
  END IF;
  WITH eligible AS (
    SELECT r.*,
           (r.perk <> 'visa_not_offered'
            AND EXISTS (SELECT 1 FROM public.employer_perk_lines ln
                         WHERE ln.line_hash = r.quote_hash
                           AND ln.line ~* '(n''t|\mnot\M|\mno\M|\mwithout\M|\mexcluding\M|\mineligible\M|\mexclusive of\M)')) AS negation_near
      FROM public.employer_perk_rollups r
     WHERE r.perk = k.perk
       AND r.extractor_version = p_version
       AND NOT (r.source = ANY (v_skip))
       AND NOT EXISTS (SELECT 1 FROM public.employer_perk_board_flags f WHERE f.company_token = r.company_token AND f.source = r.source)
       AND NOT EXISTS (SELECT 1 FROM public.employer_perk_postings e2 WHERE e2.company_token = r.company_token AND e2.source <> r.source)
       AND (r.perk <> 'visa_not_offered' OR r.k >= 3)
  ),
  want AS (SELECT LEAST(GREATEST(COALESCE(p_rows, 60), 1), 200) AS n),
  strat AS (
    SELECT el.*, 'negation_near'::text AS stratum FROM eligible el WHERE el.negation_near
     ORDER BY random()
     LIMIT (SELECT GREATEST(1, ceil(w.n / 4.0))::integer FROM want w)
  ),
  pick AS (
    SELECT * FROM strat
    UNION ALL
    SELECT * FROM (
      SELECT el.*, 'random'::text AS stratum FROM eligible el
       WHERE NOT EXISTS (SELECT 1 FROM strat st WHERE st.company_token = el.company_token AND st.source = el.source
                                               AND st.country = el.country AND st.perk = el.perk)
       ORDER BY random()
       LIMIT (SELECT GREATEST(0, w.n - (SELECT count(*) FROM strat))::integer FROM want w)
    ) rest
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'source', pk.source, 'company_token', pk.company_token, 'country', pk.country, 'perk', pk.perk,
           'k', pk.k, 'n', pk.n, 'qualified_share', pk.qualified_share, 'standard_text', pk.standard_text, 'as_of', pk.as_of,
           'stratum', pk.stratum,
           'employer', jp.company, 'quote', l.line, 'quote_posting_id', pk.quote_posting_id,
           'quote_title', jp.title, 'quote_link', jp.apply_url,
           'spot_check', (
             SELECT COALESCE(jsonb_agg(jsonb_build_object('posting_id', s.posting_id, 'title', s.title, 'link', s.apply_url, 'quote', s.line)), '[]'::jsonb)
               FROM (SELECT e.posting_id, p2.title, p2.apply_url, l2.line
                       FROM public.employer_perk_postings e
                       JOIN public.job_board_postings p2 ON p2.id = e.posting_id
                       LEFT JOIN public.employer_perk_lines l2 ON l2.line_hash = e.quote_line_hash[k.bit + 1]
                      WHERE e.company_token = pk.company_token AND e.source = pk.source AND e.country = pk.country
                        AND e.extractor_version = p_version
                        AND e.readable AND e.english AND NOT e.franchise AND NOT e.agency
                        AND CASE WHEN k.counts = 'negation' THEN ((e.perks_n >> k.bit) & 1) = 1
                                 ELSE (((e.perks_y | e.perks_q) >> k.bit) & 1) = 1 END
                      ORDER BY random()
                      LIMIT 3) s)
         )), '[]'::jsonb)
    INTO v_out
    FROM pick pk
    LEFT JOIN public.employer_perk_lines l ON l.line_hash = pk.quote_hash
    LEFT JOIN public.job_board_postings jp ON jp.id = pk.quote_posting_id;
  INSERT INTO public.employer_perk_audit_draws (perk, extractor_version, drawn_rows)
  VALUES (k.perk, p_version, jsonb_array_length(v_out))
  RETURNING * INTO v_draw;
  INSERT INTO public.employer_profile_runs (kind, finished_at, ok, postings_read, note)
  VALUES ('audit', now(), true, jsonb_array_length(v_out),
          format('draw %s perk=%s version=%s rows=%s', v_draw.id, k.perk, p_version, jsonb_array_length(v_out)));
  RETURN jsonb_build_object('perk', k.perk, 'drawn', jsonb_array_length(v_out), 'draw_id', v_draw.id,
                            'extractor_version', p_version, 'drawn_at', v_draw.drawn_at, 'rows', v_out);
END;
$$;

-- The judgement of one draw, written back. launch: at least 60 judged and at
-- most one in twenty wrong publishes the key on the draw's version, anything
-- less unpublishes it. reaudit: a stratum of at least 5; it keeps a key
-- published (and dates its audit from the draw) only while the key is live,
-- on the version this draw judged, with fewer than two wrong; otherwise the
-- key is unpublished. withdraw: unpublished, any key, no draw.
CREATE OR REPLACE FUNCTION public.employer_perk_audit_record(p_perk text, p_mode text, p_judged integer, p_correct integer,
                                                  p_draw_id bigint, p_version smallint, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10s'
AS $$
DECLARE
  v_row  public.employer_profile_perk_publish%ROWTYPE;
  v_draw public.employer_perk_audit_draws%ROWTYPE;
  v_wrong integer;
  v_keep boolean;
BEGIN
  SELECT * INTO v_row FROM public.employer_profile_perk_publish pp WHERE pp.perk = p_perk FOR UPDATE;
  IF v_row.perk IS NULL THEN
    RAISE EXCEPTION 'no such perk key: %', p_perk USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'withdraw' THEN
    UPDATE public.employer_profile_perk_publish pp
       SET published = false, audit_mode = 'withdraw', audit_note = left(p_note, 500), updated_at = now()
     WHERE pp.perk = p_perk;
  ELSE
    IF p_mode NOT IN ('launch', 'reaudit') THEN
      RAISE EXCEPTION 'mode must be launch, reaudit or withdraw' USING ERRCODE = '22023';
    END IF;
    IF p_perk NOT IN ('health', 'dental', 'vision', 'life_dis', 'retire', 'pto', 'parental', 'equity', 'visa_not_offered') THEN
      RAISE EXCEPTION 'not a candidate key: % can never publish', p_perk USING ERRCODE = '22023';
    END IF;
    IF p_judged IS NULL OR p_correct IS NULL OR p_correct < 0 OR p_correct > p_judged THEN
      RAISE EXCEPTION 'judged and correct must be counts with correct <= judged' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_draw FROM public.employer_perk_audit_draws d WHERE d.id = p_draw_id FOR UPDATE;
    IF v_draw.id IS NULL THEN
      RAISE EXCEPTION 'a % record names the draw it judged, and % is not a draw', p_mode, COALESCE(p_draw_id::text, '(none)') USING ERRCODE = '22023';
    END IF;
    IF v_draw.perk <> p_perk THEN
      RAISE EXCEPTION 'draw % is of %, not %', v_draw.id, v_draw.perk, p_perk USING ERRCODE = '22023';
    END IF;
    IF v_draw.recorded_at IS NOT NULL THEN
      RAISE EXCEPTION 'draw % was recorded at %; draw again', v_draw.id, v_draw.recorded_at USING ERRCODE = '22023';
    END IF;
    IF v_draw.drawn_at < now() - interval '14 days' THEN
      RAISE EXCEPTION 'draw % is from %, more than 14 days ago; draw again', v_draw.id, v_draw.drawn_at USING ERRCODE = '22023';
    END IF;
    IF p_version IS NULL OR v_draw.extractor_version <> p_version THEN
      RAISE EXCEPTION 'draw % judged extractor v%, and the sweep reads with v%; draw again', v_draw.id, v_draw.extractor_version,
        COALESCE(p_version::text, '?') USING ERRCODE = '22023';
    END IF;
    IF p_judged > v_draw.drawn_rows THEN
      RAISE EXCEPTION 'draw % holds % rows, not % judged', v_draw.id, v_draw.drawn_rows, p_judged USING ERRCODE = '22023';
    END IF;
    v_wrong := p_judged - p_correct;
    IF p_mode = 'launch' THEN
      IF p_judged < 60 THEN
        RAISE EXCEPTION 'a launch audit judges at least 60 rows, not %', p_judged USING ERRCODE = '22023';
      END IF;
      UPDATE public.employer_profile_perk_publish pp
         SET published = (v_wrong * 20 <= p_judged), last_audited_at = v_draw.drawn_at, audit_mode = 'launch',
             audit_judged = p_judged, audit_correct = p_correct, audit_note = left(p_note, 500),
             audited_version = v_draw.extractor_version, audit_draw_id = v_draw.id, audit_drawn_at = v_draw.drawn_at,
             updated_at = now()
       WHERE pp.perk = p_perk;
    ELSE
      IF p_judged < 5 THEN
        RAISE EXCEPTION 'a re-audit stratum judges at least 5 rows, not %', p_judged USING ERRCODE = '22023';
      END IF;
      v_keep := v_row.published AND v_row.last_audited_at >= now() - interval '45 days'
                AND v_row.audited_version = v_draw.extractor_version AND v_wrong < 2;
      UPDATE public.employer_profile_perk_publish pp
         SET published = COALESCE(v_keep, false),
             last_audited_at = CASE WHEN v_keep THEN GREATEST(pp.last_audited_at, v_draw.drawn_at) ELSE pp.last_audited_at END,
             audit_drawn_at = CASE WHEN v_keep THEN v_draw.drawn_at ELSE pp.audit_drawn_at END,
             audit_draw_id = CASE WHEN v_keep THEN v_draw.id ELSE pp.audit_draw_id END,
             audit_mode = 'reaudit', audit_judged = p_judged, audit_correct = p_correct,
             audit_note = left(p_note, 500), updated_at = now()
       WHERE pp.perk = p_perk;
    END IF;
    UPDATE public.employer_perk_audit_draws d SET recorded_at = now(), recorded_mode = p_mode WHERE d.id = v_draw.id;
  END IF;
  INSERT INTO public.employer_profile_runs (kind, finished_at, ok, postings_read, note)
  VALUES ('audit', now(), true, p_judged,
          format('record perk=%s mode=%s judged=%s correct=%s draw=%s version=%s', p_perk, p_mode, p_judged, p_correct,
                 COALESCE(p_draw_id::text, '-'), COALESCE(p_version::text, '-')));
  SELECT * INTO v_row FROM public.employer_profile_perk_publish pp WHERE pp.perk = p_perk;
  RETURN to_jsonb(v_row);
END;
$$;

-- ── 4. the status and the reader, restated with the version ───────────────

CREATE OR REPLACE FUNCTION public.employer_perk_audit_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  SELECT jsonb_build_object(
    'keys', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'perk', pp.perk,
               'published', pp.published AND pp.last_audited_at IS NOT NULL AND pp.last_audited_at >= now() - interval '45 days'
                            AND pp.audited_version IS NOT NULL,
               'flag', pp.published,
               'expired', pp.published AND (pp.last_audited_at IS NULL OR pp.last_audited_at < now() - interval '45 days'),
               'live', pp.published AND pp.last_audited_at IS NOT NULL AND pp.last_audited_at >= now() - interval '45 days'
                       AND pp.audited_version IS NOT NULL
                       AND NOT COALESCE((SELECT c.publish_paused FROM public.employer_profile_config c WHERE c.id), true),
               'last_audited_at', pp.last_audited_at,
               'expires_at', pp.last_audited_at + interval '45 days', 'audit_mode', pp.audit_mode,
               'audit_judged', pp.audit_judged, 'audit_correct', pp.audit_correct,
               'audited_version', pp.audited_version, 'audit_draw_id', pp.audit_draw_id, 'audit_drawn_at', pp.audit_drawn_at,
               'rows', (SELECT count(*) FROM public.employer_perk_rollups r WHERE r.perk = pp.perk),
               'rows_audited_version', (SELECT count(*) FROM public.employer_perk_rollups r
                                         WHERE r.perk = pp.perk AND r.extractor_version = pp.audited_version)) ORDER BY pp.bit, pp.counts), '[]'::jsonb)
             FROM public.employer_profile_perk_publish pp),
    'config', (SELECT to_jsonb(c) FROM public.employer_profile_config c WHERE c.id),
    'rollup', (SELECT to_jsonb(s) FROM public.employer_perk_rollup_state s WHERE s.id),
    'queue', (SELECT jsonb_build_object('boards', count(*), 'pending', count(*) FILTER (WHERE q.swept_at IS NULL OR q.swept_at < q.queued_at),
                                        'queued_at', max(q.queued_at)) FROM public.employer_perk_sweep_boards q),
    'postings', (SELECT jsonb_build_object('rows', count(*), 'readable', count(*) FILTER (WHERE e.readable)) FROM public.employer_perk_postings e),
    'rollup_versions', (SELECT COALESCE(jsonb_object_agg(COALESCE(v.extractor_version::text, 'mixed'), v.n), '{}'::jsonb)
                          FROM (SELECT r.extractor_version, count(*) AS n FROM public.employer_perk_rollups r GROUP BY 1) v),
    'runs', (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id DESC), '[]'::jsonb)
               FROM (SELECT * FROM public.employer_profile_runs ORDER BY id DESC LIMIT 20) r)
  )
$$;


CREATE OR REPLACE FUNCTION public.get_employer_perks(p_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '3s'
AS $$
  WITH cfg AS (
    SELECT COALESCE((SELECT c.publish_paused FROM public.employer_profile_config c WHERE c.id), true) AS paused,
           COALESCE((SELECT c.suppressed_sources FROM public.employer_profile_config c WHERE c.id), '{}'::text[]) AS skip
  ),
  live AS (
    SELECT pp.perk, pp.audited_version
      FROM public.employer_profile_perk_publish pp, cfg
     WHERE NOT cfg.paused
       AND pp.published
       AND pp.perk IN ('health', 'dental', 'vision', 'life_dis', 'retire', 'pto', 'parental', 'equity', 'visa_not_offered')
       AND pp.last_audited_at IS NOT NULL
       AND pp.last_audited_at >= now() - interval '45 days'
       AND pp.audited_version IS NOT NULL
  ),
  srcs AS (
    SELECT DISTINCT e.source FROM public.employer_perk_postings e WHERE e.company_token = p_token
    UNION
    SELECT DISTINCT r.source FROM public.employer_perk_rollups r WHERE r.company_token = p_token
  ),
  shared AS (SELECT count(*) > 1 AS collision FROM srcs),
  withheld AS (
    SELECT f.source, f.flag AS reason, f.share FROM public.employer_perk_board_flags f
     WHERE f.company_token = p_token AND EXISTS (SELECT 1 FROM live)
    UNION ALL
    SELECT s.source, 'vendor_text_not_stored', NULL::numeric FROM srcs s, cfg
     WHERE s.source = ANY (cfg.skip) AND EXISTS (SELECT 1 FROM live)
  ),
  claims AS (
    SELECT r.source, r.country, r.perk, r.k, r.n, r.qualified_share, r.standard_text, r.as_of, l.line,
           l.pto_days, l.pto_plus_holidays,
           CASE WHEN EXISTS (SELECT 1 FROM public.job_board_postings p
                              WHERE p.id = r.quote_posting_id AND p.missing_since IS NULL
                                AND p.effective_posted >= now() - interval '30 days')
                THEN r.quote_posting_id END AS posting
      FROM public.employer_perk_rollups r
      JOIN live ON live.perk = r.perk AND r.extractor_version = live.audited_version
      JOIN public.employer_perk_lines l ON l.line_hash = r.quote_hash
     WHERE r.company_token = p_token
       AND NOT (SELECT collision FROM shared)
       AND NOT EXISTS (SELECT 1 FROM withheld w WHERE w.source = r.source)
       AND r.n >= 5 AND r.k >= 2 AND r.k * 10 >= r.n
       AND (r.perk <> 'visa_not_offered' OR r.k >= 3)
  )
  SELECT jsonb_build_object(
    'token', p_token,
    'collision', (SELECT collision FROM shared) AND EXISTS (SELECT 1 FROM live),
    'expiry_days', 45,
    'published_keys', COALESCE((SELECT jsonb_agg(lk.perk ORDER BY lk.perk) FROM live lk), '[]'::jsonb),
    'perks', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'source', c.source, 'country', c.country, 'perk', c.perk, 'k', c.k, 'n', c.n,
               'qualified_share', c.qualified_share, 'standard_text', c.standard_text, 'as_of', c.as_of,
               'quote', c.line, 'quote_posting_id', c.posting,
               'baseline', (SELECT jsonb_build_object('statute', b.statute, 'minimum', b.minimum, 'note', b.note,
                                                      'source_url', b.source_url, 'read_on', b.read_on,
                                                      'applies_in', b.applies_in,
                                                      'also', CASE WHEN b.also_statute IS NOT NULL AND b.also_source_url IS NOT NULL THEN
                                                                jsonb_build_object('statute', b.also_statute, 'applies_in', b.also_applies_in,
                                                                                   'source_url', b.also_source_url) END)
                              FROM public.perk_legal_baselines b
                             WHERE b.country = c.country AND b.perk = c.perk
                               AND NOT (c.perk = 'pto' AND c.pto_days IS NOT NULL AND b.minimum_days IS NOT NULL
                                        AND c.pto_days > CASE WHEN c.pto_plus_holidays
                                                              THEN COALESCE(b.minimum_days_plus_holidays, b.minimum_days)
                                                              ELSE b.minimum_days END)))
               ORDER BY c.country, c.perk) FROM claims c), '[]'::jsonb),
    'withheld', COALESCE((SELECT jsonb_agg(jsonb_build_object('source', w.source, 'reason', w.reason, 'share', w.share)
                                           ORDER BY w.source, w.reason) FROM withheld w), '[]'::jsonb)
  )
$$;


COMMENT ON FUNCTION public.get_employer_perks(text) IS
  'One board''s published perk rows: k of n readable postings per country, the quoted line and the still-serving posting it came '
  'from, the statutory baseline where one exists. Only keys published, audited in the last 45 days on a recorded extractor '
  'version, with the publish pause off, and only claim rows read by that version (20261102164000); thresholds n >= 5, k >= 2, '
  'k/n >= 10% re-checked, and k >= 3 for a stated visa limit; English postings only; nothing on a token two vendors share, a '
  'franchise or agency board, or a vendor whose benefits text is not stored (withheld lists why). published_keys names the keys '
  'live right now; with none live, withheld is empty and collision false. A leave row''s statutory note is dropped when the '
  'quoted line states more days than the minimum. anon and authenticated may call it.';

-- ── 5. grants: revoke first, then give back exactly what is needed ──────

REVOKE ALL ON FUNCTION public.employer_perk_rollup_tick(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.employer_perk_audit_draw(text, smallint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.employer_perk_audit_record(text, text, integer, integer, bigint, smallint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.employer_perk_audit_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_employer_perks(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.employer_perk_rollup_tick(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.employer_perk_audit_draw(text, smallint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.employer_perk_audit_record(text, text, integer, integer, bigint, smallint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.employer_perk_audit_status() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_employer_perks(text) TO anon, authenticated, service_role;

-- Every overload of every writer this file touches, whatever a later hand adds: closed too.
DO $close$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('employer_perk_rollup_tick', 'employer_perk_audit_draw', 'employer_perk_audit_record', 'employer_perk_audit_status')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$close$;

-- ── 6. the self-check ─────────────────────────────────────────────────────

DO $check$
DECLARE
  v_role text;
  v_priv text;
  v_fn   text;
  v_bad  text[] := '{}';
  v_out  jsonb;
BEGIN
  -- The columns the reader and the rollup read.
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.employer_perk_rollups'::regclass
                    AND a.attname = 'extractor_version' AND NOT a.attisdropped) THEN
    v_bad := v_bad || 'employer_perk_rollups has no extractor_version'::text;
  END IF;
  IF (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.employer_profile_perk_publish'::regclass
         AND a.attname IN ('audited_version', 'audit_draw_id', 'audit_drawn_at') AND NOT a.attisdropped) <> 3 THEN
    v_bad := v_bad || 'employer_profile_perk_publish lacks audited_version, audit_draw_id or audit_drawn_at'::text;
  END IF;

  -- The draws table: RLS on, no policy, nothing for a client role, the sequence closed.
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.employer_perk_audit_draws'::regclass) THEN
    v_bad := v_bad || 'employer_perk_audit_draws has row level security off'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = 'public.employer_perk_audit_draws'::regclass) THEN
    v_bad := v_bad || 'employer_perk_audit_draws carries a policy'::text;
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
      IF has_table_privilege(v_role, 'public.employer_perk_audit_draws', v_priv) THEN
        v_bad := v_bad || format('%s holds %s on employer_perk_audit_draws', v_role, v_priv);
      END IF;
    END LOOP;
    IF has_sequence_privilege(v_role, 'public.employer_perk_audit_draws_id_seq', 'USAGE') THEN
      v_bad := v_bad || format('%s may use employer_perk_audit_draws_id_seq', v_role);
    END IF;
  END LOOP;

  -- One draw and one record, each the versioned signature, each service-role only; the tick and the status too.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname = 'public' AND p.proname IN ('employer_perk_audit_draw', 'employer_perk_audit_record')) <> 2 THEN
    v_bad := v_bad || 'an unversioned overload of the audit draw or record survives'::text;
  END IF;
  FOREACH v_fn IN ARRAY ARRAY['public.employer_perk_audit_draw(text,smallint,integer)',
                              'public.employer_perk_audit_record(text,text,integer,integer,bigint,smallint,text)',
                              'public.employer_perk_rollup_tick(integer)', 'public.employer_perk_audit_status()'] LOOP
    IF to_regprocedure(v_fn) IS NULL THEN
      v_bad := v_bad || format('%s is missing', v_fn);
    ELSIF has_function_privilege('anon', to_regprocedure(v_fn), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(v_fn), 'EXECUTE')
       OR NOT has_function_privilege('service_role', to_regprocedure(v_fn), 'EXECUTE') THEN
      v_bad := v_bad || format('%s is not service-role only', v_fn);
    END IF;
  END LOOP;
  IF NOT has_function_privilege('anon', 'public.get_employer_perks(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_employer_perks(text)', 'EXECUTE') THEN
    v_bad := v_bad || 'get_employer_perks is not callable by anon and authenticated'::text;
  END IF;

  -- No key the old rule showed is left without a version (1b carried it or RAISEd).
  IF EXISTS (SELECT 1 FROM public.employer_profile_perk_publish pp
              WHERE pp.audited_version IS NULL AND pp.published
                AND pp.perk IN ('health', 'dental', 'vision', 'life_dis', 'retire', 'pto', 'parental', 'equity', 'visa_not_offered')
                AND pp.last_audited_at >= now() - interval '45 days'
                AND NOT COALESCE((SELECT c.publish_paused FROM public.employer_profile_config c WHERE c.id), true)) THEN
    v_bad := v_bad || 'a key live under 20261012110000 has no audited version'::text;
  END IF;

  -- The reader runs, and names no key live that carries no audited version.
  v_out := public.get_employer_perks('__20261102164000_self_check__');
  IF jsonb_typeof(v_out -> 'published_keys') IS DISTINCT FROM 'array' THEN
    v_bad := v_bad || format('get_employer_perks answered %s', left(v_out::text, 120));
  ELSIF EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_out -> 'published_keys') k
                  JOIN public.employer_profile_perk_publish pp ON pp.perk = k.value
                 WHERE pp.audited_version IS NULL) THEN
    v_bad := v_bad || 'the reader names a key live with no audited version'::text;
  END IF;

  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'perk audit version self-check failed: %', array_to_string(v_bad, '; ');
  END IF;
  RAISE NOTICE 'perk audit: rows carry their extractor version, every audit names a fresh draw of that version, the reader shows only the audited version';
END
$check$;
