-- A CALL COUNT NAMES A CORRECTED OR REFUSABLE SEARCH.
--
-- WHAT WAS MISSING. Owner decision D3 (mcp-upgrade-3-2026-11-16, recorded
-- 2026-11-16; design spec-3.md lines 189-240) says the connector corrects
-- and says known misnamings, says and COUNTS unknown names, and refuses an
-- unknown name only after a 7-day count and a replay of 300 or more real
-- argument shapes. mcp_count_call (20261011101000) keeps a closed list of
-- outcome words and stores any other word as 'other', so the two answers
-- agent-mcp now gives -- a call whose name or value was read as another, and
-- a search sent a name it does not take -- would both land as 'other', and
-- the count the later refusal waits on could not be read.
--
-- WHAT THIS CHANGES.
--   * mcp_count_call: the same function with two more words in its list,
--     'corrected' and 'would_refuse'. Both are ANSWERED calls (the caller got
--     its page), counted exactly like 'ok'. Nothing else changes: still no
--     address, subject, key or argument, still 400 days kept.
--   * mcp_connector_report: the same columns, and one more kind of row,
--     'answered': per day, host, surface and tool, the calls that got an
--     answer (ok, cached, corrected, would_refuse) with the corrected and
--     would_refuse calls each also shown on their own 'calls' rows, so the
--     owner reads the share of answered searches a refusal would have
--     turned away.
--   * The grants of every function this replaces are restated:
--     REVOKE ALL ... FROM PUBLIC, anon, authenticated and GRANT EXECUTE TO
--     service_role (CREATE OR REPLACE keeps the old ACL, and Supabase's
--     default privileges grant EXECUTE to anon and authenticated on a new
--     function, so the restatement is what holds if either was ever dropped).
--
-- ORDER. Apply BEFORE fn:agent-mcp (lane fix/1121-connector-errors). The old
-- function stores the new words as 'other' rather than failing a call, so
-- either order is safe; this order makes the first day's count readable.
--
-- Safe to re-run: CREATE OR REPLACE, grants restated, and the self-check
-- writes and removes its own rows.

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
    'ok', 'argument', 'refused_day', 'refused_minute', 'refused_key', 'retired', 'error', 'given_back', 'cached',
    'corrected', 'would_refuse'
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
  'Adds one to today''s mcp_calls_daily counter for (host, surface, tool, outcome); unknown words are stored as other. corrected (a name or value read as another) and would_refuse (a search sent a name it does not take; owner D3) are answered calls. Service-role only.';

REVOKE ALL ON FUNCTION public.mcp_count_call(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_count_call(text, text, text, text) TO service_role;

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
  -- Every call that got its answer, whatever the reader said about its
  -- arguments: corrected and would_refuse are answered calls (owner D3).
  SELECT c.day, 'answered'::text, c.host, c.surface, c.tool, NULL, sum(c.calls)::bigint, NULL::integer
    FROM public.mcp_calls_daily c, win
   WHERE c.day >= win.from_day AND c.outcome IN ('ok', 'cached', 'corrected', 'would_refuse')
   GROUP BY c.day, c.host, c.surface, c.tool
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
  'The owner''s view of the MCP connector over the last p_days (1-90): calls by host, surface, tool and outcome (corrected and would_refuse among them); answered calls per host, surface and tool (ok, cached, corrected, would_refuse); each share of the keyless allowance against its cap; and the 50% alerts. Service-role only, for admin-ops behind the ADMIN_API_KEY.';

REVOKE ALL ON FUNCTION public.mcp_connector_report(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_connector_report(integer) TO service_role;

-- SELF-CHECK: both functions exist, the client roles cannot run either, the
-- service role can, the reader still runs as its caller, the two new words
-- are stored as themselves (and an unknown word still as 'other'), and the
-- reader counts both as answered.
DO $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_sig text;
  v_answered bigint;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.mcp_count_call(text, text, text, text)',
    'public.mcp_connector_report(integer)'
  ] LOOP
    IF to_regprocedure(v_sig) IS NULL THEN
      RAISE EXCEPTION 'self-check: % does not exist', v_sig;
    END IF;
    IF has_function_privilege('anon', v_sig, 'EXECUTE') OR has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: a client role can run %', v_sig;
    END IF;
    IF NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: the service role cannot run %', v_sig;
    END IF;
  END LOOP;
  IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.mcp_connector_report(integer)'::regprocedure) THEN
    RAISE EXCEPTION 'self-check: the owner reader must run as its caller';
  END IF;

  PERFORM public.mcp_count_call('other', 'keyless', 'zz_selfcheck_corrected', 'corrected');
  PERFORM public.mcp_count_call('other', 'keyless', 'zz_selfcheck_corrected', 'would_refuse');
  PERFORM public.mcp_count_call('other', 'keyless', 'zz_selfcheck_corrected', 'not-a-word');
  IF NOT EXISTS (SELECT 1 FROM public.mcp_calls_daily c WHERE c.day = v_today AND c.tool = 'zz_selfcheck_corrected' AND c.outcome = 'corrected' AND c.calls = 1)
     OR NOT EXISTS (SELECT 1 FROM public.mcp_calls_daily c WHERE c.day = v_today AND c.tool = 'zz_selfcheck_corrected' AND c.outcome = 'would_refuse' AND c.calls = 1)
     OR NOT EXISTS (SELECT 1 FROM public.mcp_calls_daily c WHERE c.day = v_today AND c.tool = 'zz_selfcheck_corrected' AND c.outcome = 'other' AND c.calls = 1) THEN
    RAISE EXCEPTION 'self-check: corrected and would_refuse must be stored as themselves, and an unknown word as other';
  END IF;
  SELECT r.calls INTO v_answered FROM public.mcp_connector_report(1) r
   WHERE r.kind = 'answered' AND r.host = 'other' AND r.surface = 'keyless' AND r.tool = 'zz_selfcheck_corrected';
  DELETE FROM public.mcp_calls_daily c WHERE c.day = v_today AND c.tool = 'zz_selfcheck_corrected';
  IF v_answered IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'self-check: the report counted % answered calls, want 2 (corrected and would_refuse)', v_answered;
  END IF;
END
$$;
