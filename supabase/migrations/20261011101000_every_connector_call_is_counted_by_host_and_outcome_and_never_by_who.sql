-- EVERY CONNECTOR CALL IS COUNTED BY HOST AND OUTCOME, AND NEVER BY WHO.
--
-- WHAT WAS MISSING. The MCP server's only record of keyless use was the meter
-- itself (mcp_anon_rate): allowed calls per bucket, nothing about which tool,
-- which host, or how a call ended. So nobody could say whether a refusal was
-- the minute cap, the day, an argument the caller got wrong or a fault of
-- ours, and the 50% alert the owner asked for (2026-10-11) had nothing to
-- read.
--
-- WHAT THIS ADDS.
--   * mcp_calls_daily(day, host, surface, tool, outcome, calls): one counter
--     per UTC day per combination. host is the platform the verified address
--     belongs to (claude / chatgpt / other); surface is how the caller came
--     (keyless / key); outcome is one word from a fixed list. No address, no
--     subject, no key and no argument is stored -- the table cannot say who.
--   * mcp_count_call(...): the one writer, service-role only. A word outside
--     the list is stored as 'other' rather than refused, so a new outcome in
--     agent-mcp can never fail a call.
--   * mcp_allowance_alerts(day, share, used, cap, at): the first time in a UTC
--     day that a share of the keyless allowance reaches half its cap.
--     mcp_allowance_alert_claim(...) writes that row and answers true exactly
--     once per share per day, so agent-mcp mails the owner once.
--   * mcp_connector_report(p_days): the owner's reader -- calls by day, host,
--     surface, tool and outcome, each share's use against its cap, and the
--     alerts -- and mcp_free_key_leads(p_days): free keys that used at least
--     80% of their daily quota on three or more of the last seven days, by key
--     id and prefix only. Both service-role only, for admin-ops behind the
--     ADMIN_API_KEY (the reader pattern of 20261008127000).
--
-- RETENTION. mcp_calls_daily and mcp_allowance_alerts keep 400 days, pruned
-- by mcp_count_call on the first call of each day (bounded: days x hosts x
-- surfaces x tools x outcomes, a few hundred rows a day).
--
-- Safe to re-run: IF NOT EXISTS, CREATE OR REPLACE, grants restated, and the
-- self-check writes and removes its own rows.

-- The share rows' cap, which the report reads. 20261011102000 adds it too and
-- says what writes it; adding it here as well lets this file stand first.
ALTER TABLE public.mcp_anon_rate ADD COLUMN IF NOT EXISTS cap integer;

CREATE TABLE IF NOT EXISTS public.mcp_calls_daily (
  day date NOT NULL,
  host text NOT NULL,
  surface text NOT NULL,
  tool text NOT NULL,
  outcome text NOT NULL,
  calls integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, host, surface, tool, outcome)
);

ALTER TABLE public.mcp_calls_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mcp_calls_daily FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mcp_calls_daily TO service_role;

COMMENT ON TABLE public.mcp_calls_daily IS
  'MCP connector calls per UTC day by host (the platform of the verified address), surface (keyless or key), tool and outcome. Stores no address, subject, key or argument. Written by mcp_count_call; service-role only.';

CREATE TABLE IF NOT EXISTS public.mcp_allowance_alerts (
  day date NOT NULL,
  share text NOT NULL,
  used integer NOT NULL,
  cap integer NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, share)
);

ALTER TABLE public.mcp_allowance_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mcp_allowance_alerts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mcp_allowance_alerts TO service_role;

COMMENT ON TABLE public.mcp_allowance_alerts IS
  'The first moment in a UTC day that a share of the keyless MCP allowance reached half its cap. One row per share per day; written by mcp_allowance_alert_claim; service-role only.';

