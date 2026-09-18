-- A FILING IS A FACT WITH TWO DATES AND A LINK.
--
-- The tables behind the layoff-filing line on job cards and the gated
-- "Roles at employers with a recent layoff filing" section of the Ghost Job
-- Index (SPEC 2026-09-18, section 3). Nothing in this file computes or
-- publishes anything; the functions arrive in the sibling migrations stamped
-- 20260918100100 through 20260918101000, one function per file.
--
-- WHAT A ROW IS. One layoff_filings row is one thing a public agency holds:
-- an SEC 8-K carrying Item 2.05 (source 'sec_8k_205') or a state WARN
-- notice (source 'state_warn'). The employer is stored AS THE SOURCE NAMES
-- IT (filer_raw) and every surface prints that string, never the tenant's
-- board name. Two dates on every row, each with its basis named: event_date
-- (the 8-K's date of report; the notice date a state prints, else the day it
-- became visible) and public_date (the day the SEC accepted it; the day the
-- state received, processed or posted it). source_read_at is OUR read and
-- is never a date basis for anything. Two CHECKs refuse a row dated after
-- the day we read it -- one future-dated notice exists in the consolidated
-- feed today and it must not become a row here.
--
-- WHAT NEVER LEAVES. RLS is on and no table here carries a SELECT policy;
-- anon and authenticated are revoked BY NAME on every table (a GRANT does not
-- restrict, and revoking PUBLIC alone leaves the grant anon holds directly).
-- A filing reaches a reader only through a SECURITY DEFINER function whose
-- predicate joins layoff_matches -- the table the matcher writes and only
-- the matcher writes -- so an unmatched filing is data for the curation
-- queue and for nothing else. layoff_filings and layoff_matches join the
-- closure ledgers inside the partition writer, so both belong on the locked-
-- table list and the column map that the definer and OUT-parameter guards
-- read; that is lane F's edit, named here so it is not forgotten.
--
-- THE ALIAS TABLE IS THE ONLY DOOR FOR A SHORT NAME. A single-token filer
-- ("Emerson", "Block", "Wise") reaches a board only through an accepted
-- alias row a person wrote after reading that tenant's own postings, and a
-- rejected row is a refusal the matcher honours forever. Both decisions are
-- rows with evidence, not comments, so the candidate script can read them
-- and never re-propose a pair someone already turned down.
--
-- THE MIRROR TABLE. The matcher compares filer names against a deploy-time
-- copy of the board's display names (layoff_board_names), written by the
-- deploy script from the imported catalogue, never read live. Its key is
-- (vendor, company_token) rather than company_token alone: 139 tokens in
-- today's catalogue of 44,519 boards are carried by two vendors at once
-- ('clear', 'echo', 'atlas', ...), and a single-column key would have made
-- the mirror refuse half of each pair at write time.
--
-- RETENTION is a rollup then a prune, never a bare DELETE (the closure log's
-- 20260727140000 shape): layoff_filing_rollup keeps the month's counts and
-- the prune in 20260918100900 deletes only rows whose month is provably in
-- it. supersedes_id is ON DELETE SET NULL so pruning an ancestor does not
-- raise on the amendment that still points at it; a match row goes with its
-- filing.
--
-- ANON PROBE PLAN (run by the owner after deploy, never from this repo):
-- with the publishable key, call the partition writer and expect the
-- permission-denied SQLSTATE beside a known-open control RPC in the same
-- batch; call the per-token reader with one seeded token and expect exactly
-- one row; select a REAL column of layoff_filings and of layoff_matches
-- through the REST endpoint and expect permission denied or an empty RLS
-- answer -- an undefined-column error is a probe of the wrong column, not a
-- proof of privacy, which is how the closure log read as locked for 35 days
-- while it was open.

SET LOCAL statement_timeout = '5min';

