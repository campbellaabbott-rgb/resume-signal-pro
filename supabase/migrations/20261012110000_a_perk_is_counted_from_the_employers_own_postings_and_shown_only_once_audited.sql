-- A PERK IS COUNTED FROM THE EMPLOYER'S OWN POSTINGS, AND SHOWN ONLY ONCE AUDITED.
--
-- Company profiles, phase 1 (plan 2026-10-11, sections 3, 5 and 6): the
-- storage, the rollup and the one reader behind "Perks stated in their job
-- postings". The employer-profiles edge function reads each serving posting
-- once with the frozen perk extractor (_shared/perks-extract.ts) and stores
-- what it found here; a nightly rollup turns the postings into claim rows,
-- one per board, country and perk; the reader hands a page only the rows
-- whose perk has passed its audit in the last 45 days.
--
-- EVERYTHING HERE IS PRIVATE. Supabase grants ALL on a new public table to
-- anon and authenticated, and a GRANT never takes anything away, so every
-- table below is revoked from PUBLIC, anon and authenticated by name, given
-- RLS with no policy, and granted back to service_role only. Every function
-- is revoked the same way first; the writers go to service_role, and only
-- the reader, get_employer_perks, goes back to anon and authenticated (the
-- census re-issued in 20261012110100 lists it with its caller).
--
-- WHAT IS STORED, AND WHY THAT SHAPE.
--   employer_perk_postings   one row per posting read: three int bitmasks
--                            (Y offered, Q hedged, N stated as not offered)
--                            in the bit order of employer_profile_perk_publish,
--                            one quoted-line hash per bit, the posting's
--                            country, whether its text was long enough to
--                            read, franchise wording, the board's agency
--                            flag, and the extractor version that read it.
--                            Ints and hashes, not jsonb: about a million rows.
--   employer_perk_lines      the quoted lines, once each, keyed by hash. A
--                            boilerplate block repeated on 160 postings is
--                            stored once.
--   employer_perk_rollups    the claim rows: k of n readable postings in one
--                            country state the perk. Written only when n >= 5,
--                            k >= 2 and k/n >= 10% (the CHECK holds it too).
--                            Franchise and agency postings count in neither
--                            k nor n, and a board whose readable postings
--                            carry franchise wording 30% of the time or more
--                            gets no rows at all, only a flag with its share.
--   employer_profile_perk_publish
--                            one row per key with its own publish flag and
--                            last audit, ALL UNPUBLISHED. Only the nine
--                            candidate keys can ever hold published = true
--                            (CHECK), and the reader reads a flag older than
--                            45 days since its last audit as unpublished, so
--                            the system fails closed when nobody re-audits.
--   perk_legal_baselines     statute only, each with its official source: UK
--                            automatic enrolment and 5.6 weeks' leave, German
--                            statutory leave and the right to a company pension
--                            by salary conversion. "This line may describe
--                            that minimum."
--   employer_profile_runs, employer_profile_config (the pause switches),
--   employer_profile_leases (one sweep at a time), employer_perk_sweep_boards
--   (boards in priority order), employer_perk_rollup_state (the nightly cursor).
--
-- NEVER A DESCRIPTION, A SALARY OR A SEARCH FIELD. Nothing here writes
-- job_board_postings; benefit amounts never reach the salary parser.
--
-- Self-verifying, safe to re-run: tables IF NOT EXISTS, functions OR REPLACE,
-- seeds ON CONFLICT DO NOTHING (a re-run never resets a publish flag).

SET LOCAL statement_timeout = '2min';

-- ── 1. per posting ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.employer_perk_postings (
  posting_id        text PRIMARY KEY,
  source            text NOT NULL,
  company_token     text NOT NULL,
  country           text,
  readable          boolean NOT NULL,
  franchise         boolean NOT NULL DEFAULT false,
  agency            boolean NOT NULL DEFAULT false,
  perks_y           integer NOT NULL DEFAULT 0,
  perks_q           integer NOT NULL DEFAULT 0,
  perks_n           integer NOT NULL DEFAULT 0,
  quote_line_hash   text[],
  extractor_version smallint NOT NULL,
  extracted_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employer_perk_postings_one_status_per_key
    CHECK (perks_y & perks_q = 0 AND perks_y & perks_n = 0 AND perks_q & perks_n = 0),
  CONSTRAINT employer_perk_postings_unread_states_nothing
    CHECK (readable OR (perks_y = 0 AND perks_q = 0 AND perks_n = 0))
);
CREATE INDEX IF NOT EXISTS employer_perk_postings_board_idx
  ON public.employer_perk_postings (company_token, source, country);

COMMENT ON TABLE public.employer_perk_postings IS
  'One row per serving posting the employer-profiles sweep read: Y/Q/N bitmasks in employer_profile_perk_publish bit order, '
  'one quoted-line hash per bit (employer_perk_lines), country, readable (description >= 200 chars), franchise wording, the '
  'board''s agency flag, extractor_version. Private: service_role only. Never a description, salary or search field.';

CREATE TABLE IF NOT EXISTS public.employer_perk_lines (
  line_hash     text PRIMARY KEY CHECK (line_hash ~ '^[0-9a-f]{16}$'),
  line          text NOT NULL CHECK (length(line) BETWEEN 1 AND 240),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.employer_perk_lines IS
  'The verbatim benefits lines a posting was read from, once each, keyed by the first 16 hex of their SHA-256. Private.';

-- ── 2. claim rows ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.employer_perk_rollups (
  source           text NOT NULL,
  company_token    text NOT NULL,
  country          text NOT NULL,
  perk             text NOT NULL,
  k                integer NOT NULL,
  n                integer NOT NULL,
  standard_text    boolean NOT NULL DEFAULT false,
  qualified_share  numeric(4,3) NOT NULL DEFAULT 0,
  quote_hash       text,
  quote_posting_id text,
  as_of            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_token, source, country, perk),
  CONSTRAINT employer_perk_rollups_thresholds CHECK (n >= 5 AND k >= 2 AND k * 10 >= n AND k <= n)
);
CREATE INDEX IF NOT EXISTS employer_perk_rollups_perk_idx ON public.employer_perk_rollups (perk);
COMMENT ON TABLE public.employer_perk_rollups IS
  'Claim rows: k of n readable, non-franchise, non-agency serving postings in one country state the perk (n >= 5, k >= 2, '
  'k/n >= 10%). standard_text: at least 80% of the k carry the identical quoted line. qualified_share: hedged (Q) share of k. '
  'quote_hash/quote_posting_id: the modal line and one posting carrying it. Private; the reader filters it through the publish table.';

