-- A BROWSER ADDRESS GETS A BROWSER'S DAY, AND THE COUNT IS READABLE.
--
-- WHAT THIS IS FOR. The job-board function served list, detail and facets to
-- any anonymous caller without limit. In late September 2026 one JS-rendering
-- client loaded /jobs?job=<id> around 5,800 times a day (about 29,000 counted
-- board calls), harvesting the corpus through the site's publishable key and
-- around the metered /v1 API. This is the meter for that path: one row per
-- UTC day per bucket, and one per hour per bucket, kind and country for the
-- owner to read.
--
-- THE BUCKETS. job-board/anon-budget.ts decides who is counted. The service
-- key and our own servers' reader proof are never counted and never reach
-- this function. Everyone else is a bucket named after a KEYED SHA-256 prefix
-- of their address (IPv6 cut to its /64), never the address itself; our own
-- build and probe tooling gets a larger per-address allowance under its own
-- bucket prefix; an address that is missing or not public is the single
-- bucket 'unknown', counted and NEVER refused (kind unknown_address), so a
-- platform header change cannot turn the address cap into a global wall.
--
-- THE CAPS are the caller's parameters (code constants in anon-budget.ts),
-- overridable per field from the job_board_meta row 'anon_board_budget',
-- which also holds the observe-only switch and the country switch. The row
-- is read INSIDE this call, in the round trip the counter makes anyway, so a
-- one-statement change takes effect on the next request with no cache: this
-- repo has measured job-board's per-isolate caches as never hitting.
--   enforce      boolean, default true in code. Seeded FALSE below, so the
--                meter ships observing and the owner turns refusal on with
--                one statement once the telemetry proves the address
--                derivation (docs/job-board-deploy-notes.md, .85).
--   countries    an array of ISO alpha-2 codes; absent = the switch is OFF.
--                A request whose sanitised country is listed gets countryCap
--                (default 0 = refuse) per address per day. Not enabled here.
--   addressCap / buildCap / probeCap   integer overrides of the parameters.
-- Every number is computed as numeric and clamped to [0, 100000000] before it
-- becomes an integer, so a typo like 1e20 cannot raise out-of-range (the gate
-- fails open on any error, so a raise would switch the meter off silently).
--
-- THE ARITHMETIC IS ONE STATEMENT. The day row is upserted with the verdict
-- computed inside the conflict update, under the row lock, and the same
-- statement returns that verdict; the hourly row is upserted from it in the
-- same data-modifying WITH. There is no read of the counter followed by a
-- write of it anywhere, so two concurrent calls cannot both take the last
-- slot. The cap counts SERVED calls, so raising a cap mid-day re-admits an
-- address up to the new cap and lowering it refuses at once.
--
-- RETENTION. Eight days, removed inside the counter call on a bucket's first
-- call of the day, bounded and never waiting on a lock.
--
-- THE 42702 RULE. Every RETURNS TABLE name is an OUT parameter in scope for
-- the whole plpgsql body; none of them is a column of the three tables the
-- body touches, and every column reference is alias-qualified anyway
-- (plpgsql-out-params-cannot-capture-columns.test.ts holds both functions).
--
-- WHO MAY CALL WHAT. The two tables are RLS-on with no policy and revoked
-- from every client role by name. The counter runs as its caller and only
-- service_role may execute it. The reader is a definer over aggregates only
-- -- no bucket and no address ever leaves it -- and is granted to anon, so
-- the owner reads it with the publishable key and no deploy.
--
-- This meter owns its tables. It shares nothing with the per-IP request
-- budget that guards upload and checkout, which board browsing once drained.

CREATE TABLE IF NOT EXISTS public.job_board_anon_meter (
  day_utc date NOT NULL,
  bucket text NOT NULL,
  within_cap integer NOT NULL DEFAULT 0,
  over_cap integer NOT NULL DEFAULT 0,
  last_call_over boolean NOT NULL DEFAULT false,
  PRIMARY KEY (day_utc, bucket)
);
ALTER TABLE public.job_board_anon_meter ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_board_anon_meter FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.job_board_anon_meter TO service_role;
COMMENT ON TABLE public.job_board_anon_meter IS
  'Daily meter of anonymous job-board reads: one row per UTC day per bucket (''ip:'', ''build:'' or ''probe:'' plus a keyed 16-hex SHA-256 prefix of the address, or ''unknown''; never an address). within_cap counts served calls, over_cap calls past the cap; last_call_over is the verdict of the newest call. Service-role only; written by job_board_anon_check, which removes rows older than eight days.';

