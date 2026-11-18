-- lovable-cron-fallback-reviewed: no cron; this file schedules no job and changes none (reviewed 2026-11-18 in the API4 truth lane).
--
-- A POSTING IS ANSWERED BY WHAT WE SAW OF IT (API4 wave 1, lane A2).
--
-- WHAT THIS ADDS. The database half of "is this job real?": what we saw of
-- one posting, by its id, and the employer facts beside it, under one budget.
--
--   1. posting_truth(p_ids): per posting id (ten at most, by id only), what
--      our own records hold. It is built on get_application_lifecycle's
--      token-first closure read (20261009131000, S11-024): a posting id is
--      source:token:native, so its token reaches job_board_closures_curve_idx
--      and the id filters that board; superseded and suspect closures are not
--      takedowns. Beside it: the posting row (listed = not stamped missing;
--      inside the 30-day serving window), the aged-out tombstone, and the
--      board's read (its observability bucket, its newest read and that
--      read's state, and whether its last stated total is Workday's 2,000
--      cap). No title is compared with any other
--      posting: a re-post is answered only when the SAME id came back.
--      The age is the employer's date only. Our discovery stamp is not read
--      at all, so no age here can be built from it (M16's class of defect).
--      A closure the collector dated by the lap that could first see it
--      (absence_basis lap_backfill) keeps its row and moves its date to a
--      separate column, the day we first saw it gone.
--   2. company_fact_cache: one employer fact sheet per (kind, board token),
--      private. Rows older than 24 hours are deleted in the call that writes
--      the cache (a bounded batch), so the table cannot grow without a cron.
--   3. api_expensive_meter and api_expensive_take: the meter for the calls
--      that cost database time. A caller names its endpoint, its subject (a
--      key), the units it wants and its caps; the function grants what the
--      caps leave and names the cap that bound. The bucket employer_compute
--      is GLOBAL and its cap is fixed here (10 uncached employer computations
--      a minute, shared by every surface that prints employer facts), so no
--      caller can pass a larger one. Rows older than two days are deleted in
--      the call, in a bounded batch.
--   4. company_facts(p_tokens): the employer fact sheet a check prints, read
--      from the cache when it is under six hours old, and otherwise computed
--      through get_company_fill_curve only while the employer_compute bucket
--      has room. A token it could not compute answers not_computed_yet. The
--      figures are shaped for print by the hiring-record gate in the edge
--      function (public-api/posting-truth.ts), never here.
--
-- WHO MAY CALL. All three functions and both tables answer the service role
-- only: REVOKE ALL from PUBLIC, anon and authenticated by name (Supabase's
-- default privileges grant the client roles everything created in public,
-- and a revoke from PUBLIC alone leaves their own grant in place), then a
-- grant to service_role. Both tables have row level security on and no
-- policy. No sequence is created.
--
-- Safe to re-run. Self-verifying at the end.

-- ── 1. the employer fact cache ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_fact_cache (
  kind          text NOT NULL,
  company_token text NOT NULL,
  facts         jsonb,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, company_token)
);
CREATE INDEX IF NOT EXISTS company_fact_cache_computed_at_idx
  ON public.company_fact_cache (computed_at);
ALTER TABLE public.company_fact_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.company_fact_cache FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.company_fact_cache TO service_role;
COMMENT ON TABLE public.company_fact_cache IS
  'One employer fact sheet per (kind, board token): kind fill_curve is one get_company_fill_curve row as jsonb. '
  'Read fresh for six hours; rows older than 24 hours are deleted by company_facts in the call, a bounded batch. '
  'Service role only. 20261206100000.';

-- ── 2. the meter for calls that cost database time ───────────────────────────
CREATE TABLE IF NOT EXISTS public.api_expensive_meter (
  endpoint     text NOT NULL,
  subject      text NOT NULL,
  span         text NOT NULL CHECK (span IN ('minute', 'day')),
  window_start timestamptz NOT NULL,
  used         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (endpoint, subject, span, window_start)
);
CREATE INDEX IF NOT EXISTS api_expensive_meter_window_start_idx
  ON public.api_expensive_meter (window_start);