CREATE TABLE IF NOT EXISTS public.employer_perk_board_flags (
  source        text NOT NULL,
  company_token text NOT NULL,
  flag          text NOT NULL CHECK (flag IN ('franchise', 'agency')),
  share         numeric(4,3) NOT NULL,
  postings      integer NOT NULL,
  as_of         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_token, source, flag)
);
COMMENT ON TABLE public.employer_perk_board_flags IS
  'Boards whose perks are hidden with the reason printed: franchise wording on >= 30% of readable postings, or an agency board. Private.';

-- ── 3. the publish table: every key, all unpublished ──────────────────────

CREATE TABLE IF NOT EXISTS public.employer_profile_perk_publish (
  perk            text PRIMARY KEY,
  bit             smallint NOT NULL CHECK (bit BETWEEN 0 AND 30),
  counts          text NOT NULL CHECK (counts IN ('positive', 'negation')),
  published       boolean NOT NULL DEFAULT false,
  last_audited_at timestamptz,
  audit_mode      text CHECK (audit_mode IN ('launch', 'reaudit', 'withdraw')),
  audit_judged    integer,
  audit_correct   integer,
  audit_note      text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employer_profile_perk_publish_only_candidates CHECK (NOT published OR perk IN ('health', 'dental', 'vision', 'life_dis', 'retire', 'pto', 'parental', 'equity', 'visa_not_offered')),
  CONSTRAINT employer_profile_perk_publish_audited CHECK (NOT published OR last_audited_at IS NOT NULL),
  CONSTRAINT employer_profile_perk_publish_judged CHECK (audit_correct IS NULL OR (audit_judged IS NOT NULL AND audit_correct BETWEEN 0 AND audit_judged)),
  CONSTRAINT employer_profile_perk_publish_one_key_per_mask UNIQUE (bit, counts)
);
COMMENT ON TABLE public.employer_profile_perk_publish IS
  'One row per perk key: its bit in the stored masks, which mask counts it, and its publish flag. Only the nine candidate keys can '
  'be published (CHECK); flex, mental, childcare, discount, commute, meals, bonus, learning, generic and positive visa offers never. '
  'get_employer_perks reads a flag whose last_audited_at is older than 45 days as unpublished. Created all unpublished.';

INSERT INTO public.employer_profile_perk_publish (perk, bit, counts) VALUES
  ('health', 0, 'positive'),
  ('dental', 1, 'positive'),
  ('vision', 2, 'positive'),
  ('life_dis', 3, 'positive'),
  ('retire', 4, 'positive'),
  ('pto', 5, 'positive'),
  ('parental', 6, 'positive'),
  ('flex', 7, 'positive'),
  ('learning', 8, 'positive'),
  ('equity', 9, 'positive'),
  ('bonus', 10, 'positive'),
  ('wellness', 11, 'positive'),
  ('mental', 12, 'positive'),
  ('childcare', 13, 'positive'),
  ('relocation', 14, 'positive'),
  ('visa', 15, 'positive'),
  ('meals', 16, 'positive'),
  ('commute', 17, 'positive'),
  ('discount', 18, 'positive'),
  ('sabbatical', 19, 'positive'),
  ('fourday', 20, 'positive'),
  ('generic', 21, 'positive'),
  ('visa_not_offered', 15, 'negation')
ON CONFLICT (perk) DO NOTHING;

-- ── 4. statute, with its source ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.perk_legal_baselines (
  country    text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  perk       text NOT NULL,
  statute    text NOT NULL,
  minimum    text NOT NULL,
  note       text NOT NULL,
  source_url text NOT NULL CHECK (source_url ~ '^https://www\.(legislation\.gov\.uk|gesetze-im-internet\.de)/'),
  read_on    date NOT NULL,
  PRIMARY KEY (country, perk)
);
COMMENT ON TABLE public.perk_legal_baselines IS
  'Statutory minimums a perk line may only restate, each with its official source and the date it was read. Statute only: '
  'no US federal paid leave exists to cite, Swedish and Dutch pensions come from agreements, so v1 holds UK and DE alone.';

INSERT INTO public.perk_legal_baselines (country, perk, statute, minimum, note, source_url, read_on) VALUES
  ('GB', 'retire', 'Pensions Act 2008, Part 1, Chapter 1 (automatic enrolment)',
   'An employer must enrol each eligible jobholder in a qualifying workplace pension scheme and pay into it.',
   'This line may describe that minimum.', 'https://www.legislation.gov.uk/ukpga/2008/30/part/1/chapter/1', DATE '2026-10-10'),
  ('GB', 'pto', 'Working Time Regulations 1998, regulations 13 and 13A',
   '5.6 weeks of paid annual leave a year, capped at 28 days; bank holidays may count towards it.',
   'This line may describe that minimum.', 'https://www.legislation.gov.uk/uksi/1998/1833/regulation/13A', DATE '2026-10-10'),
  ('DE', 'pto', 'Bundesurlaubsgesetz (BUrlG) § 3',
   'At least 24 working days of paid leave a year counted on a six-day week, which is 20 days on a five-day week.',
   'This line may describe that minimum.', 'https://www.gesetze-im-internet.de/burlg/__3.html', DATE '2026-10-10'),
  ('DE', 'retire', 'Betriebsrentengesetz (BetrAVG) § 1a',
   'An employee may require up to 4% of the pension insurance contribution ceiling to be paid into a company pension by salary conversion (Entgeltumwandlung).',
   'This line may describe that minimum.', 'https://www.gesetze-im-internet.de/betravg/__1a.html', DATE '2026-10-10')
ON CONFLICT (country, perk) DO NOTHING;

