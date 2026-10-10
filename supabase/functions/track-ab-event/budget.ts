// THE EVENT BUDGET, IN TWO TIERS.
//
// WHAT WAS WRONG (audited 2026-09-27). One counter, keyed on the client
// address, fifty events a window. A homepage visit emits four to six events
// at mount (cohort session_start, funnel landing_view, scroll 0%, time 0s,
// and two A/B views where the hero mounts) and a ten-minute engaged visit
// reaches sixteen (five more scroll milestones, five more time milestones)
// before a single interaction; a journey through a scan to a checkout, or
// across the board, is about forty distinct rows. So a handful of people
// behind one office, campus or carrier NAT address spent the address's
// allowance in the burst at mount, and every event of the next was answered
// "rate_limited" -- a success response, nothing logged, nothing the client
// could see.
//
// AND THE WINDOW WAS A MINUTE. The writer's counter derived its window start
// from the minute-of-hour, so the value changed every wall-clock minute and
// the counter reset with it: "fifty an hour" was fifty a minute, three
// thousand an hour. Migration 20260927202451 floors the window start to the
// window's true boundary; the budget guard in src/test evaluates that
// expression, read from the live definition, at fixed instants inside one
// hour and drives the counter across a planted row. The numbers below are
// per HOUR because the database now enforces an hour.
//
// WHY TWO TIERS. A single number cannot serve both purposes a budget has.
// Raised high enough for a shared address it lets one runaway client (a
// render loop re-firing views, a stuck interval) spend the whole address's
// allowance and starve its neighbours -- the shape of the 2026-08-03 incident
// in which board browsing exhausted upload and checkout. Kept low enough to
// bound one client, it drops real people on shared addresses, which is the
// audit finding. So:
//
//   TIER 1 -- the visitor's own budget. Keyed on the visitor id, through the
//   shared check_rate_limit under a function name of its own. This is the
//   bound on one client, and it never depends on who else is behind the same
//   address. It is NOT a defence against a flood: an attacker mints ids for
//   free. It is the reason the address ceiling can be high.
//
//   TIER 2 -- the address ceiling. Keyed on the client address, inside
//   track_ab_event_optimized (whose limiter, dedup and insert are one call),
//   and since 2026-10-10 also counted before the site's hour (ADDRESS_DOOR).
//   This is the bound on a flood from one address, and the only one: the
//   trade-off of this design, stated plainly, is that a single address may
//   insert up to ADDRESS_CEILING_PER_HOUR rows an hour, because that is what
//   admitting ten simultaneous engaged visitors costs. Against the old
//   counter's REAL behaviour (fifty a minute, three thousand an hour) this is
//   a tighter hourly bound with a larger burst allowance. A flood spread over
//   many addresses was never bounded by this function and still is not; the
//   dedup bounds what one (visitor, test, variant) can insert to one row a
//   day for a view.
//
// THE TIER IS CHARGED ON ATTEMPT, so the client suppresses repeats. The
// visitor tier runs before the writer, which is where the duplicate check
// lives, so an attempt the writer would have answered "duplicate" still
// spends one of the visitor's budget. The board fires an event per section
// toggle and the A/B hook one per mount; a heavy hour of that could reach
// the budget on attempts that insert nothing and then have the real stages
// refused. The browser's one transport (src/lib/track-transport.ts) now
// sends a given (test, variant, type) once per tab session, inside a window
// shorter than the writer's shortest dedup window, and re-sends only when
// the server did not record it -- so attempts approximate distinct rows.
//
// THE NUMBERS. VISITOR_BUDGET_PER_HOUR is three full journeys an hour, with
// the journey's size derived from the client source by the guard in
// src/test (milestone arrays, funnel stages, A/B sites, board variants)
// rather than typed here. ADDRESS_CEILING_PER_HOUR is ten visitor budgets.
// check_rate_limit refuses a budget above 1000 and would fail this tier
// open, so the visitor budget must stay under that; the address ceiling does
// not pass through it.
//
// THE COUNTED SET. Neither function name here may ever appear in the
// v_budgeted array of check_global_rate_limit: analytics must not spend the
// front door's request budget (that is the 2026-08-03 incident by another
// door). The same guard holds that.
//
// Pure functions, so a Deno test drives them with a fake RPC and the entry
// point stays a thin parser around them.

export const VISITOR_BUDGET_PER_HOUR = 180;
export const ADDRESS_CEILING_PER_HOUR = 1800;
export const BUDGET_WINDOW_MINUTES = 60;

// TIER 3 -- THE WHOLE SITE'S HOUR (S8-019). The address tier is keyed on an
// address, so a flood from many addresses (or fresh visitor ids) was bounded
// by nothing; with metadata of any size and no retention, the funnel the
// owner decides from could be forged without limit. client_write_allowed's
// global bucket caps every row the writer may take in an hour at more than
// ten address ceilings, and a body's metadata is capped at METADATA_MAX_CHARS
// of JSON (the error boundaries' message and two trimmed stacks fit).
export const GLOBAL_CEILING_PER_HOUR = 20000;
export const GLOBAL_BUDGET_SCOPE = "track-ab-event:global";
export const METADATA_MAX_CHARS = 2048;

