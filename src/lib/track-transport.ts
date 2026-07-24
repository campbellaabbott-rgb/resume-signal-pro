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

// ── Visitor id ──────────────────────────────────────────────────────────────
// ONE definition, because three competing ones silently broke every funnel.
// track-ab-event rejects any visitorId whose length isn't exactly 36 (a UUID)
// with a 400, and postTrackEvent swallows failures by design — so a bad id
// drops events invisibly. Measured 2026-07-24: the board sent the literal
// string "unknown" (7 chars) when the key was unset, and the error-tracking
// hooks minted `v_<epoch>_<rand>` (~25 chars); BOTH were rejected. Result: zero
// job_board events ever recorded, and the same for anything else on this path.
//
// Self-healing: a stored id that isn't a UUID is REPLACED, so visitors carrying
// a legacy `v_…` id start reporting instead of silently failing forever. That
// resets error-history continuity for those visitors — an acceptable trade
// against a pipeline that records nothing.
const VISITOR_KEY = "rb_visitor_id";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stable per-browser id, always a valid UUID. Never throws. */
export function getVisitorId(): string {
  const mint = () => (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    // Fallback for non-secure contexts where randomUUID is unavailable.
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      }));
  try {
    const existing = localStorage.getItem(VISITOR_KEY);
    if (existing && UUID_RE.test(existing)) return existing;
    const fresh = mint();
    localStorage.setItem(VISITOR_KEY, fresh);
    return fresh;
  } catch {
    // localStorage blocked (private mode, embedded webview) — still return a
    // well-formed id so the event is accepted rather than 400'd away.
    return mint();
  }
}
