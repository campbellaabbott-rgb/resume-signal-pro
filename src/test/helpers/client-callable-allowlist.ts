/**
 * EVERY SECURITY DEFINER FUNCTION A STRANGER CAN CALL, AND WHY.
 *
 * The publishable key ships in the frontend bundle, so "anon can execute it"
 * means "anyone on the internet can execute it, as the function's owner,
 * through every RLS lock". The 2026-08 audit found 107 of 121 definer
 * functions in that state; 20261004110000 is the census that closed every one
 * no client-role caller needs. This file is the other half of that migration:
 * the functions that STAY open, each with the client-role caller that needs it
 * and what it hands back. Nothing reaches the publishable key by default any
 * more -- a function is open because it is on this list, and it is on this
 * list because a page, a script run with the publishable key, or a signed-in
 * browser calls it.
 *
 * WHAT A ROW MUST SAY (src/test/every-function-a-stranger-can-call-is-named-
 * with-its-caller.test.ts holds each of these mechanically):
 *   caller   a file that calls it with a client-role key. The file must name
 *            the function in CODE, not only in a comment.
 *   returns  what a stranger receives. Acceptable shapes, and nothing else:
 *              aggregates          counts, rates, percentiles, company-level
 *                                  facts derived from public postings;
 *              own rows            what an unguessable capability (a share id,
 *                                  a session uuid, an affiliate session token)
 *                                  or auth.uid() already entitles the caller to;
 *              public record       a filing, a cached page payload;
 *              write-only          a bounded insert that returns no rows.
 *   writes   present exactly when the body INSERTs/UPDATEs/DELETEs, saying
 *            why a stranger may cause that write.
 *
 * NEVER ON THIS LIST: personal data (an email, a visitor's history), Stripe or
 * session identifiers, raw search text, bulk posting rows (the metered board is
 * the only door to postings), or an unbounded write.
 */

export type Roles = "anon" | "authenticated";

export interface AllowedFunction {
  /** `public.fn(identity,arg,types)` exactly as function-acl.ts normalises it. */
  sig: string;
  /** anon implies authenticated too (both roles are granted). */
  roles: Roles;
  caller: string;
  returns: string;
  writes?: string;
}

const A = (sig: string, caller: string, returns: string, writes?: string): AllowedFunction =>
  ({ sig, roles: "anon", caller, returns, ...(writes ? { writes } : {}) });
const U = (sig: string, caller: string, returns: string, writes?: string): AllowedFunction =>
  ({ sig, roles: "authenticated", caller, returns, ...(writes ? { writes } : {}) });

