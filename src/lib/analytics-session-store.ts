/**
 * THIS TAB'S ANALYTICS STATE, STORED ONLY AFTER CONSENT (wave 4 round 2
 * review, security lens).
 *
 * The consent banner and src/lib/consent.ts promise that nothing is stored or
 * sent for analytics until the visitor chooses. The send was gated, but the
 * funnel and cohort hooks wrote their session id, landing time, init flags
 * and cohort data (UTM, referrer, time zone) to sessionStorage on every page
 * before any choice, and (recheck) the scroll and time hooks their milestones,
 * the optimisation events their session clock, the funnel its progress and
 * the success page its purchase dedup. They now go through here: held in this
 * page's memory until the visitor allows analytics, in sessionStorage after,
 * and forgotten (both) when the visitor says no.
 */
import { analyticsAllowed } from "./consent";

/**
 * Every fixed analytics key a tab keeps: the funnel's (its progress too, which
 * only decides whether a purchase is counted), the cohort's, the session
 * clock the optimisation events carry, and the transport's sent-event dedup.
 */
export const ANALYTICS_SESSION_KEYS = [
  "funnel_session_id", "funnel_initialized", "funnel_landing_time", "funnel_progress",
  "cohort_session_id", "cohort_data", "cohort_initialized", "session_start", "rb_sent_events",
] as const;
/** Per-page and per-purchase analytics keys: scroll_tracked_<page>_<date>, time_tracked_<page>_<date>, purchase_tracked_<id>. */
export const ANALYTICS_SESSION_PREFIXES = ["scroll_tracked_", "time_tracked_", "purchase_tracked_"] as const;
export type AnalyticsSessionKey = typeof ANALYTICS_SESSION_KEYS[number] | `${typeof ANALYTICS_SESSION_PREFIXES[number]}${string}`;

/** True for a key this store owns, fixed or prefixed. */
export function isAnalyticsSessionKey(key: string): key is AnalyticsSessionKey {
  return (ANALYTICS_SESSION_KEYS as readonly string[]).includes(key) || ANALYTICS_SESSION_PREFIXES.some((p) => key.startsWith(p));
}

const memory = new Map<string, string>();

/** The value for this tab: this page's memory first, then the tab's storage once consent allows it. */
export function analyticsSessionGet(key: AnalyticsSessionKey): string | null {
  const held = memory.get(key);
  if (held !== undefined) return held;
  if (!analyticsAllowed()) return null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Kept in memory until the visitor allows analytics; in the tab's storage after. */
export function analyticsSessionSet(key: AnalyticsSessionKey, value: string): void {
  if (!analyticsAllowed()) {
    memory.set(key, value);
    return;
  }
  try {
    sessionStorage.setItem(key, value);
    memory.delete(key);
  } catch {
    memory.set(key, value);
  }
}

/** A "no": every analytics key this tab holds is forgotten, in memory and in storage, the prefixed ones too. */
export function forgetAnalyticsSession(): void {
  memory.clear();
  try {
    const owned: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && isAnalyticsSessionKey(k)) owned.push(k);
    }
    for (const k of [...ANALYTICS_SESSION_KEYS, ...owned]) sessionStorage.removeItem(k);
  } catch {
    /* nothing stored, or nothing we can reach */
  }
}
