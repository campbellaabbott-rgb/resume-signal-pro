-- SUB-HOURLY CRON REVIEW MARKER: not required. This file schedules nothing
-- (reviewed 2026-11-16 in the bug round A integration).
--
-- A TABLE ONLY THE SERVER READS ANSWERS ONLY THE SERVER (NB-13).
--
-- Supabase gives anon and authenticated ALL on every new table in public.
-- Fifty-two tables that no browser, no signed-in client and no invoker
-- function reads (affiliate session tokens, API keys, the purchase and
-- subscription records, the search log, the scan logs) are private today only
-- because row-level security answers an empty list. One policy that lets
-- every row through, or RLS switched off by a later migration, opens a table
-- to anyone holding the publishable key, and no deploy check sweeps them.
--
-- WHAT THIS DOES. For each table below that exists: REVOKE ALL from PUBLIC,
-- anon and authenticated, by name, and GRANT ALL to service_role. A GET with
-- the publishable key then answers 42501 instead of an empty list. RLS stays
-- on as a second wall.
--
-- WHAT IT LEAVES, AND WHY.
--   used_stripe_sessions, purchased_content, product_deliveries: the main
--   verifier's section 7f reads their columns as anon and wants HTTP 200;
--   they close in the round that changes that line.
--   The account's own tables (user_scans, user_profiles, the agent and
--   shortlist tables): authenticated reads them under owner RLS, and the
--   pages call them from 71 places, some of which run signed out (the board's
--   saved-search pills); anon turning an empty answer into an error there is a
--   change to audit page by page, not in a grant sweep.
--
-- HOW IT WAS CHOSEN. A table is listed only when nothing but the service role
-- reads or writes it: no .from() in src/ or worker/, every edge function that
-- names it builds a service-role client, no INVOKER function or view reads
-- it, and no trigger on a client-written table writes it as the client.
--
-- AND ONE READER, client_table_grants(): every table and view in public on
-- which anon or authenticated holds any privilege, so a deploy check can read
-- the whole picture in one anon call instead of probing table by table. It is
-- an INVOKER function over the catalogue (names only, no rows) and is the
-- marker that this file applied: before it, the call answers PGRST202.
--
-- Safe to re-run: REVOKE and GRANT are idempotent, CREATE OR REPLACE, every
-- table looked up with to_regclass first. The self-check RAISEs, which rolls
-- the whole file back.

DO $$
DECLARE
  v_t text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY[
    'ab_test_events', 'affiliate_clicks', 'affiliate_conversions', 'affiliate_sessions', 'affiliates',
    'agent_subscribers', 'agent_worker_heartbeat', 'ai_response_cache', 'alert_log',
    'api_keys', 'api_quota', 'api_rate', 'api_usage', 'cohort_weekly_reports', 'company_claims',
    'detection_telemetry', 'email_logs', 'email_send_log', 'email_send_state', 'email_unsubscribe_tokens',
    'free_scan_leads',
    'job_board_board_state', 'job_board_board_watch', 'job_board_click_rollup', 'job_board_closures',
    'job_board_company_dim_snapshots', 'job_board_company_flow', 'job_board_embeddings', 'job_board_exit_rollup',
    'job_board_exits', 'job_board_field_changes', 'job_board_pool_samples', 'job_board_posting_reports',
    'job_board_search_clicks', 'job_board_search_events', 'job_board_search_misses', 'job_board_search_rollup',
    'parse_failures', 'payment_failures', 'pro_grants', 'pro_subscribers', 'rate_limits', 'resume_analyses',
    'scan_feedback', 'scan_industry_pins', 'scan_metrics', 'scan_outcomes', 'scan_report_cache', 'scan_slots',
    'suppressed_emails', 'temp_resume_storage', 'webhook_events'
  ] LOOP
    IF to_regclass('public.' || v_t) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_t);
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_t);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.client_table_grants()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'anon', coalesce((
      SELECT jsonb_agg(c.relname::text ORDER BY c.relname)
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND (pg_catalog.has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE')
             OR pg_catalog.has_table_privilege('anon', c.oid, 'DELETE, TRUNCATE'))
    ), '[]'::jsonb),
    'authenticated', coalesce((
      SELECT jsonb_agg(c.relname::text ORDER BY c.relname)
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND (pg_catalog.has_any_column_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE')
             OR pg_catalog.has_table_privilege('authenticated', c.oid, 'DELETE, TRUNCATE'))
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.client_table_grants() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_table_grants() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.client_table_grants() IS
  'NB-13: the tables and views in public on which anon or authenticated holds any privilege, by name (no rows). An INVOKER reader over the catalogue for deploy checks. 20261112102000.';

DO $$
DECLARE
  v_open text;
  v_fn oid := to_regprocedure('public.client_table_grants()');
BEGIN
  SELECT string_agg(v_t, ', ') INTO v_open
  FROM unnest(ARRAY[
    'ab_test_events', 'affiliate_clicks', 'affiliate_conversions', 'affiliate_sessions', 'affiliates',
    'agent_subscribers', 'agent_worker_heartbeat', 'ai_response_cache', 'alert_log',
    'api_keys', 'api_quota', 'api_rate', 'api_usage', 'cohort_weekly_reports', 'company_claims',
    'detection_telemetry', 'email_logs', 'email_send_log', 'email_send_state', 'email_unsubscribe_tokens',
    'free_scan_leads',
    'job_board_board_state', 'job_board_board_watch', 'job_board_click_rollup', 'job_board_closures',
    'job_board_company_dim_snapshots', 'job_board_company_flow', 'job_board_embeddings', 'job_board_exit_rollup',
    'job_board_exits', 'job_board_field_changes', 'job_board_pool_samples', 'job_board_posting_reports',
    'job_board_search_clicks', 'job_board_search_events', 'job_board_search_misses', 'job_board_search_rollup',
    'parse_failures', 'payment_failures', 'pro_grants', 'pro_subscribers', 'rate_limits', 'resume_analyses',
    'scan_feedback', 'scan_industry_pins', 'scan_metrics', 'scan_outcomes', 'scan_report_cache', 'scan_slots',
    'suppressed_emails', 'temp_resume_storage', 'webhook_events'
  ]) AS v_t
  WHERE to_regclass('public.' || v_t) IS NOT NULL
    AND (has_any_column_privilege('anon', to_regclass('public.' || v_t), 'SELECT, INSERT, UPDATE')
         OR has_table_privilege('anon', to_regclass('public.' || v_t), 'DELETE, TRUNCATE')
         OR has_any_column_privilege('authenticated', to_regclass('public.' || v_t), 'SELECT, INSERT, UPDATE')
         OR has_table_privilege('authenticated', to_regclass('public.' || v_t), 'DELETE, TRUNCATE')
         OR NOT has_table_privilege('service_role', to_regclass('public.' || v_t), 'SELECT, INSERT, UPDATE, DELETE'));
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION '20261112102000: still open to a client role, or closed to the service role: %', v_open;
  END IF;

  IF v_fn IS NULL THEN
    RAISE EXCEPTION '20261112102000: client_table_grants() is missing';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_fn) THEN
    RAISE EXCEPTION '20261112102000: client_table_grants must run as its caller, not as its owner';
  END IF;
  IF NOT has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '20261112102000: the deploy check cannot read client_table_grants as anon';
  END IF;
END $$;
