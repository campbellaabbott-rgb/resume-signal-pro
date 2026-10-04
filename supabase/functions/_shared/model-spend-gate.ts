/**
 * ONE GATE IN FRONT OF EVERY PUBLIC MODEL CALL.
 *
 * WHAT WAS WRONG (defect sweep 2026-10-02, items 1.06 and 1.64). About twenty
 * edge functions that call the AI gateway on the project's own key answer the
 * publishable key, and each carried its own copy of a per-address limiter keyed
 * on the FIRST x-forwarded-for hop. That hop is whatever the caller wrote, so a
 * script that sent a fresh value per request got a fresh bucket per request and
 * the limiter never fired. Two copies read `allowed === false`, so a limiter
 * error (or an address longer than check_rate_limit's 45 characters, which makes
 * it raise) skipped the limit entirely. generate-summary had no limiter at all.
 *
 * WHAT THIS DOES, in order, before any model is called:
 *   1. A caller holding the service-role key is one of our own servers (the
 *      apply agent drafts answers in batches from one egress address) and is
 *      not counted. Nobody outside the project holds that key.
 *   2. The caller's address is the PLATFORM'S word (_shared/client-address.ts:
 *      cf-connecting-ip, else the last forwarded hop, never the first), with
 *      IPv6 cut to its /64 because one host rotates freely inside it. That
 *      address spends from a bucket of its own in THIS function only
 *      (check_rate_limit, p_function = the function's name). Never the
 *      cross-function request budget: a budget shared across functions once
 *      refused resume upload and checkout because board browsing fed it.
 *   3. For an endpoint a stranger can reach the model through without paying,
 *      a second bucket named "global" bounds what the whole internet can spend
 *      on that one function in an hour, whatever addresses it arrives from: a
 *      rotating address pool gets a fresh per-address bucket per address, and
 *      this is the only bound against one. A request carrying a session that
 *      used_stripe_sessions holds (a purchase being delivered) is not charged
 *      to it, so a paying customer is never refused because strangers spent the
 *      free allowance.
 *   4. Any failure to count -- an RPC error, a null answer, a thrown call, no
 *      database client at all -- is a refusal (503, limiter_unavailable). A
 *      limiter that fails open is a limiter a caller can switch off.
 *
 * Every refusal is a JSON body with `error` (the sentence a person reads),
 * `code` naming which limit fired, `limit`, `retryable: true` and a numeric
 * Retry-After header, so a 429 says which allowance ran out.
 */
import { clientAddress } from "./client-address.ts";

/** The bucket name for the function-wide ceiling. No address spells this. */
export const GLOBAL_BUCKET = "global";

export type SpendLimits = {
  /** Calls one address may make to this function per window. */
  perAddress: number;
  /** The address window in minutes (check_rate_limit accepts 1..1440). Default 60. */
  windowMinutes?: number;
  /**
   * Calls the whole internet may make to this function per hour. Set it on an
   * endpoint a stranger reaches the model through without paying; leave it out
   * on a purchase-gated generator, where a stranger is refused before any model
   * call and a function-wide ceiling would only let strangers lock buyers out.
   */
  globalPerHour?: number;
};

export type SpendRefusalCode = "rate_limited_function" | "rate_limited_global" | "limiter_unavailable";

// Loose client type so the real SupabaseClient and a test fake both fit. Only
// rpc(...) and from(...).select(...).eq(...).maybeSingle() are used.
// deno-lint-ignore no-explicit-any
export type SpendDb = { rpc: (fn: string, args: Record<string, unknown>) => any; from: (table: string) => any };

// ── the address, as one bucket ────────────────────────────────────────────

function v4Parts(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n <= 255) ? p : null;
}

function v6Words(s: string): number[] | null {
  if (!s.includes(":") || !/^[0-9a-f:.]+$/.test(s)) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const words = (part: string, dottedTail: boolean): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    const bits = part.split(":");
    for (let i = 0; i < bits.length; i++) {
      const b = bits[i];
      if (dottedTail && i === bits.length - 1 && b.includes(".")) {
        const q = v4Parts(b);
        if (!q) return null;
        out.push((q[0] << 8) | q[1], (q[2] << 8) | q[3]);
      } else if (/^[0-9a-f]{1,4}$/.test(b)) out.push(parseInt(b, 16));
      else return null;
    }
    return out;
  };
  if (halves.length === 1) {
    const all = words(halves[0], true);
    return all && all.length === 8 ? all : null;
  }
  const head = words(halves[0], false);
  const tail = words(halves[1], true);
  if (!head || !tail) return null;
  const fill = 8 - head.length - tail.length;
  return fill < 1 ? null : [...head, ...new Array<number>(fill).fill(0), ...tail];
}

/**
 * One address as one bucket: IPv4 as itself (an IPv4-mapped IPv6 address
 * included), IPv6 cut to its /64. Anything that does not parse keeps its own
 * text, cut to the 45 characters check_rate_limit accepts (it RAISES on a
 * longer one, and a raise must never be what decides whether a limit applies).
 * No address at all is "unknown". For a public address this is the same key
 * job-board's addressKey gives; a test holds the two equal.
 */
