import { useEffect } from "react";
import { initFunnelTracking } from "@/hooks/use-funnel-tracking";

/**
 * Where a visit came from (utm tags, referrer, landing page), recorded on
 * whatever page the visit starts on.
 *
 * It used to be recorded only as a side effect: the header's product dialog
 * mounts the checkout hook, whose funnel hook records the landing. Pages
 * without the header recorded nothing, and /r/<code> (the affiliate short
 * link) reloads onto /?ref=<code>, dropping the link's utm tags and turning
 * the external referrer into our own page -- so an affiliate visit landed as
 * "direct" with no campaign.
 *
 * Mounted once in App, before the routes, so it records before any page's
 * own effects run (a redirect, a page rewriting its query string). Once per
 * tab session (gated in initFunnelTracking), through the one transport.
 */
export function VisitSource(): null {
  useEffect(() => {
    // Mounted above every route, so a throw here (storage blocked in a private
    // window: initFunnelTracking reads sessionStorage unguarded) would take
    // the whole app down with it. Recording a visit is never worth that.
    try { initFunnelTracking(); } catch { /* storage blocked: record nothing */ }
  }, []);
  return null;
}
