-- lovable-cron-fallback-reviewed: no cron; this file schedules nothing and changes no job: the hourly stats cache keeps computing the field curve as its own function's owner (reviewed 2026-11-17 in the bug round B, lane data-pages-b).
--
-- A FIELD CURVE NO PAGE CALLS ANSWERS ONLY THE SERVICE ROLE (CW2-SC5).
--
-- get_category_fill_curve(integer, integer) is the field table's curve: a
-- SECURITY DEFINER read over the whole closure ledger with a five-minute
-- header (20261112192500, S14X-066). Since 20260928004823 no page calls it:
-- every page that shows the curve (src/lib/fill-curve-cache.ts) and /v1/stats
-- read its rows from the hourly stats cache, which refresh_stats_cache
-- (SECURITY DEFINER) computes as its owner. It stayed granted to anon and
-- authenticated all the same, so anyone holding the publishable key could
-- start a five-minute statement on the pooled connections the board and the
-- scans share, as often as they liked; a client that gives up does not
-- cancel the statement on the server.
-- Live 2026-11-17 the census listed it allowlisted and callable by anon.
--
-- 1. The function is closed to PUBLIC, anon and authenticated and granted to
--    service_role, by its exact signature, after the catalogue was read for
--    it: when the signature is missing nothing is closed and the file stops.
--    The revokes are a signature loop, so this file names no function it
--    does not define in the form the guards read as a definition (the curve's
--    live definition stays 20261112192500's).
-- 2. client_callable_census() is re-issued whole from 20261112191000 with
--    that one row gone from its anon allowlist. Otherwise the census would
--    report a function closed on purpose as allowlisted_not_callable, which
--    40-db-exposure and two other verify sections hold empty. Every other
--    entry is 20261112191000's, letter for letter.
-- 3. The end state is read back: neither client role can execute the curve,
--    service_role can, PUBLIC holds no grant, the owner of
--    refresh_stats_cache can still execute it (the cache is the curve's only
--    caller), and the census names it nowhere.
--
-- Safe to re-run: the revokes and grants are idempotent and the census is a
-- CREATE OR REPLACE of the same text.

-- 1. close the curve to the publishable key, by signature.
DO $close$
DECLARE
  v_close text[] := ARRAY['public.get_category_fill_curve(integer,integer)']::text[];
  s       text;
BEGIN
  FOREACH s IN ARRAY v_close LOOP
    IF to_regprocedure(s) IS NULL THEN
      RAISE EXCEPTION 'CW2-SC5: % is not in the catalogue; nothing was closed', s;
    END IF;
  END LOOP;
  FOREACH s IN ARRAY v_close LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', to_regprocedure(s));
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', to_regprocedure(s));
  END LOOP;
END
$close$;

-- 2. the census no longer lists the curve as open to anon.
CREATE OR REPLACE FUNCTION public.client_callable_census()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $census$
  WITH lists AS (
    SELECT
      ARRAY[
        'public.agent_cancel_pending(bigint)',
        'public.agent_confirmation_gaps(integer)',
        'public.agent_employer_in_cooldown(uuid,text,integer)',
        'public.agent_fill_gaps(integer)',
        'public.agent_sent_today(uuid)',
        'public.board_serving_count()',
        'public.build_missing_since_index_oneshot()',
        'public.build_sitemap_day_index_oneshot()',
        'public.check_user_health(text)',
        'public.cleanup_expired_cache()',
        'public.compare_cohorts(text,text,text,integer)',
        'public.detect_user_error_spikes(integer,integer,integer)',
        'public.email_delivery_health(integer)',
        'public.get_affiliate_stats_by_date(text,date,date)',
        'public.get_ai_generation_metrics_hourly(integer)',
        'public.get_ai_quality_stats(integer)',
        'public.get_apply_hosts()',
        'public.get_cached_response(text,text)',
        'public.get_category_fill_speed(integer,integer)',
        'public.get_checkout_funnel(integer)',
        'public.get_closure_population()',
        'public.get_db_size_stats()',
        'public.get_delivery_health(integer)',
        'public.get_email_health(integer)',
        'public.get_email_metrics_hourly(integer)',
        'public.get_employer_benchmarks(integer,integer,integer)',
        'public.get_error_diagnostics(integer)',
        'public.get_function_error_rates(integer)',
        'public.get_geo_latency_stats(integer)',
        'public.get_industry_detection_breakdown(integer)',
        'public.get_industry_detection_recent(integer)',
        'public.get_industry_detection_stats(integer)',
        'public.get_job_board_facets_cached()',
        'public.get_newest_companies(integer)',
        'public.get_parse_failure_stats(integer)',
        'public.get_payment_health(integer)',
        'public.get_rate_limit_stats(integer)',
        'public.get_repost_churn_companies(integer)',
        'public.get_scan_metrics_hourly(integer)',
        'public.get_size_segment_companies(text,integer,integer)',
        'public.get_stale_board_count()',
        'public.get_stalest_boards(integer,integer,text[])',
        'public.get_trending_companies(integer)',
        'public.get_user_score_trend(text)',
        'public.get_visitor_error_history(text)',
        'public.get_webhook_health(integer)',
        'public.get_webhook_metrics_hourly(integer)',
        'public.log_alert_sent(text,text,numeric,numeric,text,boolean)',
        'public.log_industry_detection(integer,text,text,text,text,text,text,integer,text[],text,text,text,text,boolean,boolean,jsonb,integer,text[],integer,boolean)',
        'public.log_parse_failure(text,text,text,integer,text,jsonb)',
        'public.product_delivery_health(integer)',
        'public.save_free_scan_lead(text,text,integer)',
        'public.should_generate_weekly_report()',
        'public.should_send_alert(text,text,integer)',
        'public.store_cached_response(text,text,jsonb,integer)',
        'public.store_temp_resume(text,text)'
      ]::text[] AS closed,
      ARRAY[
        'public.agent_sender_public_status()',
        'public.delete_analysis_by_share_id(text)',
        'public.get_actively_hiring_companies(integer)',
        'public.get_affiliate_clicks(text,integer)',
        'public.get_affiliate_dashboard(text)',
        'public.get_analysis_by_share_id(text)',
        'public.get_audit_result()',
        'public.get_board_anon_hourly(integer)',
        'public.get_board_anon_networks(integer,integer)',
        'public.get_board_flow(integer)',
        'public.get_board_vendor_counts()',
        'public.get_company_claim_status(text)',
        'public.get_company_fill_curve(text[])',
        'public.get_company_financials(text)',
        'public.get_company_growth(text[])',
        'public.get_company_hiring_health(text[])',
        'public.get_company_intel(text)',
        'public.get_company_suggest(text)',
        'public.get_country_facet()',
        'public.get_cron_health(integer)',
        'public.get_employer_layoff_filings(text[])',
        'public.get_employer_layoff_filings_all(text)',
        'public.get_employer_lca_wages(text[],text,text)',
        'public.get_employer_perks(text)',
        'public.get_entry_level_companies(integer)',
        'public.get_entry_level_stats()',
        'public.get_explore_cache()',
        'public.get_funnel_cohort_stats(text,integer)',
        'public.get_ghost_job_index_stats()',
        'public.get_hiring_trends()',
        'public.get_industry_correction_stats(integer)',
        'public.get_industry_score_benchmark(text,integer,integer,integer)',
        'public.get_job_board_facets()',
        'public.get_layoff_partition()',
        'public.get_lca_load_state()',
        'public.get_ontario_posting_disclosures(text)',
        'public.get_public_scan_insights()',
        'public.get_real_score_distribution(text)',
        'public.get_salary_benchmarks()',
        'public.get_scan_geo_stats(integer)',
        'public.get_scan_health_status()',
        'public.get_scan_success_rate(integer,text)',
        'public.get_scan_totals()',
        'public.get_similar_companies(text,integer)',
        'public.get_stats_cache()',
        'public.get_takedowns_today()',
        'public.get_temp_resume(text)',
        'public.get_today_scan_count()',
        'public.get_transparency_cache()',
        'public.get_trending_categories(integer)',
        'public.log_error_telemetry(text,text,text,integer,text,jsonb)',
        'public.log_industry_correction(text,text,text,text)',
        'public.log_industry_correction(text,text,text,text,integer,text[],text,text,text)',
        'public.log_seniority_correction(text,text,text,text,integer,text)',
        'public.login_affiliate(text,text)',
        'public.logout_affiliate(text)',
        'public.record_scan_feedback(text,boolean,text,integer,boolean,integer,text)',
        'public.record_scan_outcome(text,text,text)',
        'public.register_affiliate(text,text)',
        'public.store_temp_resume(text,text,text)',
        'public.track_affiliate_click(text,text,text,text)'
      ]::text[] AS allow_anon,
      ARRAY[
        'public.agent_sender_online(integer)',
        'public.get_application_lifecycle(text[])'
      ]::text[] AS allow_auth,
      ARRAY[
        'public.get_scan_credits(text)',
        'public.use_scan_credit(text)'
      ]::text[] AS elsewhere,
      ARRAY[
        'public.job_board_verifications',
        'public.job_board_closure_rollup',
        'public.error_telemetry',
        'public.industry_detection_metrics',
        'public.client_write_budget',
        'public.seniority_corrections'
      ]::text[] AS closed_tables
  ),
  listed AS (
    SELECT array_remove(ARRAY(
      SELECT to_regprocedure(x)::oid
      FROM lists, unnest(lists.closed || lists.allow_anon || lists.allow_auth || lists.elsewhere) AS x
    ), NULL) AS oids
  ),
  definers AS (
    SELECT p.oid,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.prosecdef
      AND p.prorettype <> 'trigger'::regtype
  ),
  closed_state AS (
    SELECT x AS sig, to_regprocedure(x) AS f
    FROM lists, unnest(lists.closed) AS x
  ),
  allowed_state AS (
    SELECT x AS sig, to_regprocedure(x) AS f, true AS for_anon
    FROM lists, unnest(lists.allow_anon) AS x
    UNION ALL
    SELECT x, to_regprocedure(x), false
    FROM lists, unnest(lists.allow_auth) AS x
  )
  SELECT jsonb_build_object(
    'definers', (SELECT count(*) FROM definers),
    'client_callable', (SELECT count(*) FROM definers WHERE anon_x OR auth_x),
    'unlisted_client_callable', (SELECT count(*) FROM definers, listed
                                 WHERE (anon_x OR auth_x) AND NOT (definers.oid = ANY (listed.oids))),
    'closed', (SELECT count(*) FROM closed_state),
    'closed_missing', (SELECT count(*) FROM closed_state WHERE f IS NULL),
    'closed_still_callable', (SELECT COALESCE(jsonb_agg(sig ORDER BY sig), '[]'::jsonb) FROM closed_state
                              WHERE f IS NOT NULL
                                AND (has_function_privilege('anon', f, 'EXECUTE')
                                     OR has_function_privilege('authenticated', f, 'EXECUTE'))),
    'allowlisted', (SELECT count(*) FROM allowed_state),
    'allowlisted_not_callable', (SELECT COALESCE(jsonb_agg(sig ORDER BY sig), '[]'::jsonb) FROM allowed_state
                                 WHERE f IS NULL
                                    OR NOT has_function_privilege('authenticated', f, 'EXECUTE')
                                    OR (for_anon AND NOT has_function_privilege('anon', f, 'EXECUTE'))),
    'signed_in_only_open_to_anon', (SELECT COALESCE(jsonb_agg(sig ORDER BY sig), '[]'::jsonb) FROM allowed_state
                                    WHERE f IS NOT NULL AND NOT for_anon
                                      AND has_function_privilege('anon', f, 'EXECUTE')),
    'request_address_source', (SELECT CASE
                                 WHEN NULLIF(btrim(h.v ->> 'cf-connecting-ip'), '') IS NOT NULL THEN 'cf'
                                 WHEN NULLIF(btrim(h.v ->> 'x-forwarded-for'), '') IS NOT NULL THEN 'xff'
                                 ELSE 'none' END
                               FROM (SELECT NULLIF(current_setting('request.headers', true), '')::json AS v) h),
    'closed_tables_still_open', (SELECT COALESCE(jsonb_agg(t ORDER BY t), '[]'::jsonb) FROM lists, unnest(lists.closed_tables) AS t
                                 WHERE to_regclass(t) IS NULL
                                    OR has_table_privilege('anon', to_regclass(t), 'SELECT, INSERT, UPDATE, DELETE')
                                    OR has_table_privilege('authenticated', to_regclass(t), 'SELECT, INSERT, UPDATE, DELETE'))
  )
$census$;

REVOKE ALL ON FUNCTION public.client_callable_census() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_callable_census() TO anon, authenticated, service_role;

-- 3. the end state, read back.
DO $verify$
DECLARE
  f       regprocedure := to_regprocedure('public.get_category_fill_curve(integer,integer)');
  cache   regprocedure := to_regprocedure('public.refresh_stats_cache()');
  v_owner oid;
  census  text;
BEGIN
  IF f IS NULL THEN
    RAISE EXCEPTION 'CW2-SC5: get_category_fill_curve(integer, integer) is missing';
  END IF;
  IF has_function_privilege('anon', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'CW2-SC5: anon can still execute get_category_fill_curve';
  END IF;
  IF has_function_privilege('authenticated', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'CW2-SC5: authenticated can still execute get_category_fill_curve';
  END IF;
  IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'CW2-SC5: service_role lost get_category_fill_curve';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = f AND a.grantee = 0) THEN
    RAISE EXCEPTION 'CW2-SC5: get_category_fill_curve is still granted to PUBLIC';
  END IF;
  IF cache IS NOT NULL THEN
    SELECT p.proowner INTO v_owner FROM pg_proc p WHERE p.oid = cache;
    IF NOT has_function_privilege(v_owner, f, 'EXECUTE') THEN
      RAISE EXCEPTION 'CW2-SC5: the owner of refresh_stats_cache cannot execute get_category_fill_curve, so the hourly cache would stop computing the field curve';
    END IF;
  END IF;
  SELECT p.prosrc INTO census FROM pg_proc p WHERE p.oid = 'public.client_callable_census()'::regprocedure;
  IF position('get_category_fill_curve' IN census) > 0 THEN
    RAISE EXCEPTION 'CW2-SC5: the census still lists get_category_fill_curve';
  END IF;
  IF (public.client_callable_census() -> 'allowlisted_not_callable') ? 'public.get_category_fill_curve(integer,integer)' THEN
    RAISE EXCEPTION 'CW2-SC5: the census reports get_category_fill_curve as allowlisted but not callable';
  END IF;
END $verify$;

NOTIFY pgrst, 'reload schema';
