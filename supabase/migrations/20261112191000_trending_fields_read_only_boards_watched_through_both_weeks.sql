-- TRENDING FIELDS READ ONLY BOARDS WATCHED THROUGH BOTH WEEKS (S14X-038).
--
-- /hiring-trends prints, per field, (last7 - prior7) / prior7 from
-- get_trending_categories. Two biases the page's own basis line says are
-- removed were still in it:
--
-- 1. A BOARD CATALOGUED MID-WINDOW COUNTED IN THE LATER WEEK ONLY. The page
--    says "postings from boards we catalogued mid-window are excluded", and
--    nothing excluded them: a board first observed five days ago with 400
--    postings in its first days added 400 to last7 and nothing to prior7, a
--    rise that is our onboarding, not the field's hiring. Now a board counts
--    only when job_board_board_watch (the one admissible board-age source,
--    20260909212000) says we were observing it p_watch_days days before
--    today: fourteen by default, never fewer, because the two windows span
--    fourteen days. A board with no watch row cannot be dated and is left
--    out, the refusing direction. The clause sits on both legs, live postings
--    and closed postings.
--
-- 2. THE CLOSED LEG DROPPED SUPERSEDED CLOSURES. A posting dated in a window
--    and later taken down while another posting with the same title stayed
--    live is marked superseded, and the function dropped it from the window
--    it was posted in. Superseded marks accrue as a window ages, so the older
--    window lost more of its postings than the newer one and the comparison
--    read as growth. A posting is new in the window it was dated whether it
--    later came down as a re-list or not, so the closed leg now counts it,
--    DISTINCT by posting, exactly as the live leg counts a re-list's own new
--    posting (the three-day first_seen rule already admits it).
--
-- The function gains its watch parameter, so it is dropped from the
-- catalogue by name and re-created; refresh_stats_cache calls it with no
-- argument, which the DEFAULT keeps working, as it does the page's live
-- call. It keeps SECURITY DEFINER (the closure log is service_role-only),
-- SET search_path = public, its sixty-second header and its census status:
-- client-callable and allowlisted. The census function is re-issued from its
-- live text (20261101110000) with that one signature updated, so the
-- allowlist names the function that exists. The weekly series takes the same
-- two rules in the next file (20261112191500). The watch table is named in
-- its owner's IF NOT EXISTS form, so the file also loads alone onto a schema
-- that lacks it (a LANGUAGE sql body is validated at CREATE time); on the
-- live database that is a no-op. The last block reads the end state back
-- and raises if any part did not land. Safe to run twice.

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.job_board_board_watch (
  company_token        text PRIMARY KEY,
  first_observed_on    date NOT NULL,
  first_observed_basis text NOT NULL,
  is_censored          boolean NOT NULL DEFAULT false,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- 1. the field table, dropped by name from pg_proc and re-created.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'get_trending_categories'
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;
-- The signature the loop above dropped, named, so a reader of the migrations
-- alone sees the old one go (a no-op here; IF EXISTS).
DROP FUNCTION IF EXISTS public.get_trending_categories();

CREATE OR REPLACE FUNCTION public.get_trending_categories(p_watch_days int DEFAULT 14)
RETURNS TABLE (category text, last7 int, prior7 int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout = '60s' AS $$
  WITH excluded AS (SELECT company_token FROM public.showcase_excluded),
  watched AS (
    SELECT w.company_token FROM public.job_board_board_watch w
    WHERE w.first_observed_on <= current_date - GREATEST(COALESCE(p_watch_days, 14), 14)
  ),
  live AS (
    SELECT p.category AS cat, p.posted_at
    FROM public.job_board_postings p
    WHERE p.posted_at IS NOT NULL AND p.posted_at > now() - interval '14 days'
      AND p.first_seen - p.posted_at < interval '3 days'
      AND p.company_token NOT IN (SELECT company_token FROM excluded)
      AND p.company_token IN (SELECT company_token FROM watched)
  ),
  closed AS (
    SELECT DISTINCT ON (c.posting_id)
           COALESCE(NULLIF(c.category, ''), 'other') AS cat, c.posted_at
    FROM public.job_board_closures c
    WHERE c.posted_at IS NOT NULL AND c.posted_at > now() - interval '14 days'
      AND c.closed_at > now() - interval '15 days'
      AND c.first_seen IS NOT NULL AND c.first_seen - c.posted_at < interval '3 days'
      AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
      AND c.company_token NOT IN (SELECT company_token FROM excluded)
      AND c.company_token IN (SELECT company_token FROM watched)
      AND NOT EXISTS (
        SELECT 1 FROM public.job_board_postings p
        WHERE p.id = c.posting_id
          AND p.posted_at IS NOT NULL AND p.posted_at > now() - interval '14 days'
          AND p.first_seen - p.posted_at < interval '3 days')
    ORDER BY c.posting_id, c.closed_at
  ),
  dated AS (
    SELECT l.cat, l.posted_at FROM live l
    UNION ALL
    SELECT k.cat, k.posted_at FROM closed k
  )
  SELECT d.cat AS category,
    (count(*) FILTER (WHERE d.posted_at > now() - interval '7 days'))::int AS last7,
    CASE WHEN (SELECT min(closed_at) FROM public.job_board_closures
                 WHERE absence_basis IS DISTINCT FROM 'lap_backfill') <= now() - interval '14 days'
         THEN (count(*) FILTER (WHERE d.posted_at <= now() - interval '7 days'))::int
         ELSE NULL END AS prior7
  FROM dated d
  GROUP BY d.cat
  HAVING count(*) FILTER (WHERE d.posted_at > now() - interval '7 days') >= 20
  ORDER BY 2 DESC LIMIT 15;
$$;
COMMENT ON FUNCTION public.get_trending_categories(int) IS
  'Fields by new postings dated in the last seven days, with the seven days '
  'before as a comparison, each window counted the way get_hiring_trends counts '
  'a week: postings dated in the window and seen within three days of that '
  'date, live rows plus the DISTINCT postings among closure rows not already '
  'counted live (20261008111500). Only boards job_board_board_watch says we '
  'observed at least p_watch_days days ago (never fewer than fourteen, the span '
  'of both windows) count, so a board catalogued mid-window adds to neither '
  'week (20261112191000). A posting later taken down as a same-title re-list '
  'still counts in the week it was dated, as the re-list''s own posting counts '
  'in its week: dropping it removed more from the older window as superseded '
  'marks accrued. Doubted takedowns stay, because the doubt is about the '
  'takedown, not the posting date. SECURITY DEFINER: it reads '
  'job_board_closures, which is service_role-only, and an INVOKER version '
  'publishes emptiness with a 200 (20260820174500). prior7 is NULL until the '
  'closure log is fourteen days old (min(closed_at), a TENURE). '
  'ADMITTED ABSENCE BASES: full_read, lap, and NULL (a row written before the '
  'column existed on 2026-09-08, a full_read closure). lap_backfill is EXCLUDED '
  'and must stay excluded: its closed_at is the day we could finally see the '
  'takedown, late by an unknown amount up to the freshness window.';
REVOKE ALL ON FUNCTION public.get_trending_categories(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_trending_categories(int) TO anon, authenticated, service_role;

-- 2. the census names the field table by the signature it now has.
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
  n       int;
  f       regprocedure := to_regprocedure('public.get_trending_categories(integer)');
  src     text;
  census  text;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_trending_categories';
  IF n <> 1 OR f IS NULL THEN
    RAISE EXCEPTION 'get_trending_categories: expected one definition taking the watch days, found %', n;
  END IF;
  SELECT p.prosrc INTO src FROM pg_proc p WHERE p.oid = f;
  IF position('public.job_board_board_watch w' IN src) = 0
     OR position('c.company_token IN (SELECT company_token FROM watched)' IN src) = 0
     OR position('p.company_token IN (SELECT company_token FROM watched)' IN src) = 0 THEN
    RAISE EXCEPTION 'get_trending_categories: a leg is not held to the boards watched through both windows';
  END IF;
  IF position('AND NOT c.superseded' IN src) > 0 THEN
    RAISE EXCEPTION 'get_trending_categories: still drops a posting that came down as a same-title re-list from its own window';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = f) THEN
    RAISE EXCEPTION 'get_trending_categories: not SECURITY DEFINER, so anon reads an empty ledger';
  END IF;
  IF NOT (SELECT 'statement_timeout=60s' = ANY (p.proconfig) AND 'search_path=public' = ANY (p.proconfig)
            FROM pg_proc p WHERE p.oid = f) THEN
    RAISE EXCEPTION 'get_trending_categories: lost its sixty-second header or its pinned search_path';
  END IF;
  IF NOT has_function_privilege('anon', f, 'EXECUTE') OR NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'get_trending_categories: the page''s roles cannot execute it';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = f AND a.grantee = 0) THEN
    RAISE EXCEPTION 'get_trending_categories: still granted to PUBLIC';
  END IF;
  SELECT p.prosrc INTO census FROM pg_proc p WHERE p.oid = 'public.client_callable_census()'::regprocedure;
  IF position('public.get_trending_categories(integer)' IN census) = 0
     OR position('public.get_trending_categories()' IN census) > 0 THEN
    RAISE EXCEPTION 'the census does not name get_trending_categories by the signature it has';
  END IF;
  IF (public.client_callable_census() -> 'allowlisted_not_callable') ? 'public.get_trending_categories(integer)' THEN
    RAISE EXCEPTION 'the census lists get_trending_categories(integer) as allowlisted but not callable';
  END IF;
END $verify$;

NOTIFY pgrst, 'reload schema';
