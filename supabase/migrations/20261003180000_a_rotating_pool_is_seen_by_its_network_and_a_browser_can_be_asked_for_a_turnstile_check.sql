-- A ROTATING POOL IS SEEN BY ITS NETWORK, AND A BROWSER CAN BE ASKED FOR A PASS.
--
-- WHAT WAS WRONG (2026-10-03). The harvest on /jobs runs at ~3,500-4,000
-- counted board reads an hour from ~180-340 DIFFERENT addresses an hour, the
-- busiest one 40-80 calls an hour: far under any per-address cap, because the
-- addresses rotate. job-board .86 reads mainland China from the address, and
-- in its first twenty minutes not one request read CN, so the country switch
-- does not reach it either. It is a proxy pool, or Chinese clouds'
-- international ranges. The meter of 20261002140000 had no rule that could
-- see it.
--
-- WHAT THIS ADDS to the counter job_board_anon_check, every behaviour of
-- 20261002140000 restated unchanged (the body below is that body plus the
-- marked additions):
--   p_net    the caller's network as job-board .87 derives it from the
--            normalised address: an IPv4 /24 or an IPv6 /48. Anything else,
--            including text that is not an address at all, is NO network --
--            never an error, because the gate fails open on any error and an
--            error would switch the whole meter off silently.
--   p_pass   the caller's board-pass state: valid, invalid, none or
--            unconfigured. NULL (an older job-board) and any other text are
--            'unconfigured', which no rule ever refuses: a missing secret
--            must never take the board down.
--   p_pass_id   the first 16 hex of a valid pass's nonce. A pass is a bearer
--            token for half an hour, so one solved check replayed across a
--            whole pool would read without limit. Each pass id gets its own
--            day row in the meter, 'pass:' plus the id, judged against
--            passCap (default 600 counted reads, about twenty a minute for
--            the pass's whole life -- past any person). Past it the pass is
--            'spent': the telemetry shows it by that name whether or not
--            anything is required, and requirePass treats it like no pass,
--            so an honest browser simply gets a fresh one. Anything that is
--            not 16 lower-case hex, or arrives with a pass that is not
--            valid, is no id.
--   blockedNetworks   a jsonb array of CIDR strings in the setting row: an
--            IPv4 /24 or wider, an IPv6 /48 or wider. A caller whose network
--            sits inside a listed one gets cap 0 whatever its kind, like a
--            listed country, and network_rule true. Entries that are not an
--            address, or narrower than that, are ignored, never an error.
--   requirePass   boolean in the setting row. When true:
--            - a caller of kind address, unknown_address or unproven_* whose
--              pass is invalid, none or spent gets cap 0 and pass_rule true.
--              unproven_* is asked because it is by definition NOT one of
--              our servers: a caller holding the reader proof is exempt
--              before this function is ever called, and the api/mcp/digest
--              declaration alone is a header anyone can send;
--            - kinds build and probe (our bake and our probes, which cannot
--              solve a browser check) are not refused for lack of a pass,
--              but without a valid one they share ONE day row per kind,
--              'tool:build' and 'tool:probe', judged at the caller's code cap
--              or a lower override. The header is public, so the per-address
--              row a rotating pool multiplies by its addresses is exactly
--              what it must not get: this way the header buys at most one
--              day's tooling allowance in total, and spending it is visible
--              (and short-changes our own bake for that UTC day);
--            - 'unconfigured' is never refused and never shared.
--            pass_rule is true only when the pass is what refuses the call:
--            a listed network, or a listed country whose cap is 0, refuses it
--            whatever pass it carries, and then pass_rule is false so the page
--            does not send a person round a reload that cannot help.
--   The new rules refuse only while enforce is true, the same as the
--   country rule. No key is set here: OBSERVE FIRST, and nothing new
--   refuses until the owner sets one (docs/job-board-deploy-notes.md, .87).
--
-- THE TELEMETRY. job_board_anon_net_hourly counts every metered call per UTC
-- hour by the caller's /16 (IPv4) or /32 (IPv6), kind and pass state
-- (valid, invalid, none, unconfigured, or spent), 'none' when there is no
-- network. Coarser than the /24 the rule can block, on purpose: it is
-- published through get_board_anon_networks to the publishable key,
-- aggregates only, no address and no bucket. It is upserted in the counter's
-- one data-modifying WITH and swept with the other two tables on a bucket's
-- first call of the day. A pass's day row lives in the meter and is swept
-- with it.
--
-- DEPLOY ORDER IS FREE. The seven-argument counter is dropped by exact
-- signature and the ten-argument one created in its place, the three new
-- parameters defaulted, so job-board .86 (seven named arguments) still
-- resolves to it. job-board .87 before this migration gets PGRST202 for ten
-- named arguments and repeats the call with the seven, so the country block
-- keeps refusing across the skew. The closing check proves both: the
-- defaults are in the catalogue, and a call in .86's exact shape answers.
--
-- THE 42702 RULE. No RETURNS TABLE name is a column of a table either body
-- touches, and every column reference is alias-qualified
-- (plpgsql-out-params-cannot-capture-columns.test.ts holds all three
-- functions).

CREATE TABLE IF NOT EXISTS public.job_board_anon_net_hourly (
  hour_utc timestamptz NOT NULL,
  net text NOT NULL,
  kind text NOT NULL,
  pass text NOT NULL,
  within_cap integer NOT NULL DEFAULT 0,
  over_cap integer NOT NULL DEFAULT 0,
  PRIMARY KEY (hour_utc, net, kind, pass)
);
ALTER TABLE public.job_board_anon_net_hourly ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_board_anon_net_hourly FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.job_board_anon_net_hourly TO service_role;
COMMENT ON TABLE public.job_board_anon_net_hourly IS
  'Hourly network telemetry behind get_board_anon_networks: per UTC hour, the caller''s /16 (IPv4) or /32 (IPv6) network (''none'' without one), caller kind and board-pass state (valid, invalid, none, unconfigured, or spent = a valid pass used past passCap), the anonymous job-board calls served and refused. Never an address or a bucket. Service-role only; rows older than eight days are removed by job_board_anon_check.';

DROP FUNCTION IF EXISTS public.job_board_anon_check(text, text, text, integer, integer, integer, boolean);

CREATE OR REPLACE FUNCTION public.job_board_anon_check(
  p_bucket text,
  p_kind text,
  p_country text,
  p_address_cap integer,
  p_build_cap integer,
  p_probe_cap integer,
  p_bare boolean DEFAULT false,
  p_net text DEFAULT NULL,
  p_pass text DEFAULT NULL,
  p_pass_id text DEFAULT NULL
)
RETURNS TABLE (
  is_allowed boolean,
  used_today integer,
  over_today integer,
  cap_today integer,
  country_rule boolean,
  enforcing boolean,
  network_rule boolean,
  pass_rule boolean
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
  -- .87: anything but the three states job-board sends is 'unconfigured', never refused.
  v_pass text := CASE WHEN p_pass IN ('valid', 'invalid', 'none') THEN p_pass ELSE 'unconfigured' END;
  v_pass_id text := CASE WHEN p_pass_id ~ '^[0-9a-f]{16}$' THEN p_pass_id END;
  v_pass_cap integer;
  v_pass_spent boolean := false;
  v_tool_shared boolean := false;
  v_net cidr;
  v_net_tel text := 'none';
  v_entry text;
  v_block inet;
  v_net_listed boolean := false;
  v_require boolean := false;
  v_pass_rule boolean := false;
  v_country_cap integer := 0;
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
  -- No address, listed country: that country's own shared row, never the world's.
  IF v_listed AND v_kind = 'unknown_address' THEN
    v_bucket := 'unknown:' || v_cc;
  END IF;

  -- .87: the caller's network, accepted only as a /24 or a /48. The cast sits
  -- in its own block so text that is not an address becomes no network.
  IF p_net IS NOT NULL THEN
    BEGIN
      v_net := btrim(p_net)::cidr;
      IF NOT ((family(v_net) = 4 AND masklen(v_net) = 24) OR (family(v_net) = 6 AND masklen(v_net) = 48)) THEN
        v_net := NULL;
      END IF;
    EXCEPTION WHEN others THEN
      v_net := NULL;
    END;
  END IF;
  IF v_net IS NOT NULL THEN
    v_net_tel := set_masklen(v_net, CASE WHEN family(v_net) = 4 THEN 16 ELSE 32 END)::text;
  END IF;

  -- .87: a listed network. Each entry is cast in its own block: an entry that
  -- is not an address, or narrower than a /24 or a /48, is skipped.
  IF v_net IS NOT NULL AND jsonb_typeof(v_cfg -> 'blockedNetworks') = 'array' THEN
    FOR v_entry IN SELECT b.cidr_text FROM jsonb_array_elements_text(v_cfg -> 'blockedNetworks') b(cidr_text) LOOP
      BEGIN
        v_block := btrim(v_entry)::inet;
        IF family(v_block) = family(v_net)
           AND ((family(v_block) = 4 AND masklen(v_block) <= 24) OR (family(v_block) = 6 AND masklen(v_block) <= 48))
           AND v_net <<= v_block THEN
          v_net_listed := true;
          EXIT;
        END IF;
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END LOOP;
  END IF;

  IF jsonb_typeof(v_cfg -> 'requirePass') = 'boolean' THEN
    v_require := (v_cfg ->> 'requirePass')::boolean;
  END IF;
  IF v_listed THEN
    v_country_cap := round(least(greatest(coalesce(
      CASE WHEN jsonb_typeof(v_cfg -> 'countryCap') = 'number' THEN (v_cfg ->> 'countryCap')::numeric ELSE 0 END,
      0), 0), 100000000))::integer;
  END IF;

  -- .87: THE PASS IS METERED, so one solved check cannot read for a whole
  -- pool. Its own day row, decided inside the conflict update and returned
  -- by the same statement, like the address row below.
  IF v_pass = 'valid' AND v_pass_id IS NOT NULL THEN
    v_pass_cap := round(least(greatest(coalesce(
      CASE WHEN jsonb_typeof(v_cfg -> 'passCap') = 'number' THEN (v_cfg ->> 'passCap')::numeric END,
      600), 0), 100000000))::integer;
    INSERT INTO public.job_board_anon_meter AS pm (day_utc, bucket, within_cap, over_cap, last_call_over)
    VALUES (
      v_day, 'pass:' || v_pass_id,
      CASE WHEN v_pass_cap >= 1 THEN 1 ELSE 0 END,
      CASE WHEN v_pass_cap >= 1 THEN 0 ELSE 1 END,
      v_pass_cap < 1
    )
    ON CONFLICT (day_utc, bucket) DO UPDATE SET
      within_cap = pm.within_cap + CASE WHEN pm.within_cap < v_pass_cap THEN 1 ELSE 0 END,
      over_cap = pm.over_cap + CASE WHEN pm.within_cap < v_pass_cap THEN 0 ELSE 1 END,
      last_call_over = NOT (pm.within_cap < v_pass_cap)
    RETURNING pm.last_call_over INTO v_pass_spent;
    IF v_pass_spent THEN
      v_pass := 'spent';
    END IF;
  END IF;

  -- .87: who is asked for a pass. Browsers, and declarations without the
  -- reader proof; never 'unconfigured'.
  v_pass_rule := v_require
    AND v_kind IN ('address', 'unknown_address', 'unproven_api', 'unproven_mcp', 'unproven_digest')
    AND v_pass IN ('invalid', 'none', 'spent')
    AND NOT v_net_listed
    AND NOT (v_listed AND v_country_cap < 1);
  -- .87: our tooling's public headers, without a pass, share one row per kind.
  v_tool_shared := v_require
    AND v_kind IN ('build', 'probe')
    AND v_pass IN ('invalid', 'none', 'spent')
    AND NOT v_net_listed
    AND NOT v_listed;
  IF v_tool_shared THEN
    v_bucket := 'tool:' || v_kind;
  END IF;

  v_capn := CASE
    WHEN v_net_listed OR v_pass_rule THEN 0
    WHEN v_listed THEN v_country_cap
    WHEN v_kind = 'unknown_address' THEN 100000000
    WHEN v_kind = 'build' THEN least(
      CASE WHEN jsonb_typeof(v_cfg -> 'buildCap') = 'number' THEN (v_cfg ->> 'buildCap')::numeric ELSE p_build_cap END,
      CASE WHEN v_tool_shared THEN p_build_cap END)
    WHEN v_kind = 'probe' THEN least(
      CASE WHEN jsonb_typeof(v_cfg -> 'probeCap') = 'number' THEN (v_cfg ->> 'probeCap')::numeric ELSE p_probe_cap END,
      CASE WHEN v_tool_shared THEN p_probe_cap END)
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
  ), net_row AS (
    INSERT INTO public.job_board_anon_net_hourly AS nh (hour_utc, net, kind, pass, within_cap, over_cap)
    SELECT v_hour, v_net_tel, v_kind, v_pass,
           CASE WHEN d.last_call_over THEN 0 ELSE 1 END,
           CASE WHEN d.last_call_over THEN 1 ELSE 0 END
      FROM day_row d
    ON CONFLICT (hour_utc, net, kind, pass) DO UPDATE SET
      within_cap = nh.within_cap + excluded.within_cap,
      over_cap = nh.over_cap + excluded.over_cap
    RETURNING nh.within_cap
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
    DELETE FROM public.job_board_anon_net_hourly n
     WHERE (n.hour_utc, n.net, n.kind, n.pass) IN (
       SELECT n2.hour_utc, n2.net, n2.kind, n2.pass FROM public.job_board_anon_net_hourly n2
        WHERE n2.hour_utc < v_hour - interval '8 days'
        LIMIT 500 FOR UPDATE SKIP LOCKED);
  END IF;

  RETURN QUERY SELECT
    (NOT coalesce(v_last, false)) OR (NOT v_enforce),
    coalesce(v_within, 0),
    coalesce(v_over, 0),
    v_cap,
    v_listed,
    v_enforce,
    v_net_listed,
    v_pass_rule;
END;
$$;

COMMENT ON FUNCTION public.job_board_anon_check(text, text, text, integer, integer, integer, boolean, text, text, text) IS
  'Counts one anonymous job-board read against today''s bucket in one statement and says whether it is allowed. Caps come from the parameters unless the anon_board_budget row in job_board_meta overrides them. One bucket per address; the kind only picks the cap. A listed country gets countryCap (default 0) whatever the kind, and its callers with no usable address share the bucket unknown:<code>; otherwise kind unknown_address is never refused. A caller whose /24 or /48 (p_net) sits inside a blockedNetworks entry gets 0 whatever the kind (network_rule). A valid pass (p_pass, p_pass_id) has its own day row pass:<id> against passCap (default 600) and past it is spent. With requirePass, kinds address, unknown_address and unproven_* whose pass is invalid, none or spent get 0 (pass_rule), and passless build and probe share one row per kind (tool:<kind>) at the parameter cap or a lower override; unconfigured is never refused. enforce false counts without refusing. Service-role only.';

REVOKE ALL ON FUNCTION public.job_board_anon_check(text, text, text, integer, integer, integer, boolean, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_board_anon_check(text, text, text, integer, integer, integer, boolean, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_board_anon_networks(p_hours integer DEFAULT 3, p_limit integer DEFAULT 40)
RETURNS TABLE (
  bn_hour timestamptz,
  bn_net text,
  bn_kind text,
  bn_pass text,
  bn_requests bigint,
  bn_over_cap bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT n.hour_utc,
         n.net,
         n.kind,
         n.pass,
         (n.within_cap + n.over_cap)::bigint,
         n.over_cap::bigint
    FROM public.job_board_anon_net_hourly n
   WHERE n.hour_utc >= (date_trunc('hour', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
                       - make_interval(hours => least(greatest(coalesce(p_hours, 3), 1), 168) - 1)
   ORDER BY 5 DESC, 1 DESC, 2, 3, 4
   LIMIT least(greatest(coalesce(p_limit, 40), 1), 200);
$$;

COMMENT ON FUNCTION public.get_board_anon_networks(integer, integer) IS
  'The busiest (hour, network, kind, board-pass state) rows of anonymous job-board reads over the last p_hours (1-168), at most p_limit (1-200): the network is the caller''s /16 (IPv4) or /32 (IPv6), ''none'' without one; the pass state is valid, invalid, none, unconfigured, or spent (a valid pass used past passCap); requests counted and requests over the cap. Aggregates only; no address or bucket leaves. Readable with the publishable key.';

REVOKE ALL ON FUNCTION public.get_board_anon_networks(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_board_anon_networks(integer, integer) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- THE MIGRATION CHECKS WHAT IT LEFT. The staged runner can edit a failing
-- file and apply something else under this name; this block raises unless
-- the catalogue holds exactly what the file intended AND the counter behaves
-- as intended. The behaviour half runs the real counter against a setting
-- row of its own inside a sub-block that always ends in a sentinel error, so
-- every row it wrote (the setting, the meter, both hourly tables) is rolled
-- back and production keeps exactly the row it had. It uses documentation
-- networks only (RFC 5737), which no real caller has.
DO $$
DECLARE
  v_new oid := to_regprocedure('public.job_board_anon_check(text, text, text, integer, integer, integer, boolean, text, text, text)')::oid;
  v_old oid := to_regprocedure('public.job_board_anon_check(text, text, text, integer, integer, integer, boolean)')::oid;
  v_reader oid := to_regprocedure('public.get_board_anon_networks(integer, integer)')::oid;
  v_defs integer;
  v_names text[];
  v_role text;
  v_priv text;
  v_fail text;
  v_sentinel constant text := 'job_board_anon_check probe: rolled back';
  r record;
  r2 record;
BEGIN
  SELECT count(*)::integer INTO v_defs
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'job_board_anon_check';
  IF v_defs <> 1 OR v_new IS NULL OR v_old IS NOT NULL THEN
    RAISE EXCEPTION 'job_board_anon_check: want exactly one, the ten-argument counter; found % definition(s), ten-argument %, seven-argument %', v_defs, v_new, v_old;
  END IF;
  SELECT p.proargnames INTO v_names FROM pg_proc p WHERE p.oid = v_new;
  IF NOT (v_names @> ARRAY['p_bare', 'p_net', 'p_pass', 'p_pass_id', 'is_allowed', 'cap_today', 'country_rule', 'enforcing', 'network_rule', 'pass_rule']) THEN
    RAISE EXCEPTION 'job_board_anon_check: arguments or output columns are not the ones this file declares: %', v_names;
  END IF;
  -- p_bare, p_net, p_pass and p_pass_id defaulted: without them job-board .86
  -- (seven named arguments) gets PGRST202 and its gate fails open.
  IF (SELECT p.pronargdefaults FROM pg_proc p WHERE p.oid = v_new) IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'job_board_anon_check: want the last four arguments defaulted, found % default(s)', (SELECT p.pronargdefaults FROM pg_proc p WHERE p.oid = v_new);
  END IF;
  IF has_function_privilege('anon', v_new, 'EXECUTE') OR has_function_privilege('authenticated', v_new, 'EXECUTE') THEN
    RAISE EXCEPTION 'job_board_anon_check is executable by anon or authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', v_new, 'EXECUTE') THEN
    RAISE EXCEPTION 'job_board_anon_check is not executable by service_role, so job-board cannot count';
  END IF;
  IF NOT coalesce((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.job_board_anon_net_hourly')), false) THEN
    RAISE EXCEPTION 'job_board_anon_net_hourly is missing or has row level security off';
  END IF;
  FOR v_role, v_priv IN
    SELECT ro.rolname, pv.privname
      FROM unnest(ARRAY['anon', 'authenticated']) ro(rolname)
     CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) pv(privname)
  LOOP
    IF has_table_privilege(v_role, 'public.job_board_anon_net_hourly', v_priv) THEN
      RAISE EXCEPTION 'job_board_anon_net_hourly is readable or writable by a client role: % holds %', v_role, v_priv;
    END IF;
  END LOOP;
  IF v_reader IS NULL OR NOT has_function_privilege('anon', v_reader, 'EXECUTE') THEN
    RAISE EXCEPTION 'get_board_anon_networks is missing or not executable by anon';
  END IF;
  IF NOT coalesce((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_reader), false) THEN
    RAISE EXCEPTION 'get_board_anon_networks is not SECURITY DEFINER, so anon would read nothing through the RLS lock';
  END IF;

  -- THE BEHAVIOUR, rolled back.
  BEGIN
    INSERT INTO public.job_board_meta (k, v)
    VALUES ('anon_board_budget', '{"enforce": true, "requirePass": true, "passCap": 1, "blockedNetworks": ["198.51.100.0/24", "not a network"], "addressCap": 100000000, "buildCap": 100000000, "probeCap": 100000000}'::jsonb)
    ON CONFLICT (k) DO UPDATE SET v = excluded.v;

    SELECT * INTO r FROM public.job_board_anon_check('migration-check:net', 'address', 'XX', 5, 5, 5, false, '198.51.100.0/24', 'valid', NULL);
    IF r.is_allowed OR NOT r.network_rule OR r.pass_rule THEN
      v_fail := coalesce(v_fail || '; ', '') || 'a caller inside a blockedNetworks entry was not refused by the network rule';
    END IF;
    SELECT * INTO r FROM public.job_board_anon_check('migration-check:none', 'address', 'XX', 5, 5, 5, false, '192.0.2.0/24', 'none', NULL);
    IF r.is_allowed OR NOT r.pass_rule OR r.network_rule THEN
      v_fail := coalesce(v_fail || '; ', '') || 'requirePass did not refuse a browser without a pass';
    END IF;
    SELECT * INTO r FROM public.job_board_anon_check('migration-check:unproven', 'unproven_api', 'XX', 5, 5, 5, false, '192.0.2.0/24', 'none', NULL);
    IF r.is_allowed OR NOT r.pass_rule THEN
      v_fail := coalesce(v_fail || '; ', '') || 'requirePass did not refuse an unproven api declaration without a pass';
    END IF;
    SELECT * INTO r FROM public.job_board_anon_check('migration-check:unconf', 'address', 'XX', 5, 5, 5, false, '192.0.2.0/24', 'unconfigured', NULL);
    IF NOT r.is_allowed OR r.pass_rule THEN
      v_fail := coalesce(v_fail || '; ', '') || 'an unconfigured pass state was refused';
    END IF;
    SELECT * INTO r FROM public.job_board_anon_check('migration-check:p1', 'address', 'XX', 5, 5, 5, false, '192.0.2.0/24', 'valid', '00000000000000ab');
    SELECT * INTO r2 FROM public.job_board_anon_check('migration-check:p2', 'address', 'XX', 5, 5, 5, false, '192.0.2.0/24', 'valid', '00000000000000ab');
    IF NOT r.is_allowed OR r.pass_rule OR r2.is_allowed OR NOT r2.pass_rule THEN
      v_fail := coalesce(v_fail || '; ', '') || 'a pass used past passCap from a second address was not refused as spent';
    END IF;
    SELECT * INTO r FROM public.job_board_anon_check('migration-check:b1', 'build', 'XX', 5, 5, 5, false, '192.0.2.0/24', 'none', NULL);
    SELECT * INTO r2 FROM public.job_board_anon_check('migration-check:b2', 'build', 'XX', 5, 5, 5, false, '203.0.113.0/24', 'none', NULL);
    IF NOT r.is_allowed OR r.cap_today <> 5 OR r2.used_today <> 2 OR r2.pass_rule THEN
      v_fail := coalesce(v_fail || '; ', '') || 'passless build declarations under requirePass did not share one row at the parameter cap';
    END IF;
    -- job-board .86's exact call: seven NAMED arguments.
    SELECT * INTO r FROM public.job_board_anon_check(
      p_bucket => 'migration-check:old', p_kind => 'address', p_country => 'XX',
      p_address_cap => 5, p_build_cap => 5, p_probe_cap => 5, p_bare => false);
    IF NOT r.is_allowed OR r.pass_rule OR r.network_rule THEN
      v_fail := coalesce(v_fail || '; ', '') || 'job-board .86''s seven-argument call was refused';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.job_board_anon_net_hourly n
       WHERE n.net = '198.51.0.0/16' AND n.kind = 'address' AND n.pass = 'valid' AND n.over_cap >= 1
    ) OR NOT EXISTS (
      SELECT 1 FROM public.job_board_anon_net_hourly n
       WHERE n.net = '192.0.0.0/16' AND n.kind = 'address' AND n.pass = 'spent'
    ) THEN
      v_fail := coalesce(v_fail || '; ', '') || 'the network telemetry did not record the calls by /16, kind and pass state';
    END IF;
    UPDATE public.job_board_meta mm SET v = mm.v || '{"enforce": false}'::jsonb WHERE mm.k = 'anon_board_budget';
    SELECT * INTO r FROM public.job_board_anon_check('migration-check:observe', 'address', 'XX', 5, 5, 5, false, '192.0.2.0/24', 'none', NULL);
    IF NOT r.is_allowed OR NOT r.pass_rule OR r.enforcing THEN
      v_fail := coalesce(v_fail || '; ', '') || 'enforce false refused, or stopped naming the rule that would have';
    END IF;
    RAISE EXCEPTION USING MESSAGE = v_sentinel;
  EXCEPTION WHEN others THEN
    IF SQLERRM <> v_sentinel THEN
      v_fail := coalesce(v_fail || '; ', '') || 'the probe could not run: ' || SQLERRM;
    END IF;
  END;
  IF v_fail IS NOT NULL THEN
    RAISE EXCEPTION 'job_board_anon_check does not behave as this file intends: %', v_fail;
  END IF;
END $$;