export function spendAddressKey(h: Headers): string {
  const { address } = clientAddress(h);
  if (!address) return "unknown";
  let s = address.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracketed) s = bracketed[1];
  s = s.replace(/%.*$/, "");
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(s);
  if (withPort) s = withPort[1];
  const q = v4Parts(s);
  if (q) return q.join(".");
  const w = v6Words(s);
  if (!w) return s.slice(0, 45) || "unknown";
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) {
    return [w[6] >> 8, w[6] & 255, w[7] >> 8, w[7] & 255].join(".");
  }
  return `${w.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
}

/** True only for a request bearing the project's service-role key (never an empty one). */
export function isServiceCaller(h: Headers, serviceKey: string | undefined): boolean {
  const service = (serviceKey ?? "").trim();
  if (!service) return false;
  const auth = h.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const apikey = (h.get("apikey") ?? "").trim();
  return bearer === service || apikey === service;
}

// ── the refusal ───────────────────────────────────────────────────────────

const MESSAGES: Record<SpendRefusalCode, string> = {
  rate_limited_function: "You've reached the limit for this tool for now. Please try again later.",
  rate_limited_global: "This tool is very busy right now. Please try again later.",
  limiter_unavailable: "This tool is temporarily unavailable. Please try again in a minute.",
};

export function spendRefusal(
  code: SpendRefusalCode,
  limit: number | null,
  cors: Record<string, string>,
): Response {
  const status = code === "limiter_unavailable" ? 503 : 429;
  const retryAfter = code === "limiter_unavailable" ? "60" : "3600";
  return new Response(
    JSON.stringify({ error: MESSAGES[code], code, limit, retryable: true }),
    { status, headers: { ...cors, "Content-Type": "application/json", "Retry-After": retryAfter } },
  );
}

/** true / false from check_rate_limit, or null for anything that is not an answer. */
async function counted(db: SpendDb, args: Record<string, unknown>): Promise<boolean | null> {
  try {
    const { data, error } = await db.rpc("check_rate_limit", args);
    if (error) return null;
    return typeof data === "boolean" ? data : null;
  } catch {
    return null;
  }
}

/** A session id that used_stripe_sessions holds: a purchase is being delivered. */
async function sessionWasClaimed(db: SpendDb, sessionId: unknown): Promise<boolean> {
  if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 255) return false;
  try {
    const { data, error } = await db.from("used_stripe_sessions").select("session_id").eq("session_id", sessionId).maybeSingle();
    return !error && !!data;
  } catch {
    return false;
  }
}

/**
 * null when the call may go on to the model; otherwise the Response to return.
 * `fn` is the bucket's function name: pass the function's own name, so its
 * existing rate_limits rows keep counting across the deploy.
 */
export async function modelSpendGate(
  db: SpendDb | null | undefined,
  req: Request,
  fn: string,
  limits: SpendLimits,
  cors: Record<string, string>,
  opts: { paidSessionId?: unknown } = {},
): Promise<Response | null> {
  const serviceKey = (globalThis as { Deno?: { env?: { get?: (k: string) => string | undefined } } }).Deno?.env?.get?.("SUPABASE_SERVICE_ROLE_KEY");
  if (isServiceCaller(req.headers, serviceKey)) return null;
  if (!db) return spendRefusal("limiter_unavailable", null, cors);

  const mine = await counted(db, {
    p_function: fn,
    p_ip: spendAddressKey(req.headers),
    p_max_requests: limits.perAddress,
    p_window_minutes: limits.windowMinutes ?? 60,
  });
  if (mine === null) return spendRefusal("limiter_unavailable", null, cors);
  if (mine === false) return spendRefusal("rate_limited_function", limits.perAddress, cors);

  if (limits.globalPerHour === undefined) return null;
  if (await sessionWasClaimed(db, opts.paidSessionId)) return null;
  const world = await counted(db, {
    p_function: fn,
    p_ip: GLOBAL_BUCKET,
    p_max_requests: limits.globalPerHour,
    p_window_minutes: 60,
  });
  if (world === null) return spendRefusal("limiter_unavailable", null, cors);
  if (world === false) return spendRefusal("rate_limited_global", limits.globalPerHour, cors);
  return null;
}

// ── input bounds for the short fields ─────────────────────────────────────

/**
 * A caller-supplied string as prompt data: control characters (newlines
 * included) become spaces, so a field cannot open a new line of instructions,
 * and the result is cut to `max`. undefined for anything that is not a string,
 * so `${x || "Not specified"}` fallbacks keep working.
 */
export function clipField(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  // deno-lint-ignore no-control-regex
  return v.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, max);
}

/** A caller-supplied block of prose (newlines kept) cut to `max`; undefined for a non-string. */
export function clipText(v: unknown, max: number): string | undefined {
  return typeof v === "string" ? v.slice(0, max) : undefined;
}

/** Up to `maxItems` strings from an array, each clipped like clipField; [] for anything else. */
export function clipList(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").slice(0, maxItems).map((x) => clipField(x, maxLen) ?? "");
}
