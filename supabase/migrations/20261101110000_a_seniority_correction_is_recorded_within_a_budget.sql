-- A SENIORITY CORRECTION IS RECORDED, WITHIN A BUDGET (register S13-080).
--
-- The free report's "correct my experience level" control calls
-- log_seniority_correction with the publishable key
-- (src/components/FreeKeywordResults.tsx). 20260821030000 revoked EXECUTE
-- from anon and authenticated, deliberately ("a poisoning vector": an
-- unbounded anonymous write into a table meant to tune the classifier), and
-- added no server path, so every click since has been refused with 42501 and
-- recorded nothing; the page swallows the error. The definer-exposure rule
-- (a GRANT does not restrict; an anon-callable write is an abuse surface)
-- says how it may open again, and this file does exactly that:
--
--   * validated: both levels must be one of entry, mid, senior, executive,
--     and differ (a "correction" to the level detected is no correction);
--   * bounded: every text field is capped, the visitor id is kept only in
--     visitor-id form (as log_error_telemetry keeps it), the résumé length
--     only inside 0..1,000,000; the hourly ceiling bounds the table's growth
--     (no sweep: a correction is training signal, and deleting it is not
--     this file's call);
--   * rate-limited: client_write_allowed('seniority-correction', 20, 300, 60),
--     the census's per-address budget with a ceiling a rotating pool still
--     meets (20 per address and 300 in all an hour), keyed on the platform's
--     address, never on a value the caller passes;
--   * write-only: it answers true or false and returns no row.
--
-- The table itself gives a client role nothing (Supabase's default grants
-- gave anon and authenticated ALL on it at creation; RLS alone held it), and
-- the census is re-issued whole, from its 20261012110100 text, with the
-- function on the anon list and the table on the closed-tables list;
-- src/test/helpers/client-callable-allowlist.ts names the caller beside it.
-- Signature, parameter names, defaults and return type are unchanged, so
-- CREATE OR REPLACE keeps the oid and the page's call works as written.
--
-- Self-verifying, safe to re-run.

SET LOCAL statement_timeout = '2min';

DO $preflight$
BEGIN
  IF to_regprocedure('public.client_write_allowed(text,integer,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'apply 20261004110000 (client_write_allowed) before 20261101110000: the correction would open with no budget';
  END IF;
  IF to_regclass('public.seniority_corrections') IS NULL THEN
    RAISE EXCEPTION 'public.seniority_corrections is missing: 20260702170000 created it';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.log_seniority_correction(
  p_detected_level text,
  p_corrected_level text,
  p_detected_years text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_resume_text_length integer DEFAULT NULL,
  p_visitor_id text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_detected_level IS NULL OR p_corrected_level IS NULL
     OR p_detected_level NOT IN ('entry', 'mid', 'senior', 'executive')
     OR p_corrected_level NOT IN ('entry', 'mid', 'senior', 'executive')
     OR p_detected_level = p_corrected_level THEN
    RETURN false;
  END IF;
  IF NOT public.client_write_allowed('seniority-correction', 20, 300, 60) THEN
    RETURN false;
  END IF;
  INSERT INTO public.seniority_corrections
    (detected_level, corrected_level, detected_years, industry, resume_text_length, visitor_id)
  VALUES (
    p_detected_level,
    p_corrected_level,
    left(p_detected_years, 40),
    left(lower(trim(p_industry)), 60),
    CASE WHEN p_resume_text_length BETWEEN 0 AND 1000000 THEN p_resume_text_length END,
    CASE WHEN p_visitor_id ~ '^[A-Za-z0-9_-]{1,64}$' THEN p_visitor_id END
  );
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.log_seniority_correction(text, text, text, text, integer, text) IS
  'The free report''s experience-level correction (FreeKeywordResults.tsx): validated levels that differ, '
  'every field capped, client_write_allowed(''seniority-correction'', 20, 300, 60), '
  'returns true/false only (20261101110000, register S13-080).';

REVOKE ALL ON FUNCTION public.log_seniority_correction(text, text, text, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_seniority_correction(text, text, text, text, integer, text) TO anon, authenticated, service_role;

REVOKE ALL ON TABLE public.seniority_corrections FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.seniority_corrections TO service_role;

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

COMMENT ON FUNCTION public.client_callable_census() IS
  'How many SECURITY DEFINER functions in public anon or authenticated can execute, how many of those '
  'no list in 20261004110000 (re-issued by 20261012110100 with the perk reader, and by 20261101110000 with the '
  'seniority correction and its table) describes, which of the closed ones (or the closed tables) are callable '
  'again, which signed-in-only one anon can call, and whether this request carried a platform address. INVOKER '
  'rights, catalogue reads only, names only from the repository''s own lists: safe for the publishable key, and '
  'the way a deploy is proved without calling a closed function.';

REVOKE ALL ON FUNCTION public.client_callable_census() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_callable_census() TO anon, authenticated, service_role;

DO $verify$
DECLARE
  c jsonb := public.client_callable_census();
  f regprocedure := to_regprocedure('public.log_seniority_correction(text,text,text,text,integer,text)');
  body text;
BEGIN
  IF f IS NULL THEN
    RAISE EXCEPTION 'log_seniority_correction is missing';
  END IF;
  body := pg_get_functiondef(f);
  IF position('client_write_allowed(''seniority-correction''' IN body) = 0 THEN
    RAISE EXCEPTION 'log_seniority_correction writes with no budget';
  END IF;
  IF NOT has_function_privilege('anon', f, 'EXECUTE') OR NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'log_seniority_correction is not callable with the publishable key: the page''s control still records nothing';
  END IF;
  IF has_table_privilege('anon', 'public.seniority_corrections', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('authenticated', 'public.seniority_corrections', 'SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'a client role can still reach public.seniority_corrections directly';
  END IF;
  -- Validation runs before the budget, so these refusals spend nothing and write nothing.
  IF public.log_seniority_correction('mid', 'mid') OR public.log_seniority_correction('junior', 'senior')
     OR public.log_seniority_correction(NULL, 'senior') THEN
    RAISE EXCEPTION 'log_seniority_correction accepted a level that is not one, or a correction to the level detected';
  END IF;
  IF position('public.log_seniority_correction(text,text,text,text,integer,text)' IN pg_get_functiondef(to_regprocedure('public.client_callable_census()'))) = 0 THEN
    RAISE EXCEPTION 'the census does not list log_seniority_correction';
  END IF;
  IF jsonb_array_length(c -> 'allowlisted_not_callable') <> 0 THEN
    RAISE EXCEPTION 'allowlisted but not callable: %', c ->> 'allowlisted_not_callable';
  END IF;
  IF jsonb_array_length(c -> 'closed_still_callable') <> 0 THEN
    RAISE EXCEPTION 'closed but client-callable: %', c ->> 'closed_still_callable';
  END IF;
  IF jsonb_array_length(c -> 'closed_tables_still_open') <> 0 THEN
    RAISE EXCEPTION 'closed tables a client role can reach: %', c ->> 'closed_tables_still_open';
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

NOTIFY pgrst, 'reload schema';