CREATE TABLE IF NOT EXISTS public.layoff_filings (
  filing_id          text PRIMARY KEY,
  source             text NOT NULL CHECK (source IN ('sec_8k_205', 'state_warn')),
  filer_raw          text NOT NULL,
  filer_norm         text NOT NULL,
  event_date         date NOT NULL,
  event_basis        text NOT NULL CHECK (event_basis IN ('sec_report_date', 'warn_notice_date', 'warn_received', 'warn_processed', 'warn_posted')),
  public_date        date NOT NULL,
  public_basis       text NOT NULL CHECK (public_basis IN ('sec_filed', 'state_received', 'state_processed', 'state_posted', 'our_first_fetch')),
  source_read_at     timestamptz NOT NULL,
  source_url         text NOT NULL CHECK (source_url ~ '^https://'),
  source_name        text NOT NULL,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'amended', 'superseded', 'rescinded', 'amendment')),
  supersedes_id      text REFERENCES public.layoff_filings(filing_id) ON DELETE SET NULL,
  -- SEC only
  cik                bigint,
  adsh               text,
  form               text CHECK (form IN ('8-K', '8-K/A')),
  amends_adsh        text,
  amend_unresolved   boolean NOT NULL DEFAULT false,
  section_text       text,
  excerpt            text,
  pct                numeric,
  headcount          int,
  headcount_basis    text CHECK (headcount_basis IN ('stated', 'derived_from_to')),
  timing_text        text,
  is_workforce_event boolean,
  parse_confidence   numeric,
  parser_version     text,
  -- WARN only
  state              char(2),
  feed               text,
  bln_hash_id        text,
  site_raw           text,
  site_city          text,
  site_county        text,
  workers            int,
  effective_date     date,
  effective_raw      text,
  event_type         text CHECK (event_type IN ('closure', 'layoff', 'relocation', 'unknown')),
  is_temporary       boolean,
  notice_pdf_url     text,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT layoff_filings_event_not_after_read  CHECK (event_date  <= source_read_at::date),
  CONSTRAINT layoff_filings_public_not_after_read CHECK (public_date <= source_read_at::date),
  CONSTRAINT layoff_filings_sec_columns  CHECK (source <> 'sec_8k_205' OR (cik IS NOT NULL AND adsh IS NOT NULL AND form IS NOT NULL AND section_text IS NOT NULL)),
  CONSTRAINT layoff_filings_amendment_is_never_an_event CHECK (source <> 'sec_8k_205' OR form <> '8-K/A' OR status = 'amendment'),
  CONSTRAINT layoff_filings_warn_columns CHECK (source <> 'state_warn' OR (state IS NOT NULL AND feed IS NOT NULL AND event_type IS NOT NULL)),
  CONSTRAINT layoff_filings_workers_never_zero CHECK (workers IS NULL OR workers > 0)
);
CREATE INDEX IF NOT EXISTS layoff_filings_filer_norm_idx ON public.layoff_filings (filer_norm);
CREATE INDEX IF NOT EXISTS layoff_filings_event_date_idx ON public.layoff_filings (event_date);
CREATE INDEX IF NOT EXISTS layoff_filings_cik_idx ON public.layoff_filings (cik) WHERE cik IS NOT NULL;

COMMENT ON TABLE public.layoff_filings IS
  'One row per public layoff filing: an SEC 8-K Item 2.05 (source sec_8k_205, keyed sec:<adsh>) '
  'or a state WARN notice (source state_warn, keyed warn:<dedupe key over our own normalisation>). '
  'filer_raw is the employer exactly as the source names it and is the only name any surface prints. '
  'event_date and public_date each carry a named basis; source_read_at is our read and dates nothing. '
  'An 8-K/A is status amendment and never an event of its own; a rescinded notice is status rescinded '
  'and never shown as a layoff. No SELECT policy: rows leave only through the definer readers, and '
  'only when a layoff_matches row joins them to a board.';

CREATE TABLE IF NOT EXISTS public.layoff_employer_aliases (
  alias_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alias_norm     text,
  cik            bigint,
  company_token  text NOT NULL,
  relation       text NOT NULL CHECK (relation IN ('filer', 'subsidiary_site')),
  state_scope    char(2)[],
  decision       text NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  evidence       text NOT NULL,
  decided_at     timestamptz NOT NULL DEFAULT now(),
  decided_by     text NOT NULL,
  CONSTRAINT layoff_employer_aliases_has_a_key CHECK (alias_norm IS NOT NULL OR cik IS NOT NULL),
  CONSTRAINT layoff_employer_aliases_key_is_real CHECK (alias_norm IS DISTINCT FROM '' AND cik IS DISTINCT FROM 0),
  CONSTRAINT layoff_employer_aliases_evidence_is_not_blank CHECK (length(btrim(evidence)) > 0)
);
-- One decision per (name, cik, token). A cik-keyed row carries no alias_norm
-- and a name-keyed row no cik, and a plain unique index treats every NULL as
-- distinct -- so the key is written over COALESCEd expressions (the empty
-- string and zero are values neither column can carry: the CHECK above
-- requires one real key and the seed never writes ''/0). That shape needs
-- no server feature newer than the rest of this repo; the seed's ON CONFLICT
-- names the same three expressions.
CREATE UNIQUE INDEX IF NOT EXISTS layoff_employer_aliases_one_decision_idx
  ON public.layoff_employer_aliases (COALESCE(alias_norm, ''), COALESCE(cik, 0::bigint), company_token);