ALTER TABLE public.api_expensive_meter ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.api_expensive_meter FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.api_expensive_meter TO service_role;
COMMENT ON TABLE public.api_expensive_meter IS
  'Units granted by api_expensive_take per (endpoint, subject, minute or UTC day). subject * is the endpoint''s global row. '
  'Rows older than two days are deleted by api_expensive_take in the call, a bounded batch. Service role only. 20261206100000.';

-- ── 3. the take ──────────────────────────────────────────────────────────────
-- p_partial: true grants whatever the caps leave (the employer_compute bucket
-- computes as many misses as it may); false grants all of p_n or none (a
-- request of ten ids is answered whole or refused).
CREATE OR REPLACE FUNCTION public.api_expensive_take(
  p_endpoint text,
  p_subject text,
  p_n integer,
  p_per_minute integer,
  p_per_day integer,
  p_global_per_minute integer,
  p_partial boolean DEFAULT false
)
RETURNS TABLE (
  et_granted integer,
  et_bound text,
  et_retry_after_s integer,
  et_minute_left integer,
  et_day_left integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  -- The one global bucket every surface that prints employer facts shares.
  c_employer_compute constant text := 'employer_compute';
  c_employer_compute_per_minute constant integer := 10;
  c_keep constant interval := interval '2 days';
  c_prune_batch constant integer := 500;
  v_endpoint text := btrim(COALESCE(p_endpoint, ''));
  v_subject text := COALESCE(NULLIF(btrim(p_subject), ''), '-');
  v_n integer := LEAST(GREATEST(COALESCE(p_n, 0), 0), 100000);
  v_per_minute integer := p_per_minute;
  v_per_day integer := p_per_day;
  v_global integer := p_global_per_minute;
  v_partial boolean := COALESCE(p_partial, false);
  v_minute timestamptz := date_trunc('minute', now());
  v_day timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_used_minute integer := 0;
  v_used_day integer := 0;
  v_used_global integer := 0;
  v_room integer;
  v_bound text := NULL;
  v_grant integer;
BEGIN
  IF v_endpoint = '' THEN
    RAISE EXCEPTION 'api_expensive_take needs an endpoint' USING ERRCODE = '22023';
  END IF;
  IF v_endpoint = c_employer_compute THEN
    v_subject := '*';
    v_per_minute := NULL;
    v_per_day := NULL;
    v_global := c_employer_compute_per_minute;
  END IF;

  DELETE FROM public.api_expensive_meter m
   WHERE m.ctid = ANY (ARRAY(
     SELECT o.ctid FROM public.api_expensive_meter o
      WHERE o.window_start < now() - c_keep
      LIMIT c_prune_batch));

  -- Each row this call counts against is created at zero or locked as it
  -- stands, so two calls in the same minute are counted one after the other.
  IF v_global IS NOT NULL THEN
    INSERT INTO public.api_expensive_meter AS m (endpoint, subject, span, window_start, used)
    VALUES (v_endpoint, '*', 'minute', v_minute, 0)
    ON CONFLICT (endpoint, subject, span, window_start) DO UPDATE SET used = m.used
    RETURNING m.used INTO v_used_global;
  END IF;
  IF v_per_minute IS NOT NULL THEN
    INSERT INTO public.api_expensive_meter AS m (endpoint, subject, span, window_start, used)
    VALUES (v_endpoint, v_subject, 'minute', v_minute, 0)
    ON CONFLICT (endpoint, subject, span, window_start) DO UPDATE SET used = m.used
    RETURNING m.used INTO v_used_minute;
  END IF;
  IF v_per_day IS NOT NULL THEN
    INSERT INTO public.api_expensive_meter AS m (endpoint, subject, span, window_start, used)
    VALUES (v_endpoint, v_subject, 'day', v_day, 0)
    ON CONFLICT (endpoint, subject, span, window_start) DO UPDATE SET used = m.used
    RETURNING m.used INTO v_used_day;
  END IF;

  v_room := v_n;
  IF v_per_minute IS NOT NULL AND GREATEST(v_per_minute - v_used_minute, 0) < v_room THEN
    v_room := GREATEST(v_per_minute - v_used_minute, 0);
    v_bound := 'minute';
  END IF;
  IF v_per_day IS NOT NULL AND GREATEST(v_per_day - v_used_day, 0) < v_room THEN
    v_room := GREATEST(v_per_day - v_used_day, 0);
    v_bound := 'day';
  END IF;
  IF v_global IS NOT NULL AND GREATEST(v_global - v_used_global, 0) < v_room THEN
    v_room := GREATEST(v_global - v_used_global, 0);
    v_bound := 'global';
  END IF;
  v_grant := CASE WHEN v_partial THEN v_room WHEN v_room >= v_n THEN v_n ELSE 0 END;

  IF v_grant > 0 THEN
    UPDATE public.api_expensive_meter m
       SET used = m.used + v_grant
     WHERE m.endpoint = v_endpoint
       AND ((v_global IS NOT NULL AND m.subject = '*' AND m.span = 'minute' AND m.window_start = v_minute)
         OR (v_per_minute IS NOT NULL AND m.subject = v_subject AND m.span = 'minute' AND m.window_start = v_minute)
         OR (v_per_day IS NOT NULL AND m.subject = v_subject AND m.span = 'day' AND m.window_start = v_day));
  END IF;

  RETURN QUERY SELECT
    v_grant,
    CASE WHEN v_grant < v_n THEN v_bound END,
    CASE
      WHEN v_grant >= v_n THEN 0
      WHEN v_bound = 'day' THEN CEIL(EXTRACT(epoch FROM (v_day + interval '1 day' - now())))::integer
      ELSE CEIL(EXTRACT(epoch FROM (v_minute + interval '1 minute' - now())))::integer
    END,
    CASE WHEN v_per_minute IS NULL THEN NULL ELSE GREATEST(v_per_minute - v_used_minute - v_grant, 0) END,
    CASE WHEN v_per_day IS NULL THEN NULL ELSE GREATEST(v_per_day - v_used_day - v_grant, 0) END;
END
$$;

COMMENT ON FUNCTION public.api_expensive_take(text, text, integer, integer, integer, integer, boolean) IS
  'Grants up to p_n units of a costly endpoint under the subject''s minute and UTC-day caps and the endpoint''s global '
  'minute cap; names the cap that bound and when to retry. The employer_compute bucket is global with a fixed cap of 10 '
  'a minute. Deletes meter rows older than two days in the call. Service role only. 20261206100000.';

-- ── 4. the employer fact sheet ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.company_facts(p_tokens text[])
RETURNS TABLE (
  cf_token text,
  cf_state text,
  cf_facts jsonb,
  cf_computed_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '25s'
AS $$
DECLARE
  c_kind constant text := 'fill_curve';
  c_fresh constant interval := interval '6 hours';
  c_keep constant interval := interval '24 hours';
  c_prune_batch constant integer := 200;
  v_tokens text[];
  v_misses text[];
  v_granted integer := 0;
  v_compute text[] := '{}'::text[];
BEGIN
  SELECT array_agg(DISTINCT t.tok) INTO v_tokens
    FROM unnest(p_tokens[1:10]) AS t(tok)
   WHERE t.tok IS NOT NULL AND btrim(t.tok) <> '';
  IF v_tokens IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.company_fact_cache f
   WHERE f.ctid = ANY (ARRAY(
     SELECT o.ctid FROM public.company_fact_cache o
      WHERE o.computed_at < now() - c_keep
      LIMIT c_prune_batch));

  SELECT array_agg(t.tok ORDER BY t.tok) INTO v_misses
    FROM unnest(v_tokens) AS t(tok)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.company_fact_cache f
      WHERE f.kind = c_kind AND f.company_token = t.tok AND f.computed_at >= now() - c_fresh);

  IF v_misses IS NOT NULL THEN
    SELECT e.et_granted INTO v_granted
      FROM public.api_expensive_take('employer_compute', NULL, cardinality(v_misses), NULL, NULL, NULL, true) e;
    IF COALESCE(v_granted, 0) > 0 THEN
      v_compute := v_misses[1:v_granted];
      INSERT INTO public.company_fact_cache AS f (kind, company_token, facts, computed_at)
      SELECT c_kind, g.company_token, to_jsonb(g), now()
        FROM public.get_company_fill_curve(v_compute) g
       WHERE g.company_token IS NOT NULL
      ON CONFLICT (kind, company_token) DO UPDATE SET facts = EXCLUDED.facts, computed_at = EXCLUDED.computed_at;
    END IF;
  END IF;

  RETURN QUERY
    SELECT t.tok,
           CASE WHEN f.company_token IS NULL THEN 'not_computed_yet'
                WHEN t.tok = ANY (v_compute) THEN 'computed'
                ELSE 'cached' END,
           f.facts,
           f.computed_at
      FROM unnest(v_tokens) AS t(tok)
      LEFT JOIN public.company_fact_cache f
        ON f.kind = c_kind AND f.company_token = t.tok AND f.computed_at >= now() - c_fresh
     ORDER BY t.tok;
END
$$;

COMMENT ON FUNCTION public.company_facts(text[]) IS
  'The employer fact sheet (one get_company_fill_curve row as jsonb) per board token, ten at most: cached for six hours, '
  'otherwise computed only while the global employer_compute bucket has room, else not_computed_yet. Deletes cache rows '
  'older than 24 hours in the call. Shaped for print by the hiring-record gate in the edge function. Service role only. '
  '20261206100000.';

-- ── 5. what we saw of a posting ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.posting_truth(p_ids text[])
RETURNS TABLE (
  pt_id text,
  pt_source text,
  pt_token text,
  pt_title text,
  pt_company text,
  pt_row_found boolean,
  pt_listed boolean,
  pt_in_window boolean,
  pt_missing_since timestamptz,
  pt_posted_at timestamptz,
  pt_has_closure boolean,
  pt_closed_at timestamptz,
  pt_seen_gone_at timestamptz,
  pt_aged_at timestamptz,
  pt_board_known boolean,
  pt_bucket text,
  pt_read_at timestamptz,
  pt_read_state text,
  pt_capped boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10s'
AS $$
  WITH ids AS (
    SELECT DISTINCT x AS jid
    FROM unnest(p_ids[1:10]) AS x
    WHERE x IS NOT NULL AND x <> ''
  ),
  cl AS (
    -- get_application_lifecycle's closure read, by the board first: the
    -- token reaches job_board_closures_curve_idx and the id filters that
    -- board. A takedown is a closure the collector trusted: never superseded,
    -- never stamped suspect.
    SELECT DISTINCT ON (c.posting_id)
      c.posting_id, c.closed_at, c.posted_at, c.source, c.company_token, c.title, c.company,
      c.absence_basis
    FROM ids
    JOIN public.job_board_closures c
      ON c.company_token = split_part(ids.jid, ':', 2)
     AND c.posting_id = ids.jid
    WHERE NOT COALESCE(c.superseded, false)
      AND NOT COALESCE(c.suspect, false)
    ORDER BY c.posting_id, c.closed_at DESC
  ),
  liv AS (
    -- Listed: not stamped missing at our last read. In the window: the
    -- board's own serving fence, the same predicate every list applies.
    SELECT p.id, p.source, p.title, p.company, p.posted_at, p.missing_since,
           (p.missing_since IS NULL) AS listed,
           COALESCE(p.effective_posted >= now() - interval '30 days', false) AS in_window
    FROM public.job_board_postings p
    WHERE p.id IN (SELECT ids.jid FROM ids)
  ),
  aged AS (
    SELECT a.id, a.posted_at, a.aged_at
    FROM public.job_board_aged_out a
    WHERE a.id IN (SELECT ids.jid FROM ids)
  ),
  toks AS (
    SELECT DISTINCT split_part(ids.jid, ':', 1) AS src, split_part(ids.jid, ':', 2) AS tok
    FROM ids
    WHERE split_part(ids.jid, ':', 2) <> ''
  ),
  board AS (
    SELECT t.src, t.tok,
           ob.bucket,
           lr.observed_at AS read_at,
           lr.state AS read_state,
           -- Workday's CXS states at most 2,000 and wraps there, so a stated
           -- total of exactly 2,000 is the cap, not the board (the fill
           -- curve's own rule). Unknown when no complete read in the last
           -- seven days stated a total.
           CASE WHEN ft.feed_total IS NULL THEN NULL
                ELSE ((ft.source = 'workday' OR t.tok LIKE '%~wd%') AND ft.feed_total = 2000)
           END AS capped,
           (ob.company_token IS NOT NULL OR lr.observed_at IS NOT NULL
             OR EXISTS (SELECT 1 FROM public.job_board_verifications v
                         WHERE v.company_token IN (t.tok, t.src || ':' || t.tok))) AS known
    FROM toks t
    LEFT JOIN public.job_board_board_observability ob ON ob.company_token = t.tok
    LEFT JOIN LATERAL (
      SELECT bs.observed_at, bs.state
      FROM public.job_board_board_state bs
      WHERE bs.company_token = t.tok
      ORDER BY bs.observed_on DESC
      LIMIT 1
    ) lr ON true
    LEFT JOIN LATERAL (
      SELECT bs.feed_total, bs.source
      FROM public.job_board_board_state bs
      WHERE bs.company_token = t.tok
        AND bs.observed_on >= current_date - 7
        AND bs.feed_total IS NOT NULL
        AND bs.state IN ('ok', 'empty')
      ORDER BY bs.observed_on DESC
      LIMIT 1
    ) ft ON true
  )
  SELECT
    ids.jid,
    lower(COALESCE(NULLIF(liv.source, ''), NULLIF(cl.source, ''), split_part(ids.jid, ':', 1))),
    split_part(ids.jid, ':', 2),
    COALESCE(liv.title, cl.title),
    COALESCE(liv.company, cl.company),
    (liv.id IS NOT NULL),
    COALESCE(liv.listed, false),
    COALESCE(liv.in_window, false),
    liv.missing_since,
    -- The employer's date, from whichever record of the posting holds it.
    COALESCE(liv.posted_at, cl.posted_at, aged.posted_at),
    (cl.posting_id IS NOT NULL),
    -- A takedown's date, except where the collector dated it by the lap that
    -- could first see it: that date is when we saw it gone, said apart.
    CASE WHEN cl.absence_basis IS DISTINCT FROM 'lap_backfill' THEN cl.closed_at END,
    CASE WHEN cl.absence_basis IS NOT DISTINCT FROM 'lap_backfill' THEN cl.closed_at END,
    aged.aged_at,
    COALESCE(b.known, false),
    b.bucket,
    b.read_at,
    b.read_state,
    b.capped
  FROM ids
  LEFT JOIN cl ON cl.posting_id = ids.jid
  LEFT JOIN liv ON liv.id = ids.jid
  LEFT JOIN aged ON aged.id = ids.jid
  LEFT JOIN board b ON b.src = split_part(ids.jid, ':', 1) AND b.tok = split_part(ids.jid, ':', 2)
  ORDER BY ids.jid
$$;

COMMENT ON FUNCTION public.posting_truth(text[]) IS
  'What our records hold of up to ten posting ids, by id only: the posting row (listed, inside the 30-day window), the '
  'newest trusted closure (lap_backfill dates returned apart as pt_seen_gone_at), the aged-out tombstone, the employer''s '
  'date, and the board''s read (bucket, newest read and its state, Workday cap). Built on '
  'get_application_lifecycle''s token-first closure read. Service role only. 20261206100000.';

-- ── 6. who may call ──────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.api_expensive_take(text, text, integer, integer, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_expensive_take(text, text, integer, integer, integer, integer, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.company_facts(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.company_facts(text[]) TO service_role;
REVOKE ALL ON FUNCTION public.posting_truth(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.posting_truth(text[]) TO service_role;

-- ── self-check ───────────────────────────────────────────────────────────────
DO $check$
DECLARE
  v_fn text;
  v_tbl text;
  v_role text;
  v_priv text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.posting_truth(text[])',
    'public.company_facts(text[])',
    'public.api_expensive_take(text, text, integer, integer, integer, integer, boolean)'
  ] LOOP
    IF to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION '% was not created', v_fn;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION '% is callable by %', v_fn, v_role;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% is not callable by the service role', v_fn;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p
                    WHERE p.oid = to_regprocedure(v_fn)
                      AND p.prosecdef
                      AND 'search_path=public' = ANY (COALESCE(p.proconfig, '{}'::text[]))) THEN
      RAISE EXCEPTION '% is not a definer with its search_path pinned', v_fn;
    END IF;
  END LOOP;
  FOREACH v_tbl IN ARRAY ARRAY['public.company_fact_cache', 'public.api_expensive_meter'] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF has_table_privilege(v_role, v_tbl, v_priv) THEN
          RAISE EXCEPTION '% holds % on %', v_role, v_priv, v_tbl;
        END IF;
      END LOOP;
    END LOOP;
    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = v_tbl::regclass) THEN
      RAISE EXCEPTION 'row level security is off on %', v_tbl;
    END IF;
  END LOOP;
END
$check$;
