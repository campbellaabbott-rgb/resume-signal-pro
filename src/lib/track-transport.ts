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
//
// THIS IS THE ONE CHOKEPOINT. Every event the browser records passes through
// postTrackEvent, and postTrackEvent decides two things no caller may decide
// for itself: WHICH visitor the event belongs to (getVisitorId, below — the
// audit of 2026-09-27 found four hooks each minting their own id under their
// own storage key, so one person was four visitors and no stage of the funnel
// could be joined to any other), and WHAT a page field may contain (a
// pathname, never a query string or a hash — see prepareTrackBody).

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

// ── Page fields ─────────────────────────────────────────────────────────────
// A page is WHERE the visitor was, and where they were is a pathname. The
// query string is what they arrived carrying (utm_*, ?outcome=, ?rid=, an
// email in a campaign link) and the hash is what they scrolled to; recorded
// under `page`, either one splits a single page into as many "pages" as there
// are links to it, and leaks whatever the link carried into a table read for
// analytics. The utm dimensions the cohort hook records are recorded on
// purpose, as their own fields — that is the one place a query value belongs.

/** The keys of a tracked event's metadata that name a page of ours. */
export const PAGE_FIELD_KEYS = ["page", "landingPage", "pathname", "path"] as const;
/** Keys that name the page the visitor came FROM: origin and path kept, query and hash dropped. */
export const REFERRER_FIELD_KEYS = ["referrer"] as const;

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

/** `/pricing?utm_source=x#top` → `/pricing`; a full URL of ours → its pathname. Never throws. */
export function pathnameOnly(value: string): string {
  if (ABSOLUTE_URL.test(value)) {
    try {
      return new URL(value).pathname;
    } catch {
      /* not a URL after all — fall through to the textual cut */
    }
  }
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
}

/** `https://www.google.com/search?q=…` → `https://www.google.com/search`; `direct` stays `direct`. */
export function referrerOnly(value: string): string {
  if (ABSOLUTE_URL.test(value)) {
    try {
      const u = new URL(value);
      return u.origin + u.pathname;
    } catch {
      /* fall through */
    }
  }
  return pathnameOnly(value);
}

/**
 * The body that actually leaves the browser. Two rewrites, both unconditional:
 * the visitor id is THIS browser's one id whatever the caller passed, and
 * every page-naming field of the metadata is cut to a pathname. Nothing else
 * is touched — no key is added, none removed — so a caller's payload shape is
 * exactly what the reader on the other side sees.
 */
export function prepareTrackBody(body: unknown): Record<string, unknown> {
  const src = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
  const out: Record<string, unknown> = { ...src, visitorId: getVisitorId() };
  const meta = src.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const m: Record<string, unknown> = { ...(meta as Record<string, unknown>) };
    for (const k of PAGE_FIELD_KEYS) {
      if (typeof m[k] === "string") m[k] = pathnameOnly(m[k] as string);
    }
    for (const k of REFERRER_FIELD_KEYS) {
      if (typeof m[k] === "string") m[k] = referrerOnly(m[k] as string);
    }
    out.metadata = m;
  }
  return out;
}

// ── Repeats ─────────────────────────────────────────────────────────────────
// The writer refuses a repeat of (test, variant, visitor, type) inside a
// window -- twenty-four hours for a view, ninety days for a conversion -- and
// answers "duplicate". But the visitor's budget on the server is charged on
// the ATTEMPT, before that check runs: the board fires an event per section
// toggle and the A/B hook one per mount, so a heavy hour of repeats the
// writer would never store could spend the budget and have the real stages
// refused (reviewed 2026-09-27). So a given (test, variant, type) leaves this
// browser once per tab session, and only once the server has said it kept
// the row or already had it; a rate-limited, failed or refused send leaves
// the event re-sendable. The window is SHORTER than the writer's shortest
// dedup window, so nothing is suppressed here that the writer would have
// stored -- a guard reads that window out of the live definition and holds
// the relation.