CREATE TABLE IF NOT EXISTS public.job_board_anon_hourly (
  hour_utc timestamptz NOT NULL,
  bucket text NOT NULL,
  kind text NOT NULL,
  country text NOT NULL,
  within_cap integer NOT NULL DEFAULT 0,
  over_cap integer NOT NULL DEFAULT 0,
  bare_calls integer NOT NULL DEFAULT 0,
  PRIMARY KEY (hour_utc, bucket, kind, country)
);
ALTER TABLE public.job_board_anon_hourly ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_board_anon_hourly FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.job_board_anon_hourly TO service_role;
COMMENT ON TABLE public.job_board_anon_hourly IS
  'Hourly telemetry behind get_board_anon_hourly: per UTC hour, bucket, caller kind and sanitised cf-ipcountry, the calls served, refused and made with neither Origin nor Referer. Service-role only; rows older than eight days are removed by job_board_anon_check.';

CREATE OR REPLACE FUNCTION public.job_board_anon_check(
  p_bucket text,
  p_kind text,
  p_country text,
  p_address_cap integer,
  p_build_cap integer,
  p_probe_cap integer,
  p_bare boolean DEFAULT false
)
RETURNS TABLE (
  is_allowed boolean,
  used_today integer,
  over_today integer,
  cap_today integer,
  country_rule boolean,
  enforcing boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_day date := (v_now AT TIME ZONE 'UTC')::date;
  v_hour timestamptz := date_trunc('hour', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_bucket text := left(coalesce(nullif(btrim(p_bucket), ''), 'unknown'), 64);
  v_kind text := CASE
    WHEN p_kind IN ('address', 'build', 'probe', 'unproven_api', 'unproven_mcp', 'unproven_digest', 'unknown_address') THEN p_kind
    ELSE 'address'
  END;
  v_cc text := CASE
    WHEN upper(btrim(coalesce(p_country, ''))) ~ '^[A-Z]{2}$' AND upper(btrim(p_country)) <> 'XX' THEN upper(btrim(p_country))
    ELSE 'XX'
  END;
  v_cfg jsonb;
  v_listed boolean := false;
  v_enforce boolean := true;
  v_capn numeric;
  v_cap integer;
  v_within integer;
  v_over integer;
  v_last boolean;
BEGIN
  SELECT mm.v INTO v_cfg FROM public.job_board_meta mm WHERE mm.k = 'anon_board_budget';
  v_cfg := coalesce(v_cfg, '{}'::jsonb);
  IF jsonb_typeof(v_cfg -> 'enforce') = 'boolean' THEN
    v_enforce := (v_cfg ->> 'enforce')::boolean;
  END IF;
  IF v_cc <> 'XX' AND jsonb_typeof(v_cfg -> 'countries') = 'array' THEN
    SELECT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_cfg -> 'countries') c(code)
       WHERE upper(btrim(c.code)) = v_cc
    ) INTO v_listed;
  END IF;

  v_capn := CASE
    WHEN v_listed THEN
      CASE WHEN jsonb_typeof(v_cfg -> 'countryCap') = 'number' THEN (v_cfg ->> 'countryCap')::numeric ELSE 0 END
    WHEN v_kind = 'unknown_address' THEN 100000000
    WHEN v_kind = 'build' THEN
      CASE WHEN jsonb_typeof(v_cfg -> 'buildCap') = 'number' THEN (v_cfg ->> 'buildCap')::numeric ELSE p_build_cap END
    WHEN v_kind = 'probe' THEN
      CASE WHEN jsonb_typeof(v_cfg -> 'probeCap') = 'number' THEN (v_cfg ->> 'probeCap')::numeric ELSE p_probe_cap END
    ELSE
      CASE WHEN jsonb_typeof(v_cfg -> 'addressCap') = 'number' THEN (v_cfg ->> 'addressCap')::numeric ELSE p_address_cap END
  END;
  v_cap := round(least(greatest(coalesce(v_capn, 0), 0), 100000000))::integer;

  WITH day_row AS (
    INSERT INTO public.job_board_anon_meter AS m (day_utc, bucket, within_cap, over_cap, last_call_over)
    VALUES (
      v_day, v_bucket,
      CASE WHEN v_cap >= 1 THEN 1 ELSE 0 END,
      CASE WHEN v_cap >= 1 THEN 0 ELSE 1 END,
      v_cap < 1
    )
    ON CONFLICT (day_utc, bucket) DO UPDATE SET
      within_cap = m.within_cap + CASE WHEN m.within_cap < v_cap THEN 1 ELSE 0 END,
      over_cap = m.over_cap + CASE WHEN m.within_cap < v_cap THEN 0 ELSE 1 END,
      last_call_over = NOT (m.within_cap < v_cap)
    RETURNING m.within_cap, m.over_cap, m.last_call_over
  ), hour_row AS (
    INSERT INTO public.job_board_anon_hourly AS hh (hour_utc, bucket, kind, country, within_cap, over_cap, bare_calls)
    SELECT v_hour, v_bucket, v_kind, v_cc,
           CASE WHEN d.last_call_over THEN 0 ELSE 1 END,
           CASE WHEN d.last_call_over THEN 1 ELSE 0 END,
           CASE WHEN coalesce(p_bare, false) THEN 1 ELSE 0 END
      FROM day_row d
    ON CONFLICT (hour_utc, bucket, kind, country) DO UPDATE SET
      within_cap = hh.within_cap + excluded.within_cap,
      over_cap = hh.over_cap + excluded.over_cap,
      bare_calls = hh.bare_calls + excluded.bare_calls
    RETURNING hh.within_cap
  )
  SELECT d.within_cap, d.over_cap, d.last_call_over INTO v_within, v_over, v_last FROM day_row d;

  -- A bucket's first call of the day sweeps what has aged out: bounded, and
  -- never waiting on a row another call holds.
  IF coalesce(v_within, 0) + coalesce(v_over, 0) = 1 THEN
    DELETE FROM public.job_board_anon_meter m
     WHERE (m.day_utc, m.bucket) IN (
       SELECT m2.day_utc, m2.bucket FROM public.job_board_anon_meter m2
        WHERE m2.day_utc < v_day - 7
        LIMIT 500 FOR UPDATE SKIP LOCKED);
    DELETE FROM public.job_board_anon_hourly h
     WHERE (h.hour_utc, h.bucket, h.kind, h.country) IN (
       SELECT h2.hour_utc, h2.bucket, h2.kind, h2.country FROM public.job_board_anon_hourly h2
        WHERE h2.hour_utc < v_hour - interval '8 days'
        LIMIT 500 FOR UPDATE SKIP LOCKED);
  END IF;

  RETURN QUERY SELECT
    (NOT coalesce(v_last, false)) OR (NOT v_enforce),
    coalesce(v_within, 0),
    coalesce(v_over, 0),
    v_cap,
    v_listed,
    v_enforce;