-- ── 5. the machinery: runs, config, lease, queue, rollup cursor ───────────

CREATE TABLE IF NOT EXISTS public.employer_profile_runs (
  id               bigserial PRIMARY KEY,
  kind             text NOT NULL CHECK (kind IN ('sweep', 'rollup', 'audit')),
  build            text,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  ok               boolean,
  boards           integer,
  postings_read    integer,
  postings_written integer,
  lines_written    integer,
  extract_ms       numeric,
  note             text
);
CREATE INDEX IF NOT EXISTS employer_profile_runs_kind_idx ON public.employer_profile_runs (kind, started_at DESC);

CREATE TABLE IF NOT EXISTS public.employer_profile_config (
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  sweep_paused       boolean NOT NULL DEFAULT false,
  publish_paused     boolean NOT NULL DEFAULT false,
  sweep_batch        integer NOT NULL DEFAULT 300 CHECK (sweep_batch BETWEEN 25 AND 2000),
  sweep_wall_ms      integer NOT NULL DEFAULT 20000 CHECK (sweep_wall_ms BETWEEN 2000 AND 50000),
  rollup_chunk       integer NOT NULL DEFAULT 50000 CHECK (rollup_chunk BETWEEN 1000 AND 200000),
  suppressed_sources text[] NOT NULL DEFAULT ARRAY['lever', 'oracle', 'pinpoint', 'usajobs'],
  note               text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.employer_profile_config IS
  'One row. sweep_paused stops the sweep between batches; publish_paused hides every perk (a pooled re-audit under 57 of 60). '
  'suppressed_sources: vendors whose benefits text our ingest drops (Lever lists, Oracle organisation text, the Pinpoint benefits '
  'field) or never stores (USAJOBS); their rows are counted but never shown, with the reason, until job-board stores the text.';
INSERT INTO public.employer_profile_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.employer_profile_leases (
  name       text PRIMARY KEY,
  holder     text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS public.employer_perk_sweep_boards (
  company_token text PRIMARY KEY,
  open_roles    integer NOT NULL DEFAULT 0,
  queued_at     timestamptz NOT NULL DEFAULT now(),
  swept_at      timestamptz,
  swept_version smallint,
  cursor_id     text
);
CREATE INDEX IF NOT EXISTS employer_perk_sweep_boards_order_idx
  ON public.employer_perk_sweep_boards (open_roles DESC, company_token);

CREATE TABLE IF NOT EXISTS public.employer_perk_rollup_state (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  lap_started_at  timestamptz,
  lap_cursor      text,
  lap_finished_at timestamptz,
  chunks          integer NOT NULL DEFAULT 0,
  boards          integer NOT NULL DEFAULT 0,
  rows_written    integer NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.employer_perk_rollup_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ── 6. every table private ────────────────────────────────────────────────

ALTER TABLE public.employer_perk_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_perk_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_perk_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_perk_board_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_profile_perk_publish ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perk_legal_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_profile_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_profile_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_profile_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_perk_sweep_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_perk_rollup_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.employer_perk_postings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.employer_perk_lines FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.employer_perk_rollups FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.employer_perk_board_flags FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.employer_profile_perk_publish FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.perk_legal_baselines FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.employer_profile_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.employer_profile_config FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.employer_profile_leases FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.employer_perk_sweep_boards FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.employer_perk_rollup_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.employer_profile_runs_id_seq FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.employer_perk_postings TO service_role;
GRANT ALL ON TABLE public.employer_perk_lines TO service_role;
GRANT ALL ON TABLE public.employer_perk_rollups TO service_role;
GRANT ALL ON TABLE public.employer_perk_board_flags TO service_role;
GRANT ALL ON TABLE public.employer_profile_perk_publish TO service_role;
GRANT ALL ON TABLE public.perk_legal_baselines TO service_role;
GRANT ALL ON TABLE public.employer_profile_runs TO service_role;
GRANT ALL ON TABLE public.employer_profile_config TO service_role;
GRANT ALL ON TABLE public.employer_profile_leases TO service_role;
GRANT ALL ON TABLE public.employer_perk_sweep_boards TO service_role;
GRANT ALL ON TABLE public.employer_perk_rollup_state TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.employer_profile_runs_id_seq TO service_role;

-- ── 7. the lease: one sweep at a time ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.employer_profile_lease_take(p_name text, p_holder text, p_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  v_got text;
BEGIN
  IF p_name IS NULL OR p_holder IS NULL OR length(p_holder) < 8 THEN
    RETURN false;
  END IF;
  INSERT INTO public.employer_profile_leases AS l (name, holder, expires_at)
  VALUES (p_name, p_holder, clock_timestamp() + make_interval(secs => LEAST(GREATEST(COALESCE(p_seconds, 90), 5), 600)))
  ON CONFLICT (name) DO UPDATE
    SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
    WHERE l.expires_at < clock_timestamp() OR l.holder = EXCLUDED.holder
  RETURNING l.holder INTO v_got;
  RETURN v_got IS NOT NULL AND v_got = p_holder;
END;
$$;

CREATE OR REPLACE FUNCTION public.employer_profile_lease_release(p_name text, p_holder text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.employer_profile_leases WHERE name = p_name AND holder = p_holder;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;

-- ── 8. the sweep's two halves: take postings, store what they say ─────────
--
-- employer_perk_sweep_take walks the queue in priority order (open roles
-- descending) and returns up to p_limit serving postings that have no row
-- under this extractor version, or whose text arrived after an unreadable
-- read. A board with nothing pending is marked swept here and the walk moves
-- on, so a call is never spent on finished boards. The queue is refilled
-- from the newest daily company snapshot when it is more than 20 hours old,
-- which puts every board back in line once a day for its new postings.

CREATE OR REPLACE FUNCTION public.employer_perk_sweep_take(p_limit integer, p_version smallint, p_budget_ms integer DEFAULT 3000)
RETURNS TABLE (company_token text, posting_id text, source text, country text, agency boolean, title text, body text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
DECLARE
  v_deadline timestamptz := clock_timestamp() + make_interval(secs => LEAST(GREATEST(COALESCE(p_budget_ms, 3000), 200), 10000) / 1000.0);
  v_left integer := LEAST(GREATEST(COALESCE(p_limit, 0), 0), 2000);
  v_snap date;
  v_got integer;
  b record;
BEGIN
  IF v_left = 0 OR p_version IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.employer_perk_sweep_boards q WHERE q.queued_at > now() - interval '20 hours') THEN
    SELECT max(s.snapshot_date) INTO v_snap FROM public.job_board_company_snapshots s;
    IF v_snap IS NOT NULL THEN
      INSERT INTO public.employer_perk_sweep_boards AS q (company_token, open_roles, queued_at)
      SELECT s.company_token, s.open_roles_served, now()
        FROM public.job_board_company_snapshots s
       WHERE s.snapshot_date = v_snap AND COALESCE(s.open_roles_served, 0) > 0
      ON CONFLICT ON CONSTRAINT employer_perk_sweep_boards_pkey DO UPDATE
        SET open_roles = EXCLUDED.open_roles, queued_at = EXCLUDED.queued_at;
      DELETE FROM public.employer_perk_sweep_boards q
       WHERE NOT EXISTS (SELECT 1 FROM public.job_board_company_snapshots s
                          WHERE s.snapshot_date = v_snap AND s.company_token = q.company_token
                            AND COALESCE(s.open_roles_served, 0) > 0);
    END IF;
  END IF;

  FOR b IN
    SELECT q.company_token AS token, q.cursor_id
      FROM public.employer_perk_sweep_boards q
     WHERE q.swept_version IS DISTINCT FROM p_version OR q.swept_at IS NULL OR q.swept_at < q.queued_at
     ORDER BY q.open_roles DESC, q.company_token
     LIMIT 500
  LOOP
    EXIT WHEN v_left <= 0 OR clock_timestamp() > v_deadline;
    RETURN QUERY
      SELECT p.company_token, p.id, p.source, p.country, p.agency, p.title, p.description
        FROM public.job_board_postings p
        LEFT JOIN public.employer_perk_postings e ON e.posting_id = p.id
       WHERE p.company_token = b.token
         AND p.missing_since IS NULL
         AND p.effective_posted >= now() - interval '30 days'
         AND p.source <> 'usajobs'
         AND (b.cursor_id IS NULL OR p.id > b.cursor_id)
         AND (e.posting_id IS NULL
              OR e.extractor_version < p_version
              OR (NOT e.readable AND p.description IS NOT NULL AND octet_length(p.description) >= 200))
       ORDER BY p.id
       LIMIT v_left;
    GET DIAGNOSTICS v_got = ROW_COUNT;
    IF v_got = 0 THEN
      UPDATE public.employer_perk_sweep_boards q
         SET swept_at = now(), swept_version = p_version, cursor_id = NULL
       WHERE q.company_token = b.token;
    END IF;
    v_left := v_left - v_got;
  END LOOP;
END;
$$;

-- employer_perk_store writes one board's batch in one transaction: the
-- posting rows (every row must belong to p_token and carry p_version), the
-- quoted lines (once each), and the board's place in the queue -- swept when
-- p_done, else the cursor after the last posting stored. A malformed row is
-- refused and counted, never stored.

CREATE OR REPLACE FUNCTION public.employer_perk_store(p_token text, p_rows jsonb, p_lines jsonb, p_cursor text, p_done boolean, p_version smallint)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '20s'
AS $$
DECLARE
  v_rows integer := 0;
  v_lines integer := 0;
  v_given integer := 0;
BEGIN
  IF p_token IS NULL OR p_version IS NULL THEN
    RAISE EXCEPTION 'employer_perk_store needs a board and an extractor version' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NOT NULL AND jsonb_typeof(p_rows) = 'array' THEN
    v_given := jsonb_array_length(p_rows);
  END IF;

  IF p_lines IS NOT NULL AND jsonb_typeof(p_lines) = 'array' THEN
    INSERT INTO public.employer_perk_lines AS l (line_hash, line)
    SELECT DISTINCT ON (x.value ->> 'h') x.value ->> 'h', x.value ->> 'line'
      FROM jsonb_array_elements(p_lines) AS x(value)
     WHERE jsonb_typeof(x.value) = 'object'
       AND (x.value ->> 'h') ~ '^[0-9a-f]{16}$'
       AND length(COALESCE(x.value ->> 'line', '')) BETWEEN 1 AND 240
    ON CONFLICT (line_hash) DO UPDATE
      SET last_seen_at = now()
      WHERE l.last_seen_at < now() - interval '1 day';
    GET DIAGNOSTICS v_lines = ROW_COUNT;
  END IF;

  IF v_given > 0 THEN
    -- Every cast sits behind its own shape test (CASE), so one malformed
    -- value refuses its row instead of failing the batch.
    WITH shaped AS (
      SELECT x.value ->> 'posting_id' AS posting_id,
             x.value ->> 'company_token' AS token,
             x.value ->> 'source' AS source,
             NULLIF(x.value ->> 'country', '') AS country,
             jsonb_typeof(x.value -> 'readable') = 'boolean' AS readable_given,
             COALESCE((x.value -> 'readable') = 'true'::jsonb, false) AS readable,
             COALESCE((x.value -> 'franchise') = 'true'::jsonb, false) AS franchise,
             COALESCE((x.value -> 'agency') = 'true'::jsonb, false) AS agency,
             CASE WHEN (x.value ->> 'extractor_version') ~ '^[0-9]{1,4}$' THEN (x.value ->> 'extractor_version')::integer END AS version,
             CASE WHEN (x.value ->> 'y') ~ '^[0-9]{1,10}$' THEN (x.value ->> 'y')::bigint END AS y,
             CASE WHEN (x.value ->> 'q') ~ '^[0-9]{1,10}$' THEN (x.value ->> 'q')::bigint END AS q,
             CASE WHEN (x.value ->> 'n') ~ '^[0-9]{1,10}$' THEN (x.value ->> 'n')::bigint END AS n,
             CASE WHEN jsonb_typeof(x.value -> 'quote_line_hash') = 'array' THEN
               ARRAY(SELECT CASE WHEN h.value ~ '^[0-9a-f]{16}$' THEN h.value END
                       FROM jsonb_array_elements_text(x.value -> 'quote_line_hash') WITH ORDINALITY AS h(value, ord)
                      ORDER BY h.ord)
             END AS hashes
        FROM jsonb_array_elements(p_rows) AS x(value)
       WHERE jsonb_typeof(x.value) = 'object'
    )
    INSERT INTO public.employer_perk_postings AS e
      (posting_id, source, company_token, country, readable, franchise, agency, perks_y, perks_q, perks_n, quote_line_hash, extractor_version, extracted_at)
    SELECT DISTINCT ON (s.posting_id)
           s.posting_id, s.source, p_token, s.country, s.readable, s.franchise, s.agency,
           s.y::integer, s.q::integer, s.n::integer,
           CASE WHEN s.readable THEN s.hashes[1:31] END, p_version, now()
      FROM shaped s
     WHERE COALESCE(s.posting_id, '') <> ''
       AND s.token = p_token
       AND COALESCE(s.source, '') <> ''
       AND s.readable_given
       AND s.version = p_version
       AND s.y IS NOT NULL AND s.q IS NOT NULL AND s.n IS NOT NULL
       AND s.y < 2147483648 AND s.q < 2147483648 AND s.n < 2147483648
       AND (s.y & s.q) = 0 AND (s.y & s.n) = 0 AND (s.q & s.n) = 0
       AND (s.readable OR (s.y = 0 AND s.q = 0 AND s.n = 0))
    ON CONFLICT (posting_id) DO UPDATE
      SET source = EXCLUDED.source, company_token = EXCLUDED.company_token, country = EXCLUDED.country,
          readable = EXCLUDED.readable, franchise = EXCLUDED.franchise, agency = EXCLUDED.agency,
          perks_y = EXCLUDED.perks_y, perks_q = EXCLUDED.perks_q, perks_n = EXCLUDED.perks_n,
          quote_line_hash = EXCLUDED.quote_line_hash, extractor_version = EXCLUDED.extractor_version,
          extracted_at = EXCLUDED.extracted_at;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  END IF;

  IF p_done THEN
    UPDATE public.employer_perk_sweep_boards q
       SET swept_at = now(), swept_version = p_version, cursor_id = NULL
     WHERE q.company_token = p_token;
  ELSIF p_cursor IS NOT NULL THEN
    UPDATE public.employer_perk_sweep_boards q
       SET cursor_id = p_cursor
     WHERE q.company_token = p_token;
  END IF;

  RETURN jsonb_build_object('stored', v_rows, 'refused', v_given - v_rows, 'lines', v_lines);
END;
$$;

-- ── 9. the nightly rollup, in 50k keyset chunks, under a time budget ──────
--
-- One tick reads perk rows in company_token order from the persisted cursor,
-- 50,000 at a time (the last board of a window is taken whole), and for the
-- boards in the window: prunes rows whose posting left the serving set,
-- writes the franchise and agency flags, then the claim rows. It stops at
-- its budget (90 s from the cron) between chunks, well inside the cron's
-- own 110 s statement_timeout, so a tick is never cancelled mid-write and
-- the cursor always moves. A lap that finished today waits for tomorrow; the
-- end of a lap clears claim rows for boards with no perk rows left and lines
-- nobody has quoted in 45 days.

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
BEGIN
  INSERT INTO public.employer_perk_rollup_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
  SELECT s.lap_cursor, s.lap_started_at, s.lap_finished_at INTO v_cursor, v_lap_started, v_lap_finished
    FROM public.employer_perk_rollup_state s WHERE s.id FOR UPDATE;

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
      SELECT e.posting_id, e.source, e.company_token, e.country, e.perks_y, e.perks_q, e.perks_n, e.quote_line_hash
        FROM public.employer_perk_postings e
       WHERE e.company_token = ANY (v_tokens)
         AND e.readable AND NOT e.franchise AND NOT e.agency
         AND e.country IS NOT NULL AND e.country <> ''
         AND NOT EXISTS (SELECT 1 FROM public.employer_perk_board_flags f
                          WHERE f.company_token = e.company_token AND f.source = e.source)
    ),
    grp AS (
      SELECT b.source, b.company_token, b.country, count(*)::integer AS n
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
      (source, company_token, country, perk, k, n, standard_text, qualified_share, quote_hash, quote_posting_id, as_of)
    SELECT a.source, a.company_token, a.country, a.perk, a.k, g.n,
           COALESCE(m.cnt * 5 >= a.k * 4, false),
           round(a.q::numeric / a.k, 3),
           m.qh, m.pid, now()
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
  END LOOP;

  UPDATE public.employer_perk_rollup_state s
     SET lap_cursor = v_cursor, lap_started_at = v_lap_started, lap_finished_at = v_lap_finished,
         chunks = s.chunks + v_chunks, boards = s.boards + v_boards, rows_written = s.rows_written + v_rows,
         updated_at = now()
   WHERE s.id;
  INSERT INTO public.employer_profile_runs (kind, started_at, finished_at, ok, boards, postings_written, note)
  VALUES ('rollup', v_started, clock_timestamp(), true, v_boards, v_rows,
          format('state=%s chunks=%s pruned=%s cursor=%s', v_state, v_chunks, v_pruned, COALESCE(v_cursor, '(lap done)')));
  RETURN jsonb_build_object('ok', true, 'state', v_state, 'chunks', v_chunks, 'boards', v_boards, 'rows', v_rows,
                            'pruned', v_pruned, 'cursor', v_cursor, 'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000));
END;
$$;

-- ── 10. the owner's audit path (service_role; employer-profiles asks with the admin key) ──

-- 60 random publishable rows of one candidate key, each with its quote, the
-- posting it came from, and a spot check of 3 random postings among its k.
CREATE OR REPLACE FUNCTION public.employer_perk_audit_draw(p_perk text, p_rows integer DEFAULT 60)
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
BEGIN
  SELECT pp.perk, pp.bit, pp.counts INTO k FROM public.employer_profile_perk_publish pp WHERE pp.perk = p_perk;
  IF k.perk IS NULL OR p_perk NOT IN ('health', 'dental', 'vision', 'life_dis', 'retire', 'pto', 'parental', 'equity', 'visa_not_offered') THEN
    RAISE EXCEPTION 'not a candidate key: %', p_perk USING ERRCODE = '22023';
  END IF;
  WITH pick AS (
    SELECT r.* FROM public.employer_perk_rollups r
     WHERE r.perk = k.perk
       AND NOT (r.source = ANY (v_skip))
       AND NOT EXISTS (SELECT 1 FROM public.employer_perk_board_flags f WHERE f.company_token = r.company_token AND f.source = r.source)
       AND NOT EXISTS (SELECT 1 FROM public.employer_perk_postings e2 WHERE e2.company_token = r.company_token AND e2.source <> r.source)
       AND (r.perk <> 'visa_not_offered' OR r.k >= 3)
     ORDER BY random()
     LIMIT LEAST(GREATEST(COALESCE(p_rows, 60), 1), 200)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'source', pk.source, 'company_token', pk.company_token, 'country', pk.country, 'perk', pk.perk,
           'k', pk.k, 'n', pk.n, 'qualified_share', pk.qualified_share, 'standard_text', pk.standard_text, 'as_of', pk.as_of,
           'employer', jp.company, 'quote', l.line, 'quote_posting_id', pk.quote_posting_id,
           'quote_title', jp.title, 'quote_link', jp.apply_url,
           'spot_check', (
             SELECT COALESCE(jsonb_agg(jsonb_build_object('posting_id', s.posting_id, 'title', s.title, 'link', s.apply_url, 'quote', s.line)), '[]'::jsonb)
               FROM (SELECT e.posting_id, p2.title, p2.apply_url, l2.line
                       FROM public.employer_perk_postings e
                       JOIN public.job_board_postings p2 ON p2.id = e.posting_id
                       LEFT JOIN public.employer_perk_lines l2 ON l2.line_hash = e.quote_line_hash[k.bit + 1]
                      WHERE e.company_token = pk.company_token AND e.source = pk.source AND e.country = pk.country
                        AND e.readable AND NOT e.franchise AND NOT e.agency
                        AND CASE WHEN k.counts = 'negation' THEN ((e.perks_n >> k.bit) & 1) = 1
                                 ELSE (((e.perks_y | e.perks_q) >> k.bit) & 1) = 1 END
                      ORDER BY random()
                      LIMIT 3) s)
         )), '[]'::jsonb)
    INTO v_out
    FROM pick pk
    LEFT JOIN public.employer_perk_lines l ON l.line_hash = pk.quote_hash
    LEFT JOIN public.job_board_postings jp ON jp.id = pk.quote_posting_id;
  INSERT INTO public.employer_profile_runs (kind, finished_at, ok, postings_read, note)
  VALUES ('audit', now(), true, jsonb_array_length(v_out), format('draw perk=%s rows=%s', k.perk, jsonb_array_length(v_out)));
  RETURN jsonb_build_object('perk', k.perk, 'drawn', jsonb_array_length(v_out), 'rows', v_out);
END;
$$;

-- A judgement, written back. launch: at least 60 judged and at most one in
-- twenty wrong (57 of 60) publishes the key, anything less unpublishes it.
-- reaudit: a stratum of at least 5; two or more wrong unpublishes the key,
-- otherwise a published key's 45 days start again (an unpublished key is
-- never published by a re-audit). withdraw: unpublished, any key.
CREATE OR REPLACE FUNCTION public.employer_perk_audit_record(p_perk text, p_mode text, p_judged integer, p_correct integer, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10s'
AS $$
DECLARE
  v_row public.employer_profile_perk_publish%ROWTYPE;
  v_wrong integer;
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
    v_wrong := p_judged - p_correct;
    IF p_mode = 'launch' THEN
      IF p_judged < 60 THEN
        RAISE EXCEPTION 'a launch audit judges at least 60 rows, not %', p_judged USING ERRCODE = '22023';
      END IF;
      UPDATE public.employer_profile_perk_publish pp
         SET published = (v_wrong * 20 <= p_judged), last_audited_at = now(), audit_mode = 'launch',
             audit_judged = p_judged, audit_correct = p_correct, audit_note = left(p_note, 500), updated_at = now()
       WHERE pp.perk = p_perk;
    ELSE
      IF p_judged < 5 THEN
        RAISE EXCEPTION 'a re-audit stratum judges at least 5 rows, not %', p_judged USING ERRCODE = '22023';
      END IF;
      UPDATE public.employer_profile_perk_publish pp
         SET published = pp.published AND v_wrong < 2,
             last_audited_at = CASE WHEN pp.published AND v_wrong < 2 THEN now() ELSE pp.last_audited_at END,
             audit_mode = 'reaudit', audit_judged = p_judged, audit_correct = p_correct,
             audit_note = left(p_note, 500), updated_at = now()
       WHERE pp.perk = p_perk;
    END IF;
  END IF;
  INSERT INTO public.employer_profile_runs (kind, finished_at, ok, postings_read, note)
  VALUES ('audit', now(), true, p_judged, format('record perk=%s mode=%s judged=%s correct=%s', p_perk, p_mode, p_judged, p_correct));
  SELECT * INTO v_row FROM public.employer_profile_perk_publish pp WHERE pp.perk = p_perk;
  RETURN to_jsonb(v_row);
END;
$$;

-- The two switches: the sweep's pause, and the publish pause a pooled
-- re-audit under 57 of 60 sets. Either may be left as it is (NULL).
CREATE OR REPLACE FUNCTION public.employer_profile_set_pause(p_sweep boolean DEFAULT NULL, p_publish boolean DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  v jsonb;
BEGIN
  INSERT INTO public.employer_profile_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
  UPDATE public.employer_profile_config c
     SET sweep_paused = COALESCE(p_sweep, c.sweep_paused),
         publish_paused = COALESCE(p_publish, c.publish_paused),
         note = COALESCE(left(p_note, 500), c.note),
         updated_at = now()
   WHERE c.id
  RETURNING jsonb_build_object('sweep_paused', c.sweep_paused, 'publish_paused', c.publish_paused, 'note', c.note) INTO v;
  RETURN v;
END;
$$;

-- What the owner needs to judge the engine: the keys and their audits, the
-- switches, the rollup lap, the queue, and the newest runs. No posting text.
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
               'perk', pp.perk, 'published', pp.published, 'last_audited_at', pp.last_audited_at,
               'expires_at', pp.last_audited_at + interval '45 days', 'audit_mode', pp.audit_mode,
               'audit_judged', pp.audit_judged, 'audit_correct', pp.audit_correct,
               'rows', (SELECT count(*) FROM public.employer_perk_rollups r WHERE r.perk = pp.perk)) ORDER BY pp.bit, pp.counts), '[]'::jsonb)
             FROM public.employer_profile_perk_publish pp),
    'config', (SELECT to_jsonb(c) FROM public.employer_profile_config c WHERE c.id),
    'rollup', (SELECT to_jsonb(s) FROM public.employer_perk_rollup_state s WHERE s.id),
    'queue', (SELECT jsonb_build_object('boards', count(*), 'pending', count(*) FILTER (WHERE q.swept_at IS NULL OR q.swept_at < q.queued_at),
                                        'queued_at', max(q.queued_at)) FROM public.employer_perk_sweep_boards q),
    'postings', (SELECT jsonb_build_object('rows', count(*), 'readable', count(*) FILTER (WHERE e.readable)) FROM public.employer_perk_postings e),
    'runs', (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id DESC), '[]'::jsonb)
               FROM (SELECT * FROM public.employer_profile_runs ORDER BY id DESC LIMIT 20) r)
  )