/** How long a sent (test, variant, type) is not re-sent from this tab. Under the writer's 24-hour view window. */
export const CLIENT_REPEAT_WINDOW_MS = 12 * 60 * 60 * 1000;
const SENT_EVENTS_KEY = "rb_sent_events";
/** Keys whose send is on the wire and not yet answered. */
const inFlight = new Set<string>();
/** The sent map when sessionStorage is unusable: one page's memory. */
let memorySent: Record<string, number> = {};

/** The identity the writer dedups on, minus the visitor (always this browser's). Null when the body has no such identity. */
export function eventKeyOf(body: unknown): string | null {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (typeof b.testName !== "string" || typeof b.variant !== "string" || typeof b.eventType !== "string") return null;
  return JSON.stringify([b.testName, b.variant, b.eventType]);
}

function readSent(): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(SENT_EVENTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, number>) : {};
  } catch {
    return memorySent;
  }
}

function writeSent(map: Record<string, number>): void {
  try {
    sessionStorage.setItem(SENT_EVENTS_KEY, JSON.stringify(map));
  } catch {
    memorySent = map;
  }
}

/** Was this key acknowledged by the server inside the client window? */
export function wasSentRecently(key: string, now: number = Date.now()): boolean {
  const at = readSent()[key];
  return typeof at === "number" && now - at < CLIENT_REPEAT_WINDOW_MS;
}

function markSent(key: string, now: number = Date.now()): void {
  const map = readSent();
  for (const k of Object.keys(map)) if (typeof map[k] !== "number" || now - map[k] >= CLIENT_REPEAT_WINDOW_MS) delete map[k];
  map[key] = now;
  writeSent(map);
}

/**
 * Did the server keep the row, or already have it? Anything else -- a rate
 * limit on either tier, a 4xx, a 5xx, an unreadable body -- leaves the event
 * re-sendable. A response with no `status` word is the pre-status contract,
 * which recorded or deduplicated and never said which.
 */
async function acknowledged(r: Response): Promise<boolean> {
  if (!r.ok) return false;
  try {
    const j = (await r.json()) as { status?: unknown } | null;
    const s = j?.status;
    return s === undefined || s === "recorded" || s === "duplicate";
  } catch {
    return false;
  }
}

