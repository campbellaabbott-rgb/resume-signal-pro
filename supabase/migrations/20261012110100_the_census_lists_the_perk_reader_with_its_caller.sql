-- THE CENSUS LISTS THE PERK READER WITH ITS CALLER.
--
-- client_callable_census() (20261004110000) is how a deploy proves which
-- SECURITY DEFINER functions the publishable key can run: every one must be
-- on a list, and a function no list names is counted as drift. 20261012110000
-- opens exactly one new function to anon and authenticated, the perk reader
-- get_employer_perks(text) (aggregates: per-perk counts of an employer's own
-- postings, with one quoted line, published keys only). This file re-issues
-- the census whole, from its 20261004110000 text, with that one signature
-- added to the anon list; src/test/helpers/client-callable-allowlist.ts names
-- the reader's caller beside it. Nothing else in the census changes: the
-- closed list, the signed-in list, the lane another group owns and the
-- closed tables are the same arrays, in the same shape
-- client_callable_unlisted_names() (20261008141000) reads.
--
-- Self-verifying, safe to re-run (CREATE OR REPLACE keeps the grants, which
-- are restated anyway).

SET LOCAL statement_timeout = '2min';

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
        'public.get_category_fill_curve(integer,integer)',
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
        'public.get_trending_categories()',
        'public.log_error_telemetry(text,text,text,integer,text,jsonb)',
        'public.log_industry_correction(text,text,text,text)',
        'public.log_industry_correction(text,text,text,text,integer,text[],text,text,text)',
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
        'public.client_write_budget'
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

COMMENT ON FUNCTION public.client_callable_census() IS
  'How many SECURITY DEFINER functions in public anon or authenticated can execute, how many of those '
  'no list in 20261004110000 (re-issued by 20261012110100 with the perk reader) describes, which of the closed ones '
  '(or the closed tables) are callable again, which signed-in-only one anon can call, and whether this request carried '
  'a platform address. INVOKER rights, catalogue reads only, names only from the repository''s own lists: '
  'safe for the publishable key, and the way a deploy is proved without calling a closed function.';

REVOKE ALL ON FUNCTION public.client_callable_census() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_callable_census() TO anon, authenticated, service_role;

DO $verify$
DECLARE
  c jsonb := public.client_callable_census();
BEGIN
  IF position('public.get_employer_perks(text)' IN pg_get_functiondef(to_regprocedure('public.client_callable_census()'))) = 0 THEN
    RAISE EXCEPTION 'the census does not list get_employer_perks';
  END IF;
  IF jsonb_array_length(c -> 'allowlisted_not_callable') <> 0 THEN
    RAISE EXCEPTION 'allowlisted but not callable: %', c ->> 'allowlisted_not_callable';
  END IF;
  IF jsonb_array_length(c -> 'closed_still_callable') <> 0 THEN
    RAISE EXCEPTION 'closed but client-callable: %', c ->> 'closed_still_callable';
  END IF;
  IF NOT has_function_privilege('anon', to_regprocedure('public.client_callable_census()'), 'EXECUTE') THEN
    RAISE EXCEPTION 'the census is not readable with the publishable key';
  END IF;
  IF (c ->> 'unlisted_client_callable')::int <> 0 THEN
    RAISE NOTICE 'client-callable census: % client-callable definer function(s) appear in no list (admin-ops client_callable_unlisted_names names them)', c ->> 'unlisted_client_callable';
  END IF;
  RAISE NOTICE 'client-callable census re-issued: % allowlisted, % closed', c ->> 'allowlisted', c ->> 'closed';
END
$verify$;