$$;

-- ── 11. the reader ─────────────────────────────────────────────────────────
--
-- A board's published claim rows and nothing else: a key shows only while
-- its flag is set, its last audit is under 45 days old and the publish pause
-- is off; the thresholds are checked again here; a token two vendors share
-- shows none (whose perks would they be?); a franchise or agency board, or a
-- vendor whose benefits text our ingest drops, shows none and says why. The
-- quoted posting is named only while it still serves. Never a description,
-- an apply link or a list of postings.
--
-- It also names the keys that are live right now (published_keys), so the
-- lander can tell "nothing has passed its audit yet", where it prints
-- nothing at all, from "perks are withheld on this board", where it prints
-- the reason. And a stated visa limit needs three postings saying it, not
-- two (plan section 4, "Stated limits"); the owner's draw holds the same
-- bar, so the audit judges only rows that can print.

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
    SELECT pp.perk
      FROM public.employer_profile_perk_publish pp, cfg
     WHERE NOT cfg.paused
       AND pp.published
       AND pp.perk IN ('health', 'dental', 'vision', 'life_dis', 'retire', 'pto', 'parental', 'equity', 'visa_not_offered')
       AND pp.last_audited_at IS NOT NULL
       AND pp.last_audited_at >= now() - interval '45 days'
  ),
  srcs AS (
    SELECT DISTINCT e.source FROM public.employer_perk_postings e WHERE e.company_token = p_token
    UNION
    SELECT DISTINCT r.source FROM public.employer_perk_rollups r WHERE r.company_token = p_token
  ),
  shared AS (SELECT count(*) > 1 AS collision FROM srcs),
  withheld AS (
    SELECT f.source, f.flag AS reason, f.share FROM public.employer_perk_board_flags f WHERE f.company_token = p_token
    UNION ALL
    SELECT s.source, 'vendor_text_not_stored', NULL::numeric FROM srcs s, cfg WHERE s.source = ANY (cfg.skip)
  ),
  claims AS (
    SELECT r.source, r.country, r.perk, r.k, r.n, r.qualified_share, r.standard_text, r.as_of, l.line,
           CASE WHEN EXISTS (SELECT 1 FROM public.job_board_postings p
                              WHERE p.id = r.quote_posting_id AND p.missing_since IS NULL
                                AND p.effective_posted >= now() - interval '30 days')
                THEN r.quote_posting_id END AS posting
      FROM public.employer_perk_rollups r
      JOIN live ON live.perk = r.perk
      JOIN public.employer_perk_lines l ON l.line_hash = r.quote_hash
     WHERE r.company_token = p_token
       AND NOT (SELECT collision FROM shared)
       AND NOT EXISTS (SELECT 1 FROM withheld w WHERE w.source = r.source)
       AND r.n >= 5 AND r.k >= 2 AND r.k * 10 >= r.n
       AND (r.perk <> 'visa_not_offered' OR r.k >= 3)
  )
  SELECT jsonb_build_object(
    'token', p_token,
    'collision', (SELECT collision FROM shared),
    'expiry_days', 45,
    'published_keys', COALESCE((SELECT jsonb_agg(lk.perk ORDER BY lk.perk) FROM live lk), '[]'::jsonb),
    'perks', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'source', c.source, 'country', c.country, 'perk', c.perk, 'k', c.k, 'n', c.n,
               'qualified_share', c.qualified_share, 'standard_text', c.standard_text, 'as_of', c.as_of,
               'quote', c.line, 'quote_posting_id', c.posting,
               'baseline', (SELECT jsonb_build_object('statute', b.statute, 'minimum', b.minimum, 'note', b.note,
                                                      'source_url', b.source_url, 'read_on', b.read_on)
                              FROM public.perk_legal_baselines b WHERE b.country = c.country AND b.perk = c.perk))
               ORDER BY c.country, c.perk) FROM claims c), '[]'::jsonb),
    'withheld', COALESCE((SELECT jsonb_agg(jsonb_build_object('source', w.source, 'reason', w.reason, 'share', w.share)
                                           ORDER BY w.source, w.reason) FROM withheld w), '[]'::jsonb)
  )
