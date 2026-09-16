-- A CHANNEL CANNOT BE JUDGED UNTIL SOMEONE CAN READ IT.
--
-- Service-role adoption reader for the MCP channel. Reads five tables,
-- writes none. Applied unedited from
-- supabase/migrations/20260917200000_a_channel_cannot_be_judged_until_someone_can_read_it.sql

CREATE OR REPLACE FUNCTION public.agent_adoption_metrics(p_days integer)
RETURNS TABLE (
  metric_day date,
  keys_minted_agent bigint,
  keys_minted_other bigint,
  keys_active_mcp bigint,
  mcp_calls_total bigint,
  mcp_tool_calls_total bigint,
  mcp_tool_usage jsonb,
  mcp_prompt_calls_total bigint,
  mcp_prompt_usage jsonb,
  mcp_resource_calls_total bigint,
  mcp_resource_usage jsonb,
  mcp_key_usage jsonb,
  unkeyed_calls bigint,
  unkeyed_addresses bigint,
  unkeyed_address_calls_max integer,
  unkeyed_addresses_at_max bigint,
  passes_sold bigint,
  passes_activated bigint,
  passes_activated_via_key bigint,
  passes_activated_via_oauth bigint,
  passes_activated_via_unstamped bigint,
  passes_activated_via_detail jsonb,
  passes_exhausted bigint,
  mcp_searches bigint,
  mcp_searches_zero_results bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '20s'
AS $$
DECLARE
  v_days integer := greatest(coalesce(p_days, 1), 1);
  v_today date := (now() AT TIME ZONE 'utc')::date;
  v_from date;
  v_from_ts timestamptz;
BEGIN
  v_from := v_today - (v_days - 1);
  v_from_ts := (v_from::timestamp) AT TIME ZONE 'utc';

  RETURN QUERY
  WITH days AS (
    SELECT gs::date AS d
      FROM generate_series(v_from, v_today, interval '1 day') AS gs
  ),
  minted AS (
    SELECT (ak.created_at AT TIME ZONE 'utc')::date AS d,
           count(*) FILTER (WHERE ak.name = 'agent-mcp')::bigint AS n_agent,
           count(*) FILTER (WHERE ak.name IS DISTINCT FROM 'agent-mcp')::bigint AS n_other
      FROM public.api_keys ak
     WHERE ak.created_at >= v_from_ts
     GROUP BY 1
  ),
  mcp_use AS (
    SELECT u.day AS d,
           u.key_id AS kid,
           u.calls AS n,
           CASE WHEN u.endpoint LIKE '/mcp/prompt/%' THEN 'prompt'
                WHEN u.endpoint LIKE '/mcp/resource/%' THEN 'resource'
                ELSE 'tool' END AS fam,
           CASE WHEN u.endpoint LIKE '/mcp/prompt/%' THEN substr(u.endpoint, length('/mcp/prompt/') + 1)
                WHEN u.endpoint LIKE '/mcp/resource/%' THEN substr(u.endpoint, length('/mcp/resource/') + 1)
                ELSE substr(u.endpoint, length('/mcp/') + 1) END AS leaf
      FROM public.api_usage u
     WHERE u.day BETWEEN v_from AND v_today
       AND u.endpoint LIKE '/mcp/%'
  ),
  use_by_leaf AS (
    SELECT mu.d, mu.fam, mu.leaf,
           sum(mu.n)::bigint AS n_calls,
           count(DISTINCT mu.kid)::bigint AS n_keys
      FROM mcp_use mu
     GROUP BY 1, 2, 3
  ),
  use_by_fam AS (
    SELECT ul.d, ul.fam,
           sum(ul.n_calls)::bigint AS n_calls,
           jsonb_object_agg(ul.leaf, jsonb_build_object('calls', ul.n_calls, 'keys', ul.n_keys) ORDER BY ul.leaf) AS detail
      FROM use_by_leaf ul
     GROUP BY 1, 2
  ),
  use_by_day AS (
    SELECT mu.d,
           sum(mu.n)::bigint AS n_calls,
           count(DISTINCT mu.kid)::bigint AS n_keys
      FROM mcp_use mu
     GROUP BY 1
  ),
  use_by_key AS (
    SELECT x.d, jsonb_object_agg(x.kp, x.n_calls ORDER BY x.kp) AS detail
      FROM (
        SELECT mu.d, ak.key_prefix AS kp, sum(mu.n)::bigint AS n_calls
          FROM mcp_use mu
          JOIN public.api_keys ak ON ak.id = mu.kid
         GROUP BY 1, 2
      ) x
     GROUP BY 1
  ),
  unkeyed AS (
    SELECT r.day AS d,
           coalesce(sum(r.calls) FILTER (WHERE r.bucket = 'global'), 0)::bigint AS n_global,
           count(*) FILTER (WHERE r.bucket <> 'global')::bigint AS n_addr,
           coalesce(max(r.calls) FILTER (WHERE r.bucket <> 'global'), 0)::integer AS addr_max
      FROM public.mcp_anon_rate r
     WHERE r.day BETWEEN v_from AND v_today
     GROUP BY 1
  ),
  anon_at_max AS (
    SELECT r.day AS d, count(*)::bigint AS n_at_max
      FROM public.mcp_anon_rate r
      JOIN unkeyed an ON an.d = r.day
     WHERE r.bucket <> 'global' AND r.calls = an.addr_max
     GROUP BY 1
  ),
  sold AS (
    SELECT (ap.purchased_at AT TIME ZONE 'utc')::date AS d,
           count(*)::bigint AS n_sold,
           count(*) FILTER (WHERE ap.applications_used >= ap.applications_total)::bigint AS n_exhausted
      FROM public.agent_passes ap
     WHERE ap.purchased_at >= v_from_ts
     GROUP BY 1
  ),
  activated AS (
    SELECT (ap.activated_at AT TIME ZONE 'utc')::date AS d,
           count(*)::bigint AS n_act,
           count(*) FILTER (WHERE ap.activated_via = 'key')::bigint AS n_key,
           count(*) FILTER (WHERE ap.activated_via LIKE 'oauth:%')::bigint AS n_oauth,
           count(*) FILTER (WHERE ap.activated_via IS NULL)::bigint AS n_unstamped
      FROM public.agent_passes ap
     WHERE ap.activated_at IS NOT NULL AND ap.activated_at >= v_from_ts
     GROUP BY 1
  ),
  act_via AS (
    SELECT x.d, jsonb_object_agg(x.via, x.n_via ORDER BY x.via) AS detail
      FROM (
        SELECT (ap.activated_at AT TIME ZONE 'utc')::date AS d,
               coalesce(ap.activated_via, 'unstamped') AS via,
               count(*)::bigint AS n_via
          FROM public.agent_passes ap
         WHERE ap.activated_at IS NOT NULL AND ap.activated_at >= v_from_ts
         GROUP BY 1, 2
      ) x
     GROUP BY 1
  ),
  searched AS (
    SELECT (e.at AT TIME ZONE 'utc')::date AS d,
           count(*)::bigint AS n_search,
           count(*) FILTER (WHERE e.results = 0)::bigint AS n_zero
      FROM public.job_board_search_events e
     WHERE e.caller = 'mcp' AND e.at >= v_from_ts
     GROUP BY 1
  )
  SELECT
    dd.d,
    coalesce(m.n_agent, 0)::bigint,
    coalesce(m.n_other, 0)::bigint,
    coalesce(ud.n_keys, 0)::bigint,
    coalesce(ud.n_calls, 0)::bigint,
    coalesce(ft.n_calls, 0)::bigint,
    coalesce(ft.detail, '{}'::jsonb),
    coalesce(fp.n_calls, 0)::bigint,
    coalesce(fp.detail, '{}'::jsonb),
    coalesce(fr.n_calls, 0)::bigint,
    coalesce(fr.detail, '{}'::jsonb),
    coalesce(uk.detail, '{}'::jsonb),
    coalesce(an.n_global, 0)::bigint,
    coalesce(an.n_addr, 0)::bigint,
    coalesce(an.addr_max, 0)::integer,
    coalesce(am.n_at_max, 0)::bigint,
    coalesce(s.n_sold, 0)::bigint,
    coalesce(a.n_act, 0)::bigint,
    coalesce(a.n_key, 0)::bigint,
    coalesce(a.n_oauth, 0)::bigint,
    coalesce(a.n_unstamped, 0)::bigint,
    coalesce(av.detail, '{}'::jsonb),
    coalesce(s.n_exhausted, 0)::bigint,
    coalesce(se.n_search, 0)::bigint,
    coalesce(se.n_zero, 0)::bigint
  FROM days dd
  LEFT JOIN minted m ON m.d = dd.d
  LEFT JOIN use_by_day ud ON ud.d = dd.d
  LEFT JOIN use_by_fam ft ON ft.d = dd.d AND ft.fam = 'tool'
  LEFT JOIN use_by_fam fp ON fp.d = dd.d AND fp.fam = 'prompt'
  LEFT JOIN use_by_fam fr ON fr.d = dd.d AND fr.fam = 'resource'
  LEFT JOIN use_by_key uk ON uk.d = dd.d
  LEFT JOIN unkeyed an ON an.d = dd.d
  LEFT JOIN anon_at_max am ON am.d = dd.d
  LEFT JOIN sold s ON s.d = dd.d
  LEFT JOIN activated a ON a.d = dd.d
  LEFT JOIN act_via av ON av.d = dd.d
  LEFT JOIN searched se ON se.d = dd.d
  ORDER BY dd.d DESC;
END;
$$;

COMMENT ON FUNCTION public.agent_adoption_metrics(integer) IS
  'Per UTC day over the last p_days (newest first): agent keys minted vs other keys, distinct keys active on the MCP endpoints, MCP calls by family (tool / prompt / resource) with a per-name jsonb detail and a per-key jsonb detail (by key_prefix), the unkeyed tier''s global row vs its address rows (allowed calls only -- the meter never records a refusal), passes sold / activated (by activated_via) / exhausted, and MCP-caller searches. Zeros and empty objects on an empty day. Service-role only; reads five tables, writes none.';

REVOKE ALL ON FUNCTION public.agent_adoption_metrics(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_adoption_metrics(integer) TO service_role;

DO $$
DECLARE
  r record;
  v_n integer;
BEGIN
  FOR r IN
    SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'agent_adoption_metrics'
       AND pg_get_function_identity_arguments(p.oid) <> 'p_days integer'
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.oid::regprocedure;
  END LOOP;

  SELECT count(*) INTO v_n
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'agent_adoption_metrics';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'agent_adoption_metrics: expected exactly one signature, found %', v_n;
  END IF;
END
$$;