CREATE INDEX IF NOT EXISTS layoff_employer_aliases_norm_idx ON public.layoff_employer_aliases (alias_norm) WHERE alias_norm IS NOT NULL;
CREATE INDEX IF NOT EXISTS layoff_employer_aliases_cik_idx ON public.layoff_employer_aliases (cik) WHERE cik IS NOT NULL;

COMMENT ON TABLE public.layoff_employer_aliases IS
  'Hand-curated joins from a filer to a board token: the ONLY path by which a single-token, '
  'ambiguous or CIK-keyed filer reaches a board. A WARN alias is keyed on alias_norm (optionally '
  'scoped to states); an SEC alias is keyed on cik, never on a ticker. decision rejected is a refusal '
  'the matcher honours and the candidate script never re-proposes. evidence names what was read: '
  'three posting titles, the tenant path, or the migration that already curated the pair.';

CREATE TABLE IF NOT EXISTS public.layoff_board_names (
  vendor         text NOT NULL,
  company_token  text NOT NULL,
  display_name   text NOT NULL,
  display_norm   text NOT NULL,
  mirrored_at    timestamptz NOT NULL,
  PRIMARY KEY (vendor, company_token)
);
CREATE INDEX IF NOT EXISTS layoff_board_names_display_norm_idx ON public.layoff_board_names (display_norm);

COMMENT ON TABLE public.layoff_board_names IS
  'Deploy-time mirror of the board catalogue''s display names, written by layoff_board_names_mirror '
  'from the imported catalogue so the matcher never reads live names. display_norm is layoff_norm '
  '(display_name). Keyed (vendor, company_token) because 139 catalogue tokens are carried by two '
  'vendors at once.';