export const CLIENT_CALLABLE: AllowedFunction[] = [
  // ── public pages: company- and board-level facts derived from public postings
  A("public.agent_sender_public_status()", "src/hooks/useAgentSender.ts", "aggregates: one boolean, is any apply worker alive"),
  A("public.get_actively_hiring_companies(integer)", "src/pages/GhostJobIndex.tsx", "aggregates: per-company closure and open-role counts"),
  A("public.get_audit_result()", "src/pages/GhostJobIndex.tsx", "public record: the cached board audit blob"),
  A("public.get_board_vendor_counts()", "src/hooks/useBoardVendorCounts.ts", "aggregates: postings per ATS vendor"),
  A("public.get_category_fill_curve(integer,integer)", "scripts/verify-deploy.sh", "aggregates: per-category fill curve"),
  A("public.get_company_claim_status(text)", "src/components/jobs/CompanyClaim.tsx", "public record: whether an employer verified its page, and its website"),
  A("public.get_company_fill_curve(text[])", "src/pages/Jobs.tsx", "aggregates: per-company fill curve for the tokens asked about"),
  A("public.get_company_financials(text)", "src/components/jobs/PublicCompanyCard.tsx", "public record: SEC ticker and revenue series"),
  A("public.get_company_growth(text[])", "src/pages/Jobs.tsx", "aggregates: per-company 7-day growth rate"),
  A("public.get_company_hiring_health(text[])", "src/pages/Jobs.tsx", "aggregates: per-company closure and repost counts"),
  A("public.get_company_intel(text)", "src/components/jobs/CompanyIntelPanel.tsx", "aggregates: one company's category, country and salary medians"),
  A("public.get_company_suggest(text)", "src/pages/Explore.tsx", "aggregates: up to 8 company names matching a 3+ letter query, with open-role counts"),
  A("public.get_country_facet()", "src/pages/Jobs.tsx", "aggregates: postings per country"),
  A("public.get_employer_layoff_filings(text[])", "src/components/jobs/LayoffFilingLine.tsx", "public record: WARN / SEC 8-K filings matched to the tokens asked about"),
  A("public.get_employer_layoff_filings_all(text)", "src/components/jobs/LayoffFilingLine.tsx", "public record: every filing in the window for one employer"),
  A("public.get_employer_lca_wages(text[],text,text)", "src/components/jobs/LcaFiledWagesLine.tsx", "public record: OFLC LCA wage ranges per employer"),
  A("public.get_entry_level_companies(integer)", "src/pages/EntryLevelIndex.tsx", "aggregates: per-company entry-level share"),
  A("public.get_entry_level_stats()", "src/pages/EntryLevelIndex.tsx", "aggregates: entry-level totals by category"),
  A("public.get_explore_cache()", "src/pages/Explore.tsx", "public record: the cached Explore payload"),
  A("public.get_ghost_job_index_stats()", "src/pages/GhostJobIndex.tsx", "aggregates: board-wide open and closed totals"),
  A("public.get_hiring_trends()", "src/pages/HiringTrends.tsx", "aggregates: weekly new and closed counts"),
  A("public.get_job_board_facets()", "src/hooks/useBoardVendorCounts.ts", "aggregates: the cached facet counts"),
  A("public.get_layoff_partition()", "src/components/ghost/LayoffPartitionSection.tsx", "aggregates: filed vs control arm shares"),
  A("public.get_ontario_posting_disclosures(text)", "src/components/jobs/OntarioEsaDisclosures.tsx", "public record: <=240-character pay and AI-use quotes from ONE posting the caller names"),
  A("public.get_public_scan_insights()", "src/components/LiveScanStats.tsx", "aggregates: resume score distribution by industry and level"),
  A("public.get_salary_benchmarks()", "src/pages/Jobs.tsx", "aggregates: per-category median salary floor (n >= 30)"),
  A("public.get_scan_totals()", "src/hooks/use-scan-totals.ts", "aggregates: total scans and country count"),
  A("public.get_similar_companies(text,integer)", "src/components/jobs/SimilarCompanies.tsx", "aggregates: companies hiring in the same category, with counts"),
  A("public.get_stats_cache()", "src/pages/HiringTrends.tsx", "public record: the cached stats payload"),
  A("public.get_takedowns_today()", "src/pages/Jobs.tsx", "aggregates: one count"),
  A("public.get_today_scan_count()", "src/hooks/use-shared-data.ts", "aggregates: one count"),
  A("public.get_transparency_cache()", "src/pages/PayTransparencyIndex.tsx", "public record: the cached pay-transparency payload"),
  A("public.get_trending_categories()", "src/pages/HiringTrends.tsx", "aggregates: per-category posting counts, last 7 vs prior 7 days"),

  // ── the owner's tooling, run with the publishable key (verify-deploy, smoke, scan-trends)
  // The two board-meter readers and get_cron_health stay open ONLY because
  // scripts/verify-deploy.sh (7j, 7l, 7m) reads them with the publishable key
  // and that file is shared by every lane. They hold aggregates (no address,
  // no command, no message); the over-cap counts are the closest thing to a
  // scraper feedback signal, and a caller already learns its own caps from
  // the board's status and budget-echo. Closing them = moving those three
  // verify sections to admin-ops (x-admin-key) in the same change.
  A("public.get_board_anon_hourly(integer)", "scripts/verify-deploy.sh", "aggregates: anonymous board reads per hour, kind and country"),
  A("public.get_board_anon_networks(integer,integer)", "scripts/verify-deploy.sh", "aggregates: anonymous board reads per /16 (or /32 for IPv6) network, never an address"),
  A("public.get_board_flow(integer)", "scripts/verify-deploy.sh", "aggregates: intake, closures and serving counts for a window"),
  A("public.get_cron_health(integer)", "scripts/verify-deploy.sh", "aggregates: per cron job run counts and durations, never a command or a message"),
  A("public.get_lca_load_state()", "scripts/verify-deploy.sh", "aggregates: LCA load row counts and date range"),
  A("public.get_funnel_cohort_stats(text,integer)", "scripts/verify-deploy.sh", "aggregates: distinct-visitor funnel counts per value of ONE of eight fixed cohort dimensions (20261004110000 refuses any other key: referrer URLs and funnel session ids were enumerable through it)"),
  A("public.get_industry_correction_stats(integer)", "scripts/scan-trends.mjs", "aggregates: detected -> corrected industry label pairs with counts"),
  A("public.get_industry_score_benchmark(text,integer,integer,integer)", "scripts/post-publish-smoke.mjs", "aggregates: one industry's average and the percentile of a score"),
  A("public.get_real_score_distribution(text)", "scripts/post-publish-smoke.mjs", "aggregates: one industry's score percentiles"),
  A("public.get_scan_geo_stats(integer)", "scripts/scan-trends.mjs", "aggregates: scans and failures per country"),
  A("public.get_scan_health_status()", "src/pages/ScanMetrics.tsx", "aggregates: scanner status, last-hour counts and latency (an external heartbeat reads it without a key)"),
  A("public.get_scan_success_rate(integer,text)", "scripts/scan-trends.mjs", "aggregates: scan success rate and latency percentiles"),

  // ── capabilities: the caller holds an unguessable token naming its own rows
  A("public.get_analysis_by_share_id(text)", "src/pages/Success.tsx", "own rows: the analysis behind a 24/32-hex share id"),
  A("public.delete_analysis_by_share_id(text)", "src/pages/Success.tsx", "own rows: deletes the analysis behind a share id", "deletes the one analysis whose share id the caller holds -- the share id IS the ownership proof"),
  A("public.get_temp_resume(text)", "src/pages/Success.tsx", "own rows: the resume text stored under a session uuid, once (DELETE ... RETURNING)", "deletes the stored text as it returns it, so a session uuid reads exactly once"),
  A("public.store_temp_resume(text,text,text)", "src/pages/Index.tsx", "own rows: a new session uuid", "stores <=50k characters of the caller's own resume under a fresh uuid that only the caller learns"),
  A("public.get_affiliate_dashboard(text)", "src/hooks/use-affiliate-auth.ts", "own rows: the dashboard of the affiliate whose session token is presented"),
  A("public.get_affiliate_clicks(text,integer)", "src/pages/Affiliates.tsx", "own rows: daily click counts for the presented affiliate session"),
  A("public.login_affiliate(text,text)", "src/hooks/use-affiliate-auth.ts", "own rows: a session token (and the affiliate's own email) for the affiliate whose password matched", "inserts one affiliate session after a bcrypt password check; 20 attempts an hour per address and 20 an hour per email from every address together"),
  A("public.logout_affiliate(text)", "src/hooks/use-affiliate-auth.ts", "write-only: true/false", "deletes the session whose token the caller presents"),
  A("public.register_affiliate(text,text)", "src/hooks/use-affiliate-auth.ts", "own rows: the new affiliate's id, referral code and session token", "creates one affiliate account (open sign-up by design); 3 attempts per address and 50 in all a day, because sign-up without a verification email cannot hide whether an address already has an account"),

  // ── write-only telemetry from the browser. Every one spends
  // client_write_allowed (20261004110000): a per-address budget keyed on the
  // PLATFORM's address (cf-connecting-ip, else the last forwarded hop -- never
  // a value the caller passes) plus a ceiling for every caller together, which
  // a rotating pool still meets. Every stored text is capped.
  A("public.log_error_telemetry(text,text,text,integer,text,jsonb)", "src/lib/resilient-edge-function.ts", "write-only: true/false", "one error_telemetry row per client error, 30 per address and 600 in all per 10 minutes; text capped (message 1000 chars, context 4096 bytes), visitor_id kept only in visitor-id form"),
  A("public.log_industry_correction(text,text,text,text)", "src/components/FreeKeywordResults.tsx", "write-only: void", "one industry_corrections row with <=50-character labels, 20 per address and 300 in all an hour"),
  A("public.log_industry_correction(text,text,text,text,integer,text[],text,text,text)", "src/components/IndustryConfidenceIndicator.tsx", "write-only: the new row's id", "one industry_corrections row from the confirmation strip, every field capped (<=20 signals of 60 chars), 20 per address and 300 in all an hour"),
  A("public.record_scan_feedback(text,boolean,text,integer,boolean,integer,text)", "src/components/ScanFeedback.tsx", "write-only: void", "one scan_feedback row (thumbs up/down, text <=1000 chars), 10 per address and 300 in all an hour"),
  A("public.record_scan_outcome(text,text,text)", "src/components/ScanOutcomeAsk.tsx", "write-only: true/false", "one scan_outcomes upsert per report and browser, 5 per address and 200 in all a day; p_ip (the visitor id) names the answer but no longer picks the budget"),
  A("public.track_affiliate_click(text,text,text,text)", "src/hooks/use-affiliate-auth.ts", "write-only: true/false", "one affiliate_clicks row for an active referral code, 3 per address per code and 500 per code a day; ip_hash derived from the platform address when there is one"),

  // ── signed-in browsers only
  U("public.agent_sender_online(integer)", "src/components/account/AgentStatusBand.tsx", "aggregates: one boolean, is the apply worker alive"),
  // Was anon-callable for ANY 500 posting ids: the per-posting closure ledger
  // (the moat), in bulk, behind no meter. 20261004110000 made it signed-in
  // only and intersects the ids with the caller's own user_applications rows.
  U("public.get_application_lifecycle(text[])", "src/pages/Account.tsx", "own rows: outcome, closure date and days standing for the job ids on the caller's own tracker (auth.uid()), never another user's and never posting content"),
];

