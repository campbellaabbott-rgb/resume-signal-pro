-- EVERY FUNCTION A STRANGER CAN CALL IS NAMED, WITH THE CALLER THAT NEEDS IT.
--
-- WHAT WAS WRONG. The publishable key ships in the frontend bundle, so a
-- SECURITY DEFINER function that anon or authenticated may execute is a
-- function anyone on the internet runs as its owner, straight through every
-- RLS lock. Supabase grants EXECUTE on every new function in public to anon
-- and authenticated directly (and Postgres to PUBLIC), so a function is open
-- unless somebody closed it by name. Replaying this folder in order (every
-- create, drop, grant and revoke; src/test/helpers/function-acl.ts) found 121
-- client-callable definer functions on main. Among them:
--
--   get_delivery_health       every failed purchase's customer email and Stripe
--                             checkout session id, for any window the caller
--                             chose (the LIMIT sat after the aggregate). The
--                             session id is the bearer token verify-product-
--                             purchase accepts for the buyer's generated
--                             content. (register 1.25)
--   log_alert_sent            an insert into the ledger the alert monitor reads
--                             for its cooldown: twenty anonymous calls a day
--                             kept every critical alert from being emailed.
--                             (register 1.65)
--   get_payment_health        Stripe payment_intent ids, decline messages and
--   get_rate_limit_stats      amounts; visitor ids of rate-limited callers;
--   detect_user_error_spikes  visitor ids with their error streams. (2.21)
--   store_cached_response     anyone could write the AI response cache.
--   save_free_scan_lead       anyone could add any address to the lead list.
--   build_*_index_oneshot     anonymous CREATE INDEX and cron.unschedule.
--   agent_confirmation_gaps   employer confirmation-page wording, which quotes
--                             applicants' names.
--   get_funnel_cohort_stats   grouped funnel counts by ANY metadata key the
--                             caller named, so every full referrer URL and
--                             every per-visitor funnel session id was
--                             enumerable. (Stripe ids in purchase events were
--                             spared only because the result requires a
--                             landing view in the same cohort.)
--
-- Four tables were also readable or writable with the publishable key for no
-- caller: the whole crawl catalogue (job_board_verifications), the closure
-- ledger's monthly rollup, and direct INSERT into two telemetry tables.
--
-- WHAT THIS DOES.
--   1. The two functions whose output was the leak are redefined first, same
--      signature and return type (grants are kept by CREATE OR REPLACE):
--      the delivery reader masks the email, replaces the session id with a
--      10-character digest, scrubs addresses out of the error text, clamps
--      the window to a week and limits BEFORE aggregating; the cohort reader
--      accepts only the eight dimensions its callers use.
--   2. 56 signatures are revoked from PUBLIC, anon and authenticated BY EXACT
--      SIGNATURE and granted to service_role. Every one was checked against
--      every caller: the browser (src/, generated types excluded), scripts run
--      with the publishable key, the worker, and edge functions -- each of
--      which reaches these through the service role. The operations dashboards
--      that called them from the browser now go through the admin-ops edge
--      function, which checks the ADMIN_API_KEY before calling them with the
--      service role. A signature that does not exist RAISES before anything
--      is revoked: a revoke that silently matched nothing is the failure this
--      repository has shipped before.
--   3. Overloads of the same names that this folder never wrote (Lovable can
--      create functions directly) are closed by a catalogue loop.
--   4. The four tables are revoked from PUBLIC, anon and authenticated and
--      their open policies dropped.
--   5. client_callable_census(): an INVOKER function over the catalogue,
--      readable with the publishable key, that counts what is still open, so
--      a deploy is provable without calling any closed function (several of
--      them write).
--   6. A self-check that RAISES unless every closed signature is closed,
--      every allowlisted one still answers the roles its page uses, the two
--      redactions are live and the tables are shut -- and NOTICEs any other
--      client-callable definer function or open table the repository does
--      not describe.
--
-- THE ALLOWLIST is src/test/helpers/client-callable-allowlist.ts: 62 functions
-- with the file that calls each with a client key and what it returns
-- (aggregates, a capability's own rows, public records, bounded write-only
-- telemetry). The census test there fails if anything else becomes
-- client-callable, or if the arrays below drift from that file.
--
-- NOT TOUCHED: get_scan_credits and use_scan_credit (another lane owns them;
-- listed as such), trigger functions (PostgREST cannot call a function that
-- returns trigger), and INVOKER functions (they run under the caller's RLS).

-- ── 1. the two readers whose output was the leak ───────────────────────────

CREATE OR REPLACE FUNCTION public.get_delivery_health(p_hours_back integer DEFAULT 24)
RETURNS TABLE(
  total_orders INTEGER,
  fully_delivered INTEGER,
  generation_failed INTEGER,
  email_failed INTEGER,
  pending INTEGER,
  delivery_rate NUMERIC,
  avg_generation_time_ms NUMERIC,
  recent_failures JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(hours => LEAST(GREATEST(COALESCE(p_hours_back, 24), 1), 168));
BEGIN
  RETURN QUERY
  WITH stats AS (
    SELECT
      COUNT(*)::INTEGER AS n_total,
      COUNT(*) FILTER (WHERE d.status = 'delivered')::INTEGER AS n_delivered,
      COUNT(*) FILTER (WHERE d.status = 'generation_failed')::INTEGER AS n_gen_failed,
      COUNT(*) FILTER (WHERE d.status = 'email_failed')::INTEGER AS n_mail_failed,
      COUNT(*) FILTER (WHERE d.status IN ('payment_received', 'generating', 'generated'))::INTEGER AS n_in_progress,
      AVG(d.generation_duration_ms) FILTER (WHERE d.generation_success = true) AS avg_gen_time
    FROM public.product_deliveries d
    WHERE d.created_at >= v_since
  ),
  last_failures AS (
    SELECT d.stripe_session_id AS sid, d.customer_email AS addr, d.product_name AS product,
           d.status AS state, COALESCE(d.generation_error, d.email_error) AS err, d.created_at AS at
    FROM public.product_deliveries d
    WHERE d.created_at >= v_since
      AND d.status IN ('generation_failed', 'email_failed')
    ORDER BY d.created_at DESC
    LIMIT 10
  ),
  failures AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'session_ref', left(md5(COALESCE(f.sid, '')), 10),
        'email', CASE
          WHEN f.addr IS NULL OR position('@' in f.addr) = 0 THEN '***'
          ELSE left(split_part(f.addr, '@', 1), 2) || '***@' || split_part(f.addr, '@', 2)
        END,
        'product', f.product,
        'status', f.state,
        'error', public.scrub_emails(f.err),
        'created_at', f.at
      ) ORDER BY f.at DESC
    ), '[]'::jsonb) AS recent
    FROM last_failures f
  )
  SELECT
    stats.n_total,
    stats.n_delivered,
    stats.n_gen_failed,
    stats.n_mail_failed,
    stats.n_in_progress,
    CASE WHEN stats.n_total > 0
      THEN ROUND((stats.n_delivered::NUMERIC / stats.n_total) * 100, 1)
      ELSE 100
    END,
    ROUND(stats.avg_gen_time, 0),
    failures.recent
  FROM stats, failures;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_funnel_cohort_stats(
  p_cohort_dimension text DEFAULT 'trafficSource',
  p_days_back integer DEFAULT 7
)
RETURNS TABLE(
  cohort_value text,
  landing_view bigint,
  upload_started bigint,
  upload_completed bigint,
  scan_started bigint,
  scan_completed bigint,
  results_viewed bigint,
  product_clicked bigint,
  checkout_started bigint,
  purchase_completed bigint,
  upload_rate numeric,
  scan_rate numeric,
  view_rate numeric,
  checkout_rate numeric,
  conversion_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- The eight dimensions generate-cohort-report and verify-deploy ask for.
  -- Any other metadata key is refused, loudly: grouping by an arbitrary key
  -- turned this aggregate into a listing of whatever that key holds.
  IF p_cohort_dimension IS NULL OR NOT (p_cohort_dimension = ANY (ARRAY[
    'trafficSource', 'deviceType', 'browser', 'os', 'userType',
    'utmSource', 'utmMedium', 'utmCampaign'
  ])) THEN
    RAISE EXCEPTION 'get_funnel_cohort_stats: % is not a cohort dimension', COALESCE(p_cohort_dimension, 'NULL')
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH funnel_events AS (
    SELECT
      variant as stage,
      COALESCE(
        metadata->>p_cohort_dimension,
        'unknown'
      ) as cohort,
      visitor_id
    FROM ab_test_events
    WHERE test_name = 'conversion_funnel'
      AND created_at > NOW() - (p_days_back || ' days')::INTERVAL
  ),
  stage_counts AS (
    SELECT
      cohort,
      COUNT(DISTINCT visitor_id) FILTER (WHERE stage = 'landing_view') as landing_view,
      COUNT(DISTINCT visitor_id) FILTER (WHERE stage = 'upload_started') as upload_started,
      COUNT(DISTINCT visitor_id) FILTER (WHERE stage = 'upload_completed') as upload_completed,
      COUNT(DISTINCT visitor_id) FILTER (WHERE stage = 'scan_started') as scan_started,
      COUNT(DISTINCT visitor_id) FILTER (WHERE stage = 'scan_completed') as scan_completed,
      COUNT(DISTINCT visitor_id) FILTER (WHERE stage = 'results_viewed') as results_viewed,
      COUNT(DISTINCT visitor_id) FILTER (WHERE stage = 'product_clicked') as product_clicked,
      COUNT(DISTINCT visitor_id) FILTER (WHERE stage = 'checkout_started') as checkout_started,
      COUNT(DISTINCT visitor_id) FILTER (WHERE stage = 'purchase_completed') as purchase_completed
    FROM funnel_events
    GROUP BY cohort
  )
  SELECT
    sc.cohort as cohort_value,
    sc.landing_view,
    sc.upload_started,
    sc.upload_completed,
    sc.scan_started,
    sc.scan_completed,
    sc.results_viewed,
    sc.product_clicked,
    sc.checkout_started,
    sc.purchase_completed,
    CASE WHEN sc.landing_view > 0
      THEN ROUND((sc.upload_started::NUMERIC / sc.landing_view::NUMERIC) * 100, 2)
      ELSE 0 END as upload_rate,
    CASE WHEN sc.upload_completed > 0
      THEN ROUND((sc.scan_completed::NUMERIC / sc.upload_completed::NUMERIC) * 100, 2)
      ELSE 0 END as scan_rate,
    CASE WHEN sc.scan_completed > 0
      THEN ROUND((sc.results_viewed::NUMERIC / sc.scan_completed::NUMERIC) * 100, 2)
      ELSE 0 END as view_rate,
    CASE WHEN sc.product_clicked > 0
      THEN ROUND((sc.checkout_started::NUMERIC / sc.product_clicked::NUMERIC) * 100, 2)
      ELSE 0 END as checkout_rate,
    CASE WHEN sc.landing_view > 0
      THEN ROUND((sc.purchase_completed::NUMERIC / sc.landing_view::NUMERIC) * 100, 2)
      ELSE 0 END as conversion_rate
  FROM stage_counts sc
  WHERE sc.landing_view > 0
  ORDER BY sc.landing_view DESC;
END;
$$;

-- ── 2 and 3. close by exact signature; then the overloads nobody wrote ─────

DO $close$
DECLARE
  v_closed text[] := ARRAY[
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
  ]::text[];
  -- Every name above whose EVERY overload closes. store_temp_resume is not
  -- here: its three-argument form is the free scanner's and stays open.
  v_names text[] := ARRAY[
    'agent_cancel_pending', 'agent_confirmation_gaps', 'agent_employer_in_cooldown',
    'agent_fill_gaps', 'agent_sent_today', 'board_serving_count',
    'build_missing_since_index_oneshot', 'build_sitemap_day_index_oneshot',
    'check_user_health', 'cleanup_expired_cache', 'compare_cohorts',
    'detect_user_error_spikes', 'email_delivery_health', 'get_affiliate_stats_by_date',
    'get_ai_generation_metrics_hourly', 'get_ai_quality_stats', 'get_apply_hosts',
    'get_cached_response', 'get_category_fill_speed', 'get_checkout_funnel',
    'get_closure_population', 'get_db_size_stats', 'get_delivery_health',
    'get_email_health', 'get_email_metrics_hourly', 'get_employer_benchmarks',
    'get_error_diagnostics', 'get_function_error_rates', 'get_geo_latency_stats',
    'get_industry_detection_breakdown', 'get_industry_detection_recent',
    'get_industry_detection_stats', 'get_job_board_facets_cached', 'get_newest_companies',
    'get_parse_failure_stats', 'get_payment_health', 'get_rate_limit_stats',
    'get_repost_churn_companies', 'get_scan_metrics_hourly', 'get_size_segment_companies',
    'get_stale_board_count', 'get_stalest_boards', 'get_trending_companies',
    'get_user_score_trend', 'get_visitor_error_history', 'get_webhook_health',
    'get_webhook_metrics_hourly', 'log_alert_sent', 'log_industry_detection',
    'log_parse_failure', 'product_delivery_health', 'save_free_scan_lead',
    'should_generate_weekly_report', 'should_send_alert', 'store_cached_response'
  ]::text[];
  v_missing text[] := '{}';
  s text;
  r record;
  n_drift integer := 0;
BEGIN
  -- Nothing is revoked until every signature is known to exist.
  FOREACH s IN ARRAY v_closed LOOP
    IF to_regprocedure(s) IS NULL THEN
      v_missing := v_missing || s;
    END IF;
  END LOOP;
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'client-callable census: % signature(s) this migration closes do not exist here: %',
      cardinality(v_missing), array_to_string(v_missing, ', ');
  END IF;

  FOREACH s IN ARRAY v_closed LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', to_regprocedure(s));
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', to_regprocedure(s));
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.proname = ANY (v_names)
      AND p.oid <> ALL (SELECT to_regprocedure(x)::oid FROM unnest(v_closed) AS x)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    n_drift := n_drift + 1;
    RAISE NOTICE 'client-callable census: closed an overload no migration wrote: %', r.sig;
  END LOOP;
  RAISE NOTICE 'client-callable census: % signature(s) closed by name, % unwritten overload(s) closed', cardinality(v_closed), n_drift;
END
$close$;

-- ── 4. the tables ───────────────────────────────────────────────────────────

REVOKE ALL ON TABLE public.job_board_verifications FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "job_board_verifications_public_read" ON public.job_board_verifications;
GRANT ALL ON TABLE public.job_board_verifications TO service_role;

REVOKE ALL ON TABLE public.job_board_closure_rollup FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "closure_rollup_public_read" ON public.job_board_closure_rollup;
GRANT ALL ON TABLE public.job_board_closure_rollup TO service_role;

REVOKE ALL ON TABLE public.error_telemetry FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Anyone can insert error telemetry" ON public.error_telemetry;
GRANT ALL ON TABLE public.error_telemetry TO service_role;

REVOKE ALL ON TABLE public.industry_detection_metrics FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Allow anonymous inserts" ON public.industry_detection_metrics;
GRANT ALL ON TABLE public.industry_detection_metrics TO service_role;

-- ── 5. the census a deploy is proved by ────────────────────────────────────

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
        'public.get_application_lifecycle(text[])',
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
        'public.agent_sender_online(integer)'
      ]::text[] AS allow_auth,
      ARRAY[
        'public.get_scan_credits(text)',
        'public.use_scan_credit(text)'
      ]::text[] AS elsewhere,
      ARRAY[
        'public.job_board_verifications',
        'public.job_board_closure_rollup',
        'public.error_telemetry',
        'public.industry_detection_metrics'
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
    'closed_tables_still_open', (SELECT COALESCE(jsonb_agg(t ORDER BY t), '[]'::jsonb) FROM lists, unnest(lists.closed_tables) AS t
                                 WHERE to_regclass(t) IS NULL
                                    OR has_table_privilege('anon', to_regclass(t), 'SELECT, INSERT, UPDATE, DELETE')
                                    OR has_table_privilege('authenticated', to_regclass(t), 'SELECT, INSERT, UPDATE, DELETE'))
  )
