/**
 * The operations readers the owner's dashboards (/health-check, /scan-metrics)
 * may ask admin-ops for. Every one of them is closed to anon and authenticated
 * by migration 20261004110000 -- several returned customer emails, Stripe ids
 * or visitor ids to anyone holding the publishable key -- so the browser can no
 * longer call them directly. admin-ops checks the ADMIN_API_KEY and then calls
 * them with the service role.
 *
 * A closed list, not a pass-through: a function absent here is refused before
 * anything is called, so the admin key can never become a way to run any other
 * service-role function (add_scan_credits, the email queue, the prune jobs).
 * src/test/every-function-a-stranger-can-call-is-named-with-its-caller.test.ts
 * holds that every name here is a function the census closed and that every
 * adminRpc(...) call in the frontend names one of them.
 */
export const ADMIN_OPS_RPCS: ReadonlySet<string> = new Set([
  "check_user_health",
  "detect_user_error_spikes",
  "get_ai_generation_metrics_hourly",
  "get_ai_quality_stats",
  "get_checkout_funnel",
  "get_delivery_health",
  "get_email_health",
  "get_email_metrics_hourly",
  "get_function_error_rates",
  "get_geo_latency_stats",
  // 20261008127000: the Health History card and /scan-metrics' heartbeat list
  // read the same closed table directly, and drew the refusal as 0% / empty.
  "get_heartbeat_history",
  "get_industry_detection_breakdown",
  "get_industry_detection_recent",
  "get_industry_detection_stats",
  "get_parse_failure_stats",
  "get_payment_health",
  "get_rate_limit_stats",
  // 20261008123000: the heartbeat results /health-check read straight from a
  // table closed to the browser, and rendered the refusal as 100% uptime.
  "get_recent_heartbeats",
  "get_scan_metrics_hourly",
  "get_webhook_health",
  "get_webhook_metrics_hourly",
]);

/** Argument names the readers above take; anything else is refused. */
export const ARG_NAME = /^p_[a-z_]{1,40}$/;
