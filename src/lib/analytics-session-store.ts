/**
 * THIS TAB'S ANALYTICS STATE, STORED ONLY AFTER CONSENT (wave 4 round 2
 * review, security lens).
 *
 * The consent banner and src/lib/consent.ts promise that nothing is stored or
 * sent for analytics until the visitor chooses. The send was gated, but the
 * funnel and cohort hooks wrote their session id, landing time, init flags
 * and cohort data (UTM, referrer, time zone) to sessionStorage on every page
 * before any choice. They now go through here: held in this page's memory
 * until the visitor allows analytics, in sessionStorage after, and forgotten
 * (both) when the visitor says no.
 */
import { analyticsAllowed } from "./consent";

/** Every analytics key the funnel and cohort hooks keep for a tab. */
export const ANALYTICS_SESSION_KEYS = [
  "funnel_session_id", "funnel_initialized", "funnel_landing_time",
  "cohort_session_id", "cohort_data", "cohort_initialized",
] as const;
export type AnalyticsSessionKey = typeof ANALYTICS_SESSION_KEYS[number];

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

/** A "no": every analytics key this tab holds is forgotten, in memory and in storage. */
export function forgetAnalyticsSession(): void {
  memory.clear();
  try {
    for (const k of ANALYTICS_SESSION_KEYS) sessionStorage.removeItem(k);
  } catch {
    /* nothing stored, or nothing we can reach */
  }
}