$census$;

COMMENT ON FUNCTION public.client_callable_census() IS
  'How many SECURITY DEFINER functions in public anon or authenticated can execute, how many of those '
  'no list in 20261004110000 describes, and which of the closed ones (or the four closed tables) are '
  'callable again. INVOKER rights, catalogue reads only, names only from the repository''s own lists: '
  'safe for the publishable key, and the way a deploy is proved without calling a closed function.';

REVOKE ALL ON FUNCTION public.client_callable_census() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_callable_census() TO anon, authenticated, service_role;

-- ── 6. the self-check ───────────────────────────────────────────────────────

DO $check$
DECLARE
  c jsonb := public.client_callable_census();
  v_allow_anon text[] := ARRAY[
    'public.agent_sender_public_status()',
    'public.get_job_board_facets()',
    'public.get_stats_cache()',
    'public.get_temp_resume(text)',
    'public.store_temp_resume(text,text,text)',
    'public.log_error_telemetry(text,text,text,integer,text,jsonb)',
    'public.get_funnel_cohort_stats(text,integer)'
  ]::text[];
  v_bad text[] := '{}';
  v_def text;
  s text;
  r record;
  v_drift text[] := '{}';
  v_open_tables text[] := '{}';
BEGIN
  -- Closed means closed: every closed signature exists, neither client role
  -- can execute it, and the service role still can.
  IF (c ->> 'closed_missing')::int <> 0 THEN
    v_bad := v_bad || format('%s closed signature(s) are missing', c ->> 'closed_missing');
  END IF;
  IF jsonb_array_length(c -> 'closed_still_callable') <> 0 THEN
    v_bad := v_bad || ('still client-callable: ' || (c ->> 'closed_still_callable'));
  END IF;
  FOR r IN
    SELECT x AS sig FROM unnest(ARRAY[
      'public.get_delivery_health(integer)', 'public.log_alert_sent(text,text,numeric,numeric,text,boolean)',
      'public.should_send_alert(text,text,integer)', 'public.get_payment_health(integer)',
      'public.get_rate_limit_stats(integer)', 'public.detect_user_error_spikes(integer,integer,integer)',
      'public.save_free_scan_lead(text,text,integer)', 'public.store_cached_response(text,text,jsonb,integer)'
    ]::text[]) AS x
  LOOP
    IF to_regprocedure(r.sig) IS NULL
       OR has_function_privilege('anon', to_regprocedure(r.sig), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.sig), 'EXECUTE')
       OR NOT has_function_privilege('service_role', to_regprocedure(r.sig), 'EXECUTE') THEN
      v_bad := v_bad || ('not closed to clients and open to service_role: ' || r.sig);
    END IF;
  END LOOP;

  -- Open means open: every allowlisted function answers the roles its page
  -- uses. A miss here is a page this migration would have broken.
  IF jsonb_array_length(c -> 'allowlisted_not_callable') <> 0 THEN
    v_bad := v_bad || ('allowlisted but not callable: ' || (c ->> 'allowlisted_not_callable'));
  END IF;
  FOREACH s IN ARRAY v_allow_anon LOOP
    IF to_regprocedure(s) IS NULL OR NOT has_function_privilege('anon', to_regprocedure(s), 'EXECUTE') THEN
      v_bad := v_bad || ('the publishable key lost: ' || s);
    END IF;
  END LOOP;
  IF to_regprocedure('public.agent_sender_online(integer)') IS NULL
     OR NOT has_function_privilege('authenticated', to_regprocedure('public.agent_sender_online(integer)'), 'EXECUTE')
     OR has_function_privilege('anon', to_regprocedure('public.agent_sender_online(integer)'), 'EXECUTE') THEN
    v_bad := v_bad || 'agent_sender_online must be signed-in only and callable signed in'::text;
  END IF;
  IF NOT has_function_privilege('anon', to_regprocedure('public.client_callable_census()'), 'EXECUTE') THEN
    v_bad := v_bad || 'the census is not readable with the publishable key'::text;
  END IF;

  -- The two redactions are the live definitions.
  v_def := pg_get_functiondef(to_regprocedure('public.get_delivery_health(integer)'));
  IF position('session_ref' in v_def) = 0 OR position('''session_id''' in v_def) > 0
     OR position('LIMIT 10' in v_def) = 0 OR position('168' in v_def) = 0 THEN
    v_bad := v_bad || 'get_delivery_health is not the redacted definition'::text;
  END IF;
  v_def := pg_get_functiondef(to_regprocedure('public.get_funnel_cohort_stats(text,integer)'));
  IF position('utmCampaign' in v_def) = 0 OR position('22023' in v_def) = 0 THEN
    v_bad := v_bad || 'get_funnel_cohort_stats does not refuse unknown dimensions'::text;
  END IF;

  -- The tables.
  IF jsonb_array_length(c -> 'closed_tables_still_open') <> 0 THEN
    v_bad := v_bad || ('tables still open to a client role: ' || (c ->> 'closed_tables_still_open'));
  END IF;
  IF NOT has_table_privilege('service_role', 'public.job_board_verifications', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.error_telemetry', 'INSERT') THEN
    v_bad := v_bad || 'service_role lost a table it writes'::text;
  END IF;
  IF NOT has_table_privilege('anon', 'public.job_board_stats_rollup', 'SELECT') THEN
    v_bad := v_bad || 'job_board_stats_rollup must stay readable: get_freshness_stats reads it as the caller'::text;
  END IF;

  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'client-callable census self-check failed (% problem(s)): %',
      cardinality(v_bad), array_to_string(v_bad, ' | ');
  END IF;

  -- What the repository does not describe: reported, not failed. A function
  -- created outside this folder may be a live feature; the owner decides.
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.prosecdef
      AND p.prorettype <> 'trigger'::regtype
      AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    ORDER BY 1
  LOOP
    v_drift := v_drift || r.sig;
  END LOOP;
  IF (c ->> 'unlisted_client_callable')::int > 0 THEN
    RAISE NOTICE 'client-callable census: % client-callable definer function(s) appear in no list of this migration (schema drift or new); all client-callable: %',
      c ->> 'unlisted_client_callable', array_to_string(v_drift, ', ');
  END IF;

  FOR r IN
    SELECT c2.relname::text AS t
    FROM pg_class c2
    JOIN pg_namespace ns ON ns.oid = c2.relnamespace
    WHERE ns.nspname = 'public'
      AND c2.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND c2.relname NOT IN ('company_financials', 'company_name_overrides', 'company_profiles',
                             'showcase_excluded', 'daily_scan_stats', 'job_board_stats_rollup')
      AND (
        (has_table_privilege('anon', c2.oid, 'SELECT') AND (c2.relkind IN ('v', 'm', 'f') OR NOT c2.relrowsecurity))
        OR (has_table_privilege('anon', c2.oid, 'INSERT, UPDATE, DELETE') AND c2.relkind IN ('r', 'p') AND NOT c2.relrowsecurity)
        OR EXISTS (
          SELECT 1 FROM pg_policies pp
          WHERE pp.schemaname = 'public' AND pp.tablename = c2.relname
            AND pp.permissive = 'PERMISSIVE'
            AND (pp.roles && ARRAY['public', 'anon']::name[])
            AND (COALESCE(pp.qual, '') = 'true' OR COALESCE(pp.with_check, '') = 'true')
            AND has_table_privilege('anon', c2.oid,
                  CASE pp.cmd WHEN 'ALL' THEN 'SELECT, INSERT, UPDATE, DELETE' WHEN 'SELECT' THEN 'SELECT'
                              WHEN 'INSERT' THEN 'INSERT' WHEN 'UPDATE' THEN 'UPDATE' ELSE 'DELETE' END)
        )
      )
    ORDER BY 1
  LOOP
    v_open_tables := v_open_tables || r.t;
  END LOOP;
  IF cardinality(v_open_tables) > 0 THEN
    RAISE NOTICE 'client-callable census: % table(s) the publishable key can read or write every row of, outside the allowlist: %',
      cardinality(v_open_tables), array_to_string(v_open_tables, ', ');
  END IF;

  RAISE NOTICE 'client-callable census: %', c::text;
END
$check$;