/**
 * Created by 20261004110000 already closed to clients: the budget and the
 * address the writers above are held to, and the key check check-alerts asks
 * with the service role. Listed so a test can hold them closed; they are not
 * CLOSED_BY_CENSUS rows because no migration before the census created them.
 */
export const CREATED_CLOSED: Array<{ sig: string; why: string }> = [
  { sig: "public.request_client_address()", why: "the platform's address for the caller (INVOKER); only the writers' budget reads it" },
  { sig: "public.client_write_allowed(text,integer,integer,integer)", why: "spends the write budget; a client calling it directly could burn another scope's ceiling" },
  { sig: "public.alerts_cron_key_matches(text)", why: "answers whether a value is the vault-held check-alerts cron key; service role only" },
];

/**
 * Open to clients, NOT judged here: another group owns them (credits-
 * entitlements), and revoking either would break a live caller that group is
 * changing in parallel. get_scan_credits answers any email's balance and
 * use_scan_credit spends any email's credit -- both reported, neither closed
 * from this lane.
 */
export const OWNED_ELSEWHERE: Array<{ sig: string; owner: string; caller: string }> = [
  { sig: "public.get_scan_credits(text)", owner: "credits-entitlements", caller: "src/hooks/use-scan-credits.ts" },
  { sig: "public.use_scan_credit(text)", owner: "credits-entitlements", caller: "src/hooks/use-scan-credits.ts" },
];

