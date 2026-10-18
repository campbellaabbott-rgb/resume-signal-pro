/**
 * A BROWSER WHOSE VISITOR ALLOWED ANALYTICS (S12-011).
 *
 * Our own analytics send nothing and store no visitor id until the visitor
 * says yes in the banner (src/lib/consent.ts). A test of WHAT the analytics
 * record (a page field, a visitor id, a hand-off event) runs in a browser that
 * said yes: call this after any localStorage.clear(). It writes the stored
 * choice, which a module re-imported after vi.resetModules reads too, and the
 * in-memory one, which holds while storage is blocked. The consent rule
 * itself is proved, from a browser that has not chosen, in
 * w4b-our-analytics-wait-for-a-yes-and-the-privacy-page-names-who-processes-what.
 */
import { setAnalyticsConsent } from "@/lib/consent";

export function allowAnalytics(): void {
  setAnalyticsConsent("granted");
}
