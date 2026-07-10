// Analytics transport that survives page navigation.
//
// supabase.functions.invoke() rides a plain fetch, and the browser CANCELS
// plain fetches when the page unloads. Proven in production: the same funnel
// recorded purchase_completed 2× but checkout_started 0× over 30 days —
// because checkout events fire milliseconds before
// window.location.assign(<stripe url>) and die with the page, while the
// success page's event has all the time it needs. `keepalive: true` tells the
// browser to finish the request after unload (payloads here are ~2KB, well
// under the 64KB keepalive budget).
//
// Also guards production analytics from development sessions: localhost dev
// servers talk to the production Supabase project, so local clicking was
// writing into the live funnel tables.

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export function isTrackingDisabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    const h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1") return true;
  } catch {
    return true; // no window — never track from non-browser contexts
  }
  return false;
}

/** Fire-and-forget POST to the track-ab-event edge function. Never throws. */
export function postTrackEvent(body: unknown): void {
  if (isTrackingDisabled()) return;
  try {
    void fetch(`${SUPA_URL}/functions/v1/track-ab-event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPA_KEY,
        Authorization: `Bearer ${SUPA_KEY}`,
      },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {
      /* analytics must never surface errors to the app */
    });
  } catch {
    /* ditto */
  }
}