/**
 * Closed by 20261004110000: revoked from PUBLIC, anon and authenticated by
 * exact signature, granted to service_role. `why` is the reason no client may
 * hold it; `served` is how its legitimate readers reach it now.
 */
export const CLOSED_BY_CENSUS: Array<{ sig: string; why: string; served: string }> = [
  // the register items
  { sig: "public.get_delivery_health(integer)", why: "returned buyers' emails and Stripe checkout session ids (the bearer token for purchased content) for any window (register 1.25)", served: "admin-ops proxy (x-admin-key) for /health-check; check-alerts with the service key" },
  { sig: "public.log_alert_sent(text,text,numeric,numeric,text,boolean)", why: "anyone could write the cooldown ledger and silence the owner's critical alerts (register 1.65)", served: "check-alerts with the service key; the browser circuit breaker now writes only error telemetry" },
  { sig: "public.should_send_alert(text,text,integer)", why: "the read half of the alert ledger; only the server monitor decides cooldowns (register 1.65)", served: "check-alerts with the service key" },
  { sig: "public.get_payment_health(integer)", why: "returned Stripe payment_intent ids, failure messages and amounts (register 2.21)", served: "admin-ops proxy for /health-check" },
  { sig: "public.get_rate_limit_stats(integer)", why: "returned visitor ids of rate-limited callers (register 2.21)", served: "admin-ops proxy for /health-check" },
  { sig: "public.detect_user_error_spikes(integer,integer,integer)", why: "returned visitor ids with their error histories (register 2.21)", served: "admin-ops proxy for the user health table; check-error-spikes with the service key" },
  // operations dashboards: now behind the admin key
  { sig: "public.check_user_health(text)", why: "any visitor id's error history", served: "admin-ops proxy for the user health table" },
  { sig: "public.get_function_error_rates(integer)", why: "raw error message samples", served: "admin-ops proxy for /health-check" },
  { sig: "public.get_email_health(integer)", why: "recent email log rows (masked recipients, error text)", served: "admin-ops proxy for /health-check; check-alerts" },
  { sig: "public.get_ai_quality_stats(integer)", why: "raw AI parse errors per order", served: "admin-ops proxy for /health-check; check-alerts" },
  { sig: "public.get_checkout_funnel(integer)", why: "sales and delivery counts", served: "admin-ops proxy for /health-check" },
  { sig: "public.get_webhook_health(integer)", why: "Stripe webhook processing errors", served: "admin-ops proxy for /health-check; check-alerts" },
  { sig: "public.get_parse_failure_stats(integer)", why: "raw upload parse error messages", served: "admin-ops proxy for /health-check; check-alerts" },
  { sig: "public.get_email_metrics_hourly(integer)", why: "email volume series", served: "admin-ops proxy for the email trend chart" },
  { sig: "public.get_ai_generation_metrics_hourly(integer)", why: "paid generation volume series", served: "admin-ops proxy for the AI generation chart" },
  { sig: "public.get_webhook_metrics_hourly(integer)", why: "payment webhook volume series", served: "admin-ops proxy for the webhook chart" },
  { sig: "public.get_geo_latency_stats(integer)", why: "scan traffic per country", served: "admin-ops proxy for the geo chart" },
  { sig: "public.get_industry_detection_stats(integer)", why: "classifier telemetry", served: "admin-ops proxy for the industry chart" },
  { sig: "public.get_industry_detection_breakdown(integer)", why: "every detection row in a window", served: "admin-ops proxy for the industry chart" },
  { sig: "public.get_industry_detection_recent(integer)", why: "recent detection rows, caller-chosen limit", served: "admin-ops proxy for the industry chart" },
  { sig: "public.get_scan_metrics_hourly(integer)", why: "scan volume series", served: "admin-ops proxy for /scan-metrics and the health trend chart" },
  // server-only readers
  { sig: "public.get_visitor_error_history(text)", why: "any visitor id's error history; its only browser caller was dead code", served: "nobody (the hook that called it was removed)" },
  { sig: "public.get_error_diagnostics(integer)", why: "raw error message samples", served: "check-error-spikes with the service key" },
  { sig: "public.email_delivery_health(integer)", why: "email delivery state counts", served: "scan-heartbeat with the service key" },
  { sig: "public.product_delivery_health(integer)", why: "paid delivery state counts", served: "scan-heartbeat, stripe-webhook, retry-failed-deliveries with the service key" },
  { sig: "public.get_db_size_stats()", why: "database and corpus size", served: "scan-heartbeat with the service key" },
  { sig: "public.compare_cohorts(text,text,text,integer)", why: "funnel counts keyed on any metadata field (an existence oracle)", served: "nobody" },
  { sig: "public.should_generate_weekly_report()", why: "internal scheduling flag", served: "nobody" },
  { sig: "public.agent_confirmation_gaps(integer)", why: "employer confirmation-page wording, which can quote an applicant's name", served: "scan-heartbeat with the service key" },
  { sig: "public.agent_fill_gaps(integer)", why: "apply-agent form refusal wording", served: "scan-heartbeat with the service key" },
  { sig: "public.get_stale_board_count()", why: "crawl-catalogue health", served: "scan-heartbeat with the service key" },
  { sig: "public.get_stalest_boards(integer,integer,text[])", why: "names the boards our crawl is behind on", served: "job-board with the service key" },
  { sig: "public.board_serving_count()", why: "internal count", served: "get_board_flow and record_board_pool_sample run it as owner" },
  // caches and writers that only edge functions with the service key call
  { sig: "public.get_cached_response(text,text)", why: "reads (and bumps) any cached AI response by key", served: "analyze-resume, generate-summary, free-keyword-scan-stream, scan-heartbeat with the service key" },
  { sig: "public.store_cached_response(text,text,jsonb,integer)", why: "anyone could poison the AI response cache", served: "the same edge functions with the service key" },
  { sig: "public.cleanup_expired_cache()", why: "anonymous maintenance writes", served: "nobody calls it with a client key" },
  { sig: "public.log_industry_detection(integer,text,text,text,text,text,text,integer,text[],text,text,text,text,boolean,boolean,jsonb,integer,text[],integer,boolean)", why: "anonymous writes into classifier telemetry", served: "free-keyword-scan(-stream) with the service key" },
  { sig: "public.log_parse_failure(text,text,text,integer,text,jsonb)", why: "anonymous writes into parse telemetry", served: "parse-pdf, parse-docx with the service key" },
  { sig: "public.save_free_scan_lead(text,text,integer)", why: "anyone could add any address to the lead list", served: "save-lead, send-scan-report with the service key" },
  { sig: "public.build_missing_since_index_oneshot()", why: "anonymous CREATE INDEX and cron.unschedule", served: "nobody (a finished one-shot)" },
  { sig: "public.build_sitemap_day_index_oneshot()", why: "anonymous CREATE INDEX and cron.unschedule", served: "nobody (a finished one-shot)" },
  { sig: "public.store_temp_resume(text,text)", why: "the two-argument overload; every caller passes three named arguments", served: "nobody (store_temp_resume(text,text,text) stays open)" },
  // no caller anywhere
  { sig: "public.get_affiliate_stats_by_date(text,date,date)", why: "no caller", served: "nobody" },
  { sig: "public.get_category_fill_speed(integer,integer)", why: "no client caller (Jobs.tsx names it only in prose)", served: "nobody" },
  { sig: "public.get_closure_population()", why: "no client caller (Jobs.tsx names it only in prose)", served: "job-board with the service key" },
  { sig: "public.get_employer_benchmarks(integer,integer,integer)", why: "no client caller (GhostJobIndex.tsx names it only in prose)", served: "nobody" },
  { sig: "public.get_job_board_facets_cached()", why: "no caller", served: "nobody" },
  { sig: "public.get_newest_companies(integer)", why: "no caller (the Explore cache carries it)", served: "refresh_explore_cache as owner" },
  { sig: "public.get_trending_companies(integer)", why: "no caller (the Explore cache carries it)", served: "refresh_explore_cache as owner" },
  { sig: "public.get_repost_churn_companies(integer)", why: "no caller; an unbounded scan of the closure log", served: "nobody" },
  { sig: "public.get_size_segment_companies(text,integer,integer)", why: "no caller; 57014 timeouts on every band", served: "nobody" },
  { sig: "public.get_user_score_trend(text)", why: "a user's score history by email; already closed, now closed by name", served: "nobody" },
  // signed-in only functions with no signed-in caller
  { sig: "public.agent_cancel_pending(bigint)", why: "no caller", served: "nobody (re-grant to authenticated when a cancel button ships)" },
  { sig: "public.agent_employer_in_cooldown(uuid,text,integer)", why: "told any signed-in user whether ANOTHER user applied to an employer", served: "apply-agent with the service key" },
  { sig: "public.agent_sent_today(uuid)", why: "owner-checked, but no signed-in caller", served: "apply-agent with the service key" },
  { sig: "public.get_apply_hosts()", why: "the apply-host census is recon surface", served: "job-board with the service key" },
];