// THE ADDRESS IS COUNTED BEFORE THE SITE (review 2026-10-10). The writer's
// address ceiling ran after the site's hour, so one address minting a fresh
// visitor id per call spent the site's 20,000 on every call, refused ones
// included, and blacked out every visitor's funnel for the hour. The same
// ceiling is now taken first, through mail_door_take (one fixed hour per
// keyed hash of the address), so an address spends at most
// ADDRESS_CEILING_PER_HOUR of the site's hour. A failed count fails open:
// the writer's own address ceiling still holds.
export const ADDRESS_DOOR = "track-ab-event:address";

/** The address tier's bucket: a 32-hex keyed hash of the address, never the address. */
export async function addressBucket(address: string, secret: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${secret}:${ADDRESS_DOOR}:${address}`));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/** True when the metadata, as stored, would exceed METADATA_MAX_CHARS. */
export function metadataTooLarge(metadata: unknown): boolean {
  try {
    return JSON.stringify(metadata ?? {}).length > METADATA_MAX_CHARS;
  } catch {
    return true;
  }
}

/** The rate_limits function name the visitor tier writes under. Not the address tier's. */
export const VISITOR_BUDGET_FUNCTION = "track-ab-event:visitor";
/** check_rate_limit's own bound on p_ip; a longer key raises and fails the tier open. */
export const RATE_LIMIT_KEY_MAX = 45;

export type RpcResult = { data: unknown; error: { message: string } | null };
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;

export type TrackStatus =
  | "recorded"
  | "duplicate"
  | "rate_limited_visitor"
  | "rate_limited_address"
  | "rate_limited_global"
  | "error";

export interface TrackEvent {
  testName: string;
  variant: string;
  eventType: string;
  visitorId: string;
  metadata: unknown;
  clientIp: string;
  /** addressBucket(clientIp, secret); without it the address is not counted before the site. */
  addressBucket?: string;
}

export interface TrackOutcome {
  status: TrackStatus;
  error?: string;
}

/**
 * Record one event: the visitor's budget, then the address's hour, then the
 * site's hour, then the writer. Each refusal stops the chain, so a runaway
 * client spends nothing of its address's ceiling and an address spends at most
 * its ceiling of the site's hour. A failure of a tier's own RPC fails OPEN to
 * the next: the writer's address ceiling still holds, and an analytics event
 * is not worth a hard error.
 */
export async function recordEvent(rpc: Rpc, ev: TrackEvent): Promise<TrackOutcome> {
  const visitor = await rpc("check_rate_limit", {
    p_ip: ev.visitorId.slice(0, RATE_LIMIT_KEY_MAX),
    p_function: VISITOR_BUDGET_FUNCTION,
    p_max_requests: VISITOR_BUDGET_PER_HOUR,
    p_window_minutes: BUDGET_WINDOW_MINUTES,
  });
  if (visitor.error) {
    console.error("[TRACK-AB] visitor budget check failed, failing open:", visitor.error.message);
  } else if (visitor.data === false) {
    return { status: "rate_limited_visitor" };
  }

  if (ev.addressBucket) {
    const addr = await rpc("mail_door_take", {
      p_door: ADDRESS_DOOR,
      p_bucket: ev.addressBucket,
      p_max: ADDRESS_CEILING_PER_HOUR,
      p_window_minutes: BUDGET_WINDOW_MINUTES,
    });
    if (addr.error) {
      console.error("[TRACK-AB] address count failed, failing open:", addr.error.message);
    } else if (addr.data === false) {
      return { status: "rate_limited_address" };
    }
  }

  // The site's hour: one bucket for every caller (client_write_allowed's
  // per-address bucket sees this function's egress, so it equals the
  // ceiling; the address was counted just above). A failed check fails open.
  const site = await rpc("client_write_allowed", {
    p_scope: GLOBAL_BUDGET_SCOPE,
    p_per_address: GLOBAL_CEILING_PER_HOUR,
    p_ceiling: GLOBAL_CEILING_PER_HOUR,
    p_window_minutes: BUDGET_WINDOW_MINUTES,
  });
  if (site.error) {
    console.error("[TRACK-AB] site budget check failed, failing open:", site.error.message);
  } else if (site.data === false) {
    return { status: "rate_limited_global" };
  }

  const wrote = await rpc("track_ab_event_optimized", {
    p_test_name: ev.testName,
    p_variant: ev.variant,
    p_event_type: ev.eventType,
    p_visitor_id: ev.visitorId,
    p_metadata: ev.metadata ?? {},
    p_client_ip: ev.clientIp,
    p_max_requests: ADDRESS_CEILING_PER_HOUR,
    p_window_minutes: BUDGET_WINDOW_MINUTES,
  });
  if (wrote.error) return { status: "error", error: wrote.error.message };

  const status = (wrote.data as { status?: string } | null)?.status ?? "recorded";
  if (status === "rate_limited") return { status: "rate_limited_address" };
  if (status === "duplicate") return { status: "duplicate" };
  return { status: "recorded" };
}