CREATE TABLE IF NOT EXISTS public.layoff_matches (
  filing_id      text NOT NULL REFERENCES public.layoff_filings(filing_id) ON DELETE CASCADE,
  company_token  text NOT NULL,
  matched_via    text NOT NULL CHECK (matched_via IN ('exact_multitoken', 'alias')),
  matched_norm   text NOT NULL,
  alias_id       bigint REFERENCES public.layoff_employer_aliases(alias_id) ON DELETE CASCADE,
  relation       text NOT NULL CHECK (relation IN ('filer', 'subsidiary_site')),
  matched_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (filing_id, company_token),
  CONSTRAINT layoff_matches_alias_names_its_row CHECK (matched_via <> 'alias' OR alias_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS layoff_matches_company_token_idx ON public.layoff_matches (company_token);

COMMENT ON TABLE public.layoff_matches IS
  'A filing joined to a board token, written only by layoff_matches_rebuild. matched_via is '
  'exact_multitoken (the filer''s normalised name has two or more tokens and equals exactly one '
  'employer''s mirrored display name; WARN rows also needed a live posting in the notice''s state) or '
  'alias (an accepted layoff_employer_aliases row). There is no third value: a single-token, '
  'ambiguous, state-gated or fuzzy candidate gets no row here and therefore reaches no surface.';

CREATE TABLE IF NOT EXISTS public.layoff_feed_health (
  feed               text NOT NULL,
  state              char(2) NOT NULL DEFAULT '',
  last_ok_at         timestamptz,
  last_attempt_at    timestamptz,
  latest_public_date date,
  rows_last_run      int,
  etag               text,
  extract_failed     boolean,
  stale              boolean NOT NULL DEFAULT true,
  note               text,
  PRIMARY KEY (feed, state)
);

COMMENT ON TABLE public.layoff_feed_health IS
  'One row per (feed, state) the poller reads: last ok and last attempt, the newest public date the '
  'feed carried, the ETag that lets an unchanged raw file be skipped, whether the courier''s own '
  'extract job failed, and stale. stale blocks nothing on screen and enables nothing: a filing '
  'already held is still a fact, and no surface prints an absence. state is the empty string, not '
  'NULL, for a feed with no state so the key stays a key.';

CREATE TABLE IF NOT EXISTS public.layoff_read_log (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind     text NOT NULL CHECK (kind IN ('edgar_atom', 'edgar_fts_audit', 'edgar_backfill', 'warn', 'matcher', 'partition')),
  read_at  timestamptz NOT NULL DEFAULT now(),
  fetched  int,
  kept     int,
  new_rows int,
  ok       boolean NOT NULL,
  ms       int,
  note     text
);
CREATE INDEX IF NOT EXISTS layoff_read_log_kind_read_at_idx ON public.layoff_read_log (kind, read_at DESC);

COMMENT ON TABLE public.layoff_read_log IS
  'One row per poller invocation, matcher run and partition refresh. The heartbeat reads this table, '
  'not the function logs. Pruned at 90 days by roll_up_and_prune_layoff_filings.';

CREATE TABLE IF NOT EXISTS public.layoff_filing_rollup (
  month        date NOT NULL,
  source       text NOT NULL,
  state        text NOT NULL DEFAULT '',
  filings      int NOT NULL DEFAULT 0,
  workers_sum  bigint,
  rolled_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (month, source, state)
);

CREATE TABLE IF NOT EXISTS public.job_board_layoff_partition (
  arm                     text PRIMARY KEY CHECK (arm IN ('filed', 'control')),
  taken_down_30           numeric,
  still_open_30           numeric,
  still_open_30_lo        numeric,
  still_open_30_hi        numeric,
  half_width_30           numeric,
  relist_rate_30          numeric,
  n_at_risk_30            int,
  employers_n             int,
  max_employer_share      numeric,
  gate_share_30           numeric,
  sum_check_30            numeric,
  cohort_from             date,
  cohort_to               date,
  sufficient_30           boolean NOT NULL DEFAULT false,
  insufficient_reason     text CHECK (insufficient_reason IS NULL OR insufficient_reason IN ('n', 'width', 'arithmetic', 'employers', 'share')),
  newest_filing_event_date date,
  warn_lag_p50_days       numeric,
  warn_lag_n              int,
  computed_at             timestamptz,
  filings_read_at         timestamptz
);

COMMENT ON TABLE public.job_board_layoff_partition IS
  'Two rows, written by refresh_layoff_partition: the day-30 share (S(30), R(30), X(30)) of dated '
  'roles on boards we read to the end, partitioned by whether the employer had a qualifying layoff '
  'filing in the lookback before the role was posted (arm filed) or not (arm control). sufficient_30 '
  'is the same day-30 gate the field curve uses plus, on the filed arm only, an employer floor and a '
  'largest-employer share cap; insufficient_reason names the first gate that failed. The section '
  'prints a sentence only when both rows are sufficient and prints the reason otherwise. Never a '
  'ratio of the two arms.';

-- Locked: RLS on with no policy, revoked by name, service_role only.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'layoff_filings', 'layoff_employer_aliases', 'layoff_board_names', 'layoff_matches',
    'layoff_feed_health', 'layoff_read_log', 'layoff_filing_rollup', 'job_board_layoff_partition'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

REVOKE ALL ON TABLE public.layoff_filings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.layoff_employer_aliases FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.layoff_board_names FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.layoff_matches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.layoff_feed_health FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.layoff_read_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.layoff_filing_rollup FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.job_board_layoff_partition FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.layoff_employer_aliases_alias_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.layoff_read_log_id_seq TO service_role;

-- Self-check: every table above is RLS-on with no policy and no anon/authenticated privilege.
DO $$
DECLARE t text; bad text := '';
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'layoff_filings', 'layoff_employer_aliases', 'layoff_board_names', 'layoff_matches',
    'layoff_feed_health', 'layoff_read_log', 'layoff_filing_rollup', 'job_board_layoff_partition'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity) THEN
      bad := bad || t || ' (rls off) ';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t) THEN
      bad := bad || t || ' (has a policy) ';
    END IF;
    IF has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || t, 'SELECT') THEN
      bad := bad || t || ' (anon or authenticated can select) ';
    END IF;
  END LOOP;
  IF bad <> '' THEN
    RAISE EXCEPTION 'layoff tables are not locked: %', bad;
  END IF;
END $$;