$$;

-- ── 12. grants: revoke first, then give back exactly what is needed ──────

REVOKE ALL ON FUNCTION public.employer_profile_lease_take(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.employer_profile_lease_release(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.employer_perk_sweep_take(integer, smallint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.employer_perk_store(text, jsonb, jsonb, text, boolean, smallint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.employer_perk_rollup_tick(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.employer_perk_audit_draw(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.employer_perk_audit_record(text, text, integer, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.employer_profile_set_pause(boolean, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.employer_perk_audit_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_employer_perks(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.employer_profile_lease_take(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.employer_profile_lease_release(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.employer_perk_sweep_take(integer, smallint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.employer_perk_store(text, jsonb, jsonb, text, boolean, smallint) TO service_role;
GRANT EXECUTE ON FUNCTION public.employer_perk_rollup_tick(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.employer_perk_audit_draw(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.employer_perk_audit_record(text, text, integer, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.employer_profile_set_pause(boolean, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.employer_perk_audit_status() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_employer_perks(text) TO anon, authenticated, service_role;

-- Every overload of every writer, whatever a later hand adds: closed too.
DO $close$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('employer_profile_lease_take', 'employer_profile_lease_release', 'employer_perk_sweep_take',
                         'employer_perk_store', 'employer_perk_rollup_tick', 'employer_perk_audit_draw',
                         'employer_perk_audit_record', 'employer_profile_set_pause', 'employer_perk_audit_status')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$close$;

COMMENT ON FUNCTION public.get_employer_perks(text) IS
  'One board''s published perk rows: k of n readable postings per country, the quoted line and the still-serving posting it came '
  'from, the statutory baseline where one exists. Only keys published, audited in the last 45 days, with the publish pause off; '
  'thresholds n >= 5, k >= 2, k/n >= 10% re-checked, and k >= 3 for a stated visa limit; nothing on a token two vendors share, '
  'a franchise or agency board, or a vendor whose benefits text is not stored (withheld lists why). published_keys names the '
  'keys live right now, so a page prints a withheld reason only when there is something to withhold. anon and authenticated may call it.';

-- ── 13. the self-check ─────────────────────────────────────────────────────

DO $check$
DECLARE
  v_tbl  text;
  v_role text;
  v_priv text;
  v_fn   text;
  v_bad  text[] := '{}';
  v_n    integer;
BEGIN
  -- Every table: RLS on, no policy, nothing for a client role.
  FOREACH v_tbl IN ARRAY ARRAY['public.employer_perk_postings', 'public.employer_perk_lines', 'public.employer_perk_rollups',
                               'public.employer_perk_board_flags', 'public.employer_profile_perk_publish', 'public.perk_legal_baselines',
                               'public.employer_profile_runs', 'public.employer_profile_config', 'public.employer_profile_leases',
                               'public.employer_perk_sweep_boards', 'public.employer_perk_rollup_state'] LOOP
    IF to_regclass(v_tbl) IS NULL THEN
      v_bad := v_bad || format('%s is missing', v_tbl);
      CONTINUE;
    END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_tbl)) THEN
      v_bad := v_bad || format('%s has row level security off', v_tbl);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = to_regclass(v_tbl)) THEN
      v_bad := v_bad || format('%s carries a policy', v_tbl);
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
        IF has_table_privilege(v_role, v_tbl, v_priv) THEN
          RAISE EXCEPTION 'self-check: % holds % on %', v_role, v_priv, v_tbl;
        END IF;
      END LOOP;
    END LOOP;
    IF NOT has_table_privilege('service_role', v_tbl, 'SELECT') THEN
      v_bad := v_bad || format('service_role cannot read %s', v_tbl);
    END IF;
  END LOOP;

  -- Every writer: the service role only.
  FOREACH v_fn IN ARRAY ARRAY['public.employer_profile_lease_take(text,text,integer)', 'public.employer_profile_lease_release(text,text)',
                              'public.employer_perk_sweep_take(integer,smallint,integer)',
                              'public.employer_perk_store(text,jsonb,jsonb,text,boolean,smallint)', 'public.employer_perk_rollup_tick(integer)',
                              'public.employer_perk_audit_draw(text,integer)', 'public.employer_perk_audit_record(text,text,integer,integer,text)',
                              'public.employer_profile_set_pause(boolean,boolean,text)', 'public.employer_perk_audit_status()'] LOOP
    IF to_regprocedure(v_fn) IS NULL THEN
      v_bad := v_bad || format('%s is missing', v_fn);
    ELSIF has_function_privilege('anon', to_regprocedure(v_fn), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(v_fn), 'EXECUTE')
       OR NOT has_function_privilege('service_role', to_regprocedure(v_fn), 'EXECUTE') THEN
      v_bad := v_bad || format('%s is not service-role only', v_fn);
    END IF;
  END LOOP;

  -- The reader: the publishable key and the signed-in role can call it.
  IF NOT has_function_privilege('anon', to_regprocedure('public.get_employer_perks(text)'), 'EXECUTE')
     OR NOT has_function_privilege('authenticated', to_regprocedure('public.get_employer_perks(text)'), 'EXECUTE') THEN
    v_bad := v_bad || 'get_employer_perks is not callable by anon and authenticated'::text;
  END IF;

  -- Every key present, in the bit order the sweep writes; no withheld key published.
  SELECT count(*) INTO v_n FROM public.employer_profile_perk_publish;
  IF v_n <> 23 THEN
    v_bad := v_bad || format('employer_profile_perk_publish holds %s keys, not 23', v_n);
  END IF;
  IF EXISTS (SELECT 1 FROM public.employer_profile_perk_publish pp
              WHERE pp.published AND pp.perk NOT IN ('health', 'dental', 'vision', 'life_dis', 'retire', 'pto', 'parental', 'equity', 'visa_not_offered')) THEN
    v_bad := v_bad || 'a withheld key is published'::text;
  END IF;
  IF (SELECT count(*) FROM public.perk_legal_baselines WHERE country IN ('GB', 'DE')) < 4 THEN
    v_bad := v_bad || 'the four statutory baselines are not all present'::text;
  END IF;

  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'perk engine self-check failed: %', array_to_string(v_bad, '; ');
  END IF;
  RAISE NOTICE 'perk engine: 11 private tables, 9 service-role writers, 1 client reader, every key unpublished until audited';
END
$check$;
