/**
 * OUR OWN ANALYTICS RUN ONLY AFTER THE VISITOR SAYS YES (S12-011; owner
 * decision 2026-10-12; plan CP-039, CP-G).
 *
 * WHAT WAS WRONG. The site stored a persistent visitor id (rb_visitor_id) and
 * sent page and funnel events (track-ab-event) from the first page view, with
 * no consent and a Privacy page that said cookies are managed "through your
 * browser settings". In the EU and the UK that is consent-required storage.
 *
 * WHAT HOLDS NOW. Until the visitor allows analytics in the banner
 * (src/components/ConsentBanner.tsx), the transport sends no event, no visitor
 * id is read from or written to this browser, and no A/B assignment is
 * stored; a checkout still gets a per-page id so its own record can be made.
 * Saying no later forgets the ids already stored (chooseAnalytics, in the
 * transport, which alone names the keys). The choice itself is kept
 * in localStorage: storing a refusal is what lets the banner stay away.
 *
 * The host's own analytics script is not ours to switch: the banner says so,
 * and turning it off is an owner step (decision D5).
 *
 * Every read and write is wrapped: blocked storage is "not chosen yet" and the
 * choice holds for the page in memory.
 */

export const CONSENT_KEY = "rb_analytics_consent";
export const CONSENT_EVENT = "rb:analytics-consent";

export type AnalyticsConsent = "granted" | "denied" | "unset";

/** The choice when storage is unusable: one page's memory. */
let memory: AnalyticsConsent = "unset";

/** The visitor's choice, or "unset" before one was made. Never throws. */
export function analyticsConsent(): AnalyticsConsent {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    if (v === "granted" || v === "denied") return v;
  } catch {
    /* storage blocked: the page's memory answers */
  }
  return memory;
}

/** True only after a yes. */
export function analyticsAllowed(): boolean {
  return analyticsConsent() === "granted";
}

/**
 * Record the visitor's choice and tell the page. Saying no also forgets the
 * ids already stored: that is the transport's to do (chooseAnalytics in
 * src/lib/track-transport.ts, the one place that knows the keys).
 */
export function setAnalyticsConsent(v: "granted" | "denied"): void {
  memory = v;
  try {
    localStorage.setItem(CONSENT_KEY, v);
  } catch {
    /* held in memory for this page */
  }
  try {
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: v }));
  } catch {
    /* no window */
  }
}

/** Test seam: forget the in-memory choice. */
export function resetConsentMemory(): void {
  memory = "unset";
}