/**
 * Tables a client role can read every row of, on purpose. The census test
 * holds that no OTHER table is readable or writable that way.
 */
export const OPEN_TABLES: Array<{ table: string; access: string; why: string }> = [
  { table: "company_financials", access: "anon SELECT", why: "public SEC figures" },
  { table: "company_name_overrides", access: "anon SELECT", why: "display names" },
  { table: "company_profiles", access: "anon SELECT", why: "employee counts from public records" },
  { table: "showcase_excluded", access: "anon SELECT", why: "the list of staffing agencies kept off leaderboards" },
  { table: "daily_scan_stats", access: "anon SELECT", why: "one count per day" },
  { table: "job_board_stats_rollup", access: "anon SELECT", why: "aggregates; get_freshness_stats and get_date_coverage read it with INVOKER rights for public pages" },
];

/**
 * Client-callable functions that take an array the caller fills and do NOT
 * slice it. A RATCHET, not a permission: remove a row when its function
 * slices, never add one (the census test fails on any other uncapped array).
 *
 * Why these three are not capped from the census migration: each is a
 * per-company aggregate reader with a 25-second statement_timeout that
 * already bounds one call (the whole catalogue in one call times out), every
 * caller sends at most 200 tokens (Jobs.tsx batches at 200, agent-runner at
 * 100, agent-mcp at 20), and each is re-issued only in a migration file of
 * its own -- a dozen guards (the-bars-an-agent-is-told..., a-board-that-grew...,
 * a-role-still-up-at-day-thirty..., the OUT-param guard) read the newest file
 * that defines one of them as dedicated to it, and the census has one stamp.
 * The cap is `p_tokens[1:200]`, the size every caller already uses.
 */