CREATE OR REPLACE FUNCTION public.mcp_count_call(p_host text, p_surface text, p_tool text, p_outcome text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_host text := CASE WHEN p_host IN ('claude', 'chatgpt', 'other') THEN p_host ELSE 'other' END;
  v_surface text := CASE WHEN p_surface IN ('keyless', 'key') THEN p_surface ELSE 'keyless' END;
  v_tool text := left(regexp_replace(coalesce(p_tool, ''), '[^a-z_/]', '', 'g'), 40);
  v_outcome text := CASE WHEN p_outcome IN (
    'ok', 'argument', 'refused_day', 'refused_minute', 'refused_key', 'retired', 'error', 'given_back', 'cached'
  ) THEN p_outcome ELSE 'other' END;
  v_n integer;
BEGIN
  IF v_tool = '' THEN v_tool := 'unknown'; END IF;
  INSERT INTO public.mcp_calls_daily AS c (day, host, surface, tool, outcome, calls)
  VALUES (v_today, v_host, v_surface, v_tool, v_outcome, 1)
  ON CONFLICT (day, host, surface, tool, outcome) DO UPDATE SET calls = c.calls + 1
  RETURNING c.calls INTO v_n;
  -- The first count of a combination on a new day is a cheap moment to prune.
  IF v_n = 1 THEN
    DELETE FROM public.mcp_calls_daily c WHERE c.day < v_today - 400;
    DELETE FROM public.mcp_allowance_alerts a WHERE a.day < v_today - 400;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.mcp_count_call(text, text, text, text) IS
  'Adds one to today''s mcp_calls_daily counter for (host, surface, tool, outcome); unknown words are stored as other. Service-role only.';

REVOKE ALL ON FUNCTION public.mcp_count_call(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_count_call(text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_allowance_alert_claim(p_share text, p_used integer, p_cap integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_claimed integer;
BEGIN
  IF p_share IS NULL OR p_cap IS NULL OR p_used IS NULL OR p_cap < 1 OR p_used * 2 < p_cap THEN
    RETURN false;
  END IF;
  INSERT INTO public.mcp_allowance_alerts AS a (day, share, used, cap)
  VALUES (v_today, left(p_share, 64), p_used, p_cap)
  ON CONFLICT (day, share) DO NOTHING
  RETURNING 1 INTO v_claimed;
  RETURN v_claimed IS NOT NULL;
END;
$$;

COMMENT ON FUNCTION public.mcp_allowance_alert_claim(text, integer, integer) IS
  'True exactly once per share per UTC day: the first call at which p_used reached half of p_cap, recorded in mcp_allowance_alerts. Service-role only.';

REVOKE ALL ON FUNCTION public.mcp_allowance_alert_claim(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_allowance_alert_claim(text, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_connector_report(p_days integer DEFAULT 7)
RETURNS TABLE (
  report_day date,
  kind text,
  host text,
  surface text,
  tool text,
  outcome text,
  calls bigint,
  cap integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH win AS (
    SELECT (now() AT TIME ZONE 'UTC')::date - (least(greatest(coalesce(p_days, 7), 1), 90) - 1) AS from_day
  )
  SELECT c.day, 'calls'::text, c.host, c.surface, c.tool, c.outcome, c.calls::bigint, NULL::integer
    FROM public.mcp_calls_daily c, win
   WHERE c.day >= win.from_day
  UNION ALL
  SELECT r.day, 'share'::text, NULL, NULL, r.bucket, NULL, r.calls::bigint, r.cap
    FROM public.mcp_anon_rate r, win
   WHERE r.day >= win.from_day AND (r.bucket = 'global' OR r.bucket LIKE 'global:%')
  UNION ALL
  SELECT a.day, 'alert'::text, NULL, NULL, a.share, NULL, a.used::bigint, a.cap
    FROM public.mcp_allowance_alerts a, win
   WHERE a.day >= win.from_day
  ORDER BY 1 DESC, 2, 5;
$$;

COMMENT ON FUNCTION public.mcp_connector_report(integer) IS
  'The owner''s view of the MCP connector over the last p_days (1-90): calls by host, surface, tool and outcome; each share of the keyless allowance against its cap; and the 50% alerts. Service-role only, for admin-ops behind the ADMIN_API_KEY.';

REVOKE ALL ON FUNCTION public.mcp_connector_report(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_connector_report(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_free_key_leads(p_days integer DEFAULT 7)
RETURNS TABLE (key_id uuid, key_prefix text, busy_days bigint, max_day_calls bigint, daily_quota integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH per_day AS (
    SELECT u.key_id AS kid, u.day AS d, sum(u.calls)::bigint AS n
      FROM public.api_usage u
     WHERE u.day >= (now() AT TIME ZONE 'UTC')::date - (least(greatest(coalesce(p_days, 7), 1), 30) - 1)
     GROUP BY 1, 2
  )
  SELECT k.id, k.key_prefix,
         count(*) FILTER (WHERE pd.n * 5 >= k.daily_quota::bigint * 4)::bigint,
         max(pd.n)::bigint,
         k.daily_quota
    FROM per_day pd
    JOIN public.api_keys k ON k.id = pd.kid
   WHERE k.revoked_at IS NULL AND k.tier = 'free' AND k.daily_quota > 0
   GROUP BY k.id, k.key_prefix, k.daily_quota
  HAVING count(*) FILTER (WHERE pd.n * 5 >= k.daily_quota::bigint * 4) >= 3
   ORDER BY 3 DESC, 4 DESC;
$$;

COMMENT ON FUNCTION public.mcp_free_key_leads(integer) IS
  'Free keys that used at least 80% of their daily quota on three or more of the last p_days (1-30): key id, prefix, busy days, busiest day, quota. No address or email. Service-role only, for admin-ops behind the ADMIN_API_KEY.';

REVOKE ALL ON FUNCTION public.mcp_free_key_leads(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_free_key_leads(integer) TO service_role;

-- SELF-CHECK: everything exists, the client roles hold nothing, the service
-- role holds what it needs, the readers run as their caller, a count lands
-- once with an unknown word stored as 'other', and a claim answers true once.
DO $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_sig text;
  v_tbl text;
  v_role text;
  v_first boolean;
  v_second boolean;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.mcp_count_call(text, text, text, text)',
    'public.mcp_allowance_alert_claim(text, integer, integer)',
    'public.mcp_connector_report(integer)',
    'public.mcp_free_key_leads(integer)'
  ] LOOP
    IF to_regprocedure(v_sig) IS NULL THEN
      RAISE EXCEPTION 'self-check: % was not created', v_sig;
    END IF;
    IF has_function_privilege('anon', v_sig, 'EXECUTE') OR has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: a client role can run %', v_sig;
    END IF;
    IF NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: the service role cannot run %', v_sig;
    END IF;
  END LOOP;
  IF (SELECT bool_or(p.prosecdef) FROM pg_proc p WHERE p.oid IN ('public.mcp_connector_report(integer)'::regprocedure, 'public.mcp_free_key_leads(integer)'::regprocedure)) THEN
    RAISE EXCEPTION 'self-check: an owner reader must run as its caller';
  END IF;
  FOREACH v_tbl IN ARRAY ARRAY['public.mcp_calls_daily', 'public.mcp_allowance_alerts'] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_table_privilege(v_role, v_tbl, 'SELECT') OR has_table_privilege(v_role, v_tbl, 'INSERT')
         OR has_table_privilege(v_role, v_tbl, 'UPDATE') OR has_table_privilege(v_role, v_tbl, 'DELETE') THEN
        RAISE EXCEPTION 'self-check: % holds a privilege on %', v_role, v_tbl;
      END IF;
    END LOOP;
  END LOOP;

  PERFORM public.mcp_count_call('other', 'keyless', 'zz_selfcheck_20261011101000', 'not-a-word');
  IF NOT EXISTS (SELECT 1 FROM public.mcp_calls_daily c WHERE c.day = v_today AND c.tool = 'zz_selfcheck_' AND c.outcome = 'other' AND c.calls = 1) THEN
    RAISE EXCEPTION 'self-check: mcp_count_call did not store one call with its unknown outcome as other';
  END IF;
  DELETE FROM public.mcp_calls_daily c WHERE c.day = v_today AND c.tool = 'zz_selfcheck_';

  v_first := public.mcp_allowance_alert_claim('global:zz-selfcheck-20261011101000', 5, 10);
  v_second := public.mcp_allowance_alert_claim('global:zz-selfcheck-20261011101000', 6, 10);
  DELETE FROM public.mcp_allowance_alerts a WHERE a.day = v_today AND a.share = 'global:zz-selfcheck-20261011101000';
  IF NOT v_first OR v_second THEN
    RAISE EXCEPTION 'self-check: an alert claim must answer true once per share per day (first %, second %)', v_first, v_second;
  END IF;
  IF public.mcp_allowance_alert_claim('global:zz-selfcheck-20261011101000', 4, 10) THEN
    RAISE EXCEPTION 'self-check: an alert was claimed under half the cap';
  END IF;

  PERFORM count(*) FROM public.mcp_connector_report(1);
  PERFORM count(*) FROM public.mcp_free_key_leads(7);
END
$$;