END;
$$;

COMMENT ON FUNCTION public.job_board_anon_check(text, text, text, integer, integer, integer, boolean) IS
  'Counts one anonymous job-board read against today''s bucket in one statement and says whether it is allowed. Caps come from the parameters unless the anon_board_budget row in job_board_meta overrides them; a listed country gets countryCap (default 0); kind unknown_address is never refused; enforce false counts without refusing. Service-role only.';

REVOKE ALL ON FUNCTION public.job_board_anon_check(text, text, text, integer, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_board_anon_check(text, text, text, integer, integer, integer, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.get_board_anon_hourly(p_hours integer DEFAULT 48)
RETURNS TABLE (
  bh_hour timestamptz,
  bh_kind text,
  bh_country text,
  bh_requests bigint,
  bh_over_cap bigint,
  bh_addresses bigint,
  bh_addresses_over_cap bigint,
  bh_top_address_requests bigint,
  bh_bare_requests bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH per AS (
    SELECT h.hour_utc, h.kind, h.country, h.bucket,
           (h.within_cap + h.over_cap)::bigint AS req,
           h.over_cap::bigint AS over_n,
           h.bare_calls::bigint AS bare_n,
           sum(h.within_cap + h.over_cap) OVER (PARTITION BY h.hour_utc, h.kind, h.bucket)::bigint AS req_all_countries
      FROM public.job_board_anon_hourly h
     WHERE h.hour_utc >= (date_trunc('hour', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
                         - make_interval(hours => least(greatest(coalesce(p_hours, 48), 1), 168) - 1)
  )
  SELECT p.hour_utc,
         p.kind,
         CASE WHEN grouping(p.country) = 1 THEN 'ALL' ELSE p.country END,
         sum(p.req)::bigint,
         sum(p.over_n)::bigint,
         count(DISTINCT p.bucket)::bigint,
         (count(DISTINCT p.bucket) FILTER (WHERE p.over_n > 0))::bigint,
         CASE WHEN grouping(p.country) = 1 THEN max(p.req_all_countries) ELSE max(p.req) END::bigint,
         sum(p.bare_n)::bigint
    FROM per p
   GROUP BY GROUPING SETS ((p.hour_utc, p.kind), (p.hour_utc, p.kind, p.country))
   ORDER BY 1 DESC, 2, 3;
$$;

COMMENT ON FUNCTION public.get_board_anon_hourly(integer) IS
  'Anonymous job-board reads per UTC hour, caller kind and country (plus an ALL row per hour and kind) over the last p_hours (1-168): requests counted, requests over the cap, distinct buckets, buckets over the cap, the busiest single bucket, and requests with neither Origin nor Referer. Aggregates only; no bucket or address leaves. Readable with the publishable key.';

REVOKE ALL ON FUNCTION public.get_board_anon_hourly(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_board_anon_hourly(integer) TO anon, authenticated, service_role;

-- OBSERVE FIRST. The setting row ships with refusal off; an existing row (the
-- owner's) is left exactly as it is.
INSERT INTO public.job_board_meta (k, v, updated_at)
VALUES ('anon_board_budget', jsonb_build_object('enforce', false), now())
ON CONFLICT (k) DO NOTHING;