export const UNCAPPED_TOKEN_ARRAYS: Array<{ sig: string; why: string }> = [
  { sig: "public.get_company_fill_curve(text[])", why: "25s statement_timeout; callers send <=200; an 830-line body re-issued only in its own file" },
  { sig: "public.get_company_growth(text[])", why: "25s statement_timeout; callers send <=200; re-issued only in its own file" },
  { sig: "public.get_company_hiring_health(text[])", why: "25s statement_timeout; callers send <=200 (agent-mcp 20); re-issued only in its own file" },
];

/** Tables 20261004110000 closed to anon and authenticated (one of them, the write budget, it created closed). */
export const CLOSED_TABLES: Array<{ table: string; why: string }> = [
  { table: "job_board_verifications", why: "the whole crawl catalogue (every board token and when it was read); only the service role reads it" },
  { table: "job_board_closure_rollup", why: "monthly rollups of the closure ledger, the moat; only owner-run functions read it" },
  { table: "error_telemetry", why: "anyone could INSERT rows straight into it; the browser writes through log_error_telemetry" },
  { table: "industry_detection_metrics", why: "anyone could INSERT rows straight into it; the server writes through log_industry_detection" },
  { table: "client_write_budget", why: "new: the per-address write budget the browser's writers spend; only client_write_allowed (as owner) touches it" },
];