/** Fire-and-forget POST to the track-ab-event edge function. Never throws. */
export function postTrackEvent(body: unknown): void {
  if (isTrackingDisabled()) return;
  try {
    const prepared = prepareTrackBody(body);
    const key = eventKeyOf(prepared);
    if (key && (inFlight.has(key) || wasSentRecently(key))) return;
    if (key) inFlight.add(key);
    void fetch(`${SUPA_URL}/functions/v1/track-ab-event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPA_KEY,
        Authorization: `Bearer ${SUPA_KEY}`,
      },
      body: JSON.stringify(prepared),
      keepalive: true,
    })
      .then(async (r) => {
        const kept = await acknowledged(r);
        if (key) {
          inFlight.delete(key);
          if (kept) markSent(key);
        }
      })
      .catch(() => {
        /* analytics must never surface errors to the app */
        if (key) inFlight.delete(key);
      });
  } catch {
    /* ditto */
  }
}

// ── Checkout context ────────────────────────────────────────────────────────
// A checkout function records the start of every Stripe session it mints
// (supabase/functions/_shared/checkout-start.ts) and joins that row back to
// this visitor's landing through the visitor id and the page the call was
// made from. It reads exactly two body fields, `visitorId` and `page`; this
// is the one place the browser produces them, so every checkout call spreads
// it and the server-side reader and this producer are held to the same two
// names by a guard.

/** The two fields a checkout call carries for the server's start record. */
export function checkoutContext(): { visitorId: string; page: string } {
  let page = "/";
  try {
    page = pathnameOnly(window.location.pathname);
  } catch {
    /* no window -- a path of "/" is still a path */
  }
  return { visitorId: getVisitorId(), page };
}

// ── Visitor id ──────────────────────────────────────────────────────────────
// ONE definition, because competing ones silently broke every funnel.
// track-ab-event rejects any visitorId whose length isn't 8–64 with a 400,
// and postTrackEvent swallows failures by design — so a bad id drops events
// invisibly. Measured 2026-07-24: the board sent the literal string "unknown"
// (7 chars) when the key was unset, and the error-tracking hooks minted
// `v_<epoch>_<rand>` (~25 chars); BOTH were rejected. Result: zero job_board
// events ever recorded, and the same for anything else on this path.
//
// Then measured 2026-09-27: seven hooks had each kept a private copy of this
// function under a private storage key, so the A/B views, the funnel stages,
// the scroll and time milestones, the cohort record and the product clicks of
// one browser were recorded under up to seven different visitors, and no
// purchase could be joined back to the landing that produced it.
//
// MIGRATION, not a reset. A browser that already carries one of those keys
// keeps the id it has: the keys are read once, in a fixed priority order, the
// first well-formed id wins and is written under the canonical key, and from
// then on only the canonical key is consulted. The priority puts the A/B key
// first because the concluded tests' view and conversion rows were written
// under it and the variant assignments in this browser were made against it;
// a browser that has BOTH an A/B id and a canonical id (it visited the board
// or hit an error boundary as well as the homepage) keeps the canonical one,
// which is what its board and error rows already say. Nothing is deleted and
// no legacy key is ever WRITTEN: a rollback to the previous bundle would find
// its keys exactly as it left them. (The first cut of this file mirrored the
// one id under two legacy keys for readers outside this module; every such
// reader now calls getVisitorId(), and a guard holds that none is left, so
// the mirror went with them.)
//
// Self-healing: a stored id that isn't a UUID is REPLACED, so visitors carrying
// a legacy `v_…` id start reporting instead of silently failing forever. That
// resets error-history continuity for those visitors — an acceptable trade
// against a pipeline that records nothing.

/** The one key. Everything below it exists only to move browsers onto it. */
export const VISITOR_ID_KEY = "rb_visitor_id";

/**
 * Keys the private copies wrote, in the order a browser's existing id is
 * looked for. Present in visitors' browsers, not in this source tree.
 */
export const LEGACY_VISITOR_ID_KEYS = [
  "ab_visitor_id",
  "funnel_visitor_id",
  "conversion_visitor_id",
  "cohort_visitor_id",
  "scroll_visitor_id",
  "time_visitor_id",
  "optimization_visitor_id",
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const mint = (): string =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    // Fallback for non-secure contexts where randomUUID is unavailable.
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

/**
 * The id handed out while storage is unusable (private mode, an embedded
 * webview, a full quota). Held for the life of the page so that a browser
 * which cannot persist anything is still ONE visitor for the whole visit
 * rather than a new one per event — and adopted into storage if storage
 * comes back before anything else was stored.
 */
let unpersistedId: string | null = null;

/** Stable per-browser id, always a valid UUID. Never throws. */
export function getVisitorId(): string {
  let chosen: string | null = null;
  try {
    const canonical = localStorage.getItem(VISITOR_ID_KEY);
    if (canonical && UUID_RE.test(canonical)) return canonical;
    for (const key of LEGACY_VISITOR_ID_KEYS) {
      const legacy = localStorage.getItem(key);
      if (legacy && UUID_RE.test(legacy)) {
        chosen = legacy;
        break;
      }
    }
  } catch {
    // localStorage blocked — still return a well-formed id so the event is
    // accepted rather than 400'd away, and the same one every time.
    if (!unpersistedId) unpersistedId = mint();
    return unpersistedId;
  }
  if (!chosen) chosen = unpersistedId ?? mint();
  try {
    localStorage.setItem(VISITOR_ID_KEY, chosen);
  } catch {
    // Readable but not writable (a full quota): the id this browser already
    // had is still its id for the page, and is adopted if storage frees up.
    unpersistedId = chosen;
  }
  return chosen;
}
