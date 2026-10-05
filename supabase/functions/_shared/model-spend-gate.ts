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
 * WHAT THIS DOES, in order, before any model is called. Every bucket is a
 * check_rate_limit row named after the calling function, never the
 * cross-function request budget: a budget shared across functions once
 * refused resume upload and checkout because board browsing fed it.
 *
 *   1. OUR OWN SERVERS. A caller holding the service-role key (the webhook,
 *      the purchase verifier, the retry sweep, the apply agent) is not counted
 *      by address or by any function-wide allowance: deliveries to paying
 *      customers must never queue behind strangers. If it names the purchase
 *      it is delivering, that purchase's daily allowance (step 3) still
 *      counts, because the verifier regenerates on every success-page refresh
 *      until content is saved and a buyer can trigger that from anywhere.
 *   2. THE ADDRESS. The platform's word for it (_shared/client-address.ts:
 *      cf-connecting-ip, else the last forwarded hop, never the first), IPv6
 *      cut to its /64 because one host rotates freely inside it.
 *   3. THE PURCHASE. A session id is one purchase, and one purchase must not
 *      feed a whole address pool: it gets its own daily bucket (`sess:` and a
 *      hash of the id, so the id itself is never written down). On a
 *      purchase-gated generator the function has already checked the purchase
 *      and this bucket is a hard limit. On a free generator the gate checks
 *      the purchase itself -- used_stripe_sessions must hold the session with
 *      a product_type this function delivers (a NULL or another product, the
 *      $2 scan pack for instance, is no purchase here) -- and while the bucket
 *      lasts the call skips step 4; past it, the call is charged to step 4
 *      like anyone's rather than refused.
 *   4. THE FUNCTION AS A WHOLE, on endpoints a stranger reaches the model
 *      through without paying. A rotating pool gets a fresh address bucket per
 *      address, so a function-wide hourly ceiling is the only bound against
 *      one. Two of them: a caller who has PROVEN something -- a signed-in
 *      account, or a browser holding a board pass (a solved Turnstile
 *      challenge) -- spends an allowance of its own (`user:` / `pass:`, the
 *      address allowance's size) and then the "proven" ceiling; everyone else
 *      spends the "global" one. A pool that spends the anonymous ceiling
 *      therefore cannot lock out a person who signed in or proved a browser,
 *      and the worst an hour can cost is still two fixed numbers.
 *   5. Any failure to count -- an RPC error, a null answer, a thrown call, no
 *      database client at all -- is a refusal (503, limiter_unavailable). A
 *      limiter that fails open is a limiter a caller can switch off.
 *
 * The address is counted before the ceiling on purpose: the other order lets
 * one address that has spent its own allowance keep draining the shared one.
 * The cost is that a call the ceiling refuses has used an address slot;
 * check_rate_limit has no refund, and adding one is a migration.
 *
 * Every refusal is a JSON body with `error` (the sentence a person reads),
 * `code` naming which limit fired, `limit`, `retryable: true` and a numeric
 * Retry-After header, so a 429 says which allowance ran out.
 */
import { clientAddress } from "./client-address.ts";
import { boardPassId } from "./board-pass-verify.ts";

/** The anonymous function-wide bucket. No address spells this. */
export const GLOBAL_BUCKET = "global";
/** The function-wide bucket for signed-in accounts and board-pass holders. */
export const PROVEN_BUCKET = "proven";
/** Calls one purchase may make to one function in a day, unless the function says otherwise. */
export const DEFAULT_PER_SESSION_PER_DAY = 10;

export type SpendLimits = {
  /** Calls one address may make to this function per window. */
  perAddress: number;
  /** The address window in minutes (check_rate_limit accepts 1..1440). Default 60. */
  windowMinutes?: number;
  /**
   * Calls the whole internet may make to this function per hour (and, as a
   * separate allowance, signed-in and board-pass callers). Set it on an
   * endpoint a stranger reaches the model through without paying; leave it
   * out on a purchase-gated generator, where the purchase allowance bounds
   * each buyer and a function-wide ceiling would only let strangers lock
   * buyers out.
   */
  globalPerHour?: number;
  /** Calls one purchase may make to this function per day. Default DEFAULT_PER_SESSION_PER_DAY. */
  perSessionPerDay?: number;
};

export type SpendOptions = {
  /**
   * The purchase this call delivers: the Stripe session id (or pro_ grant id).
   * On a purchase-gated generator, pass it only AFTER the function has checked
   * it (assertPaidSession or its own Stripe lookup).
   */
  session?: unknown;
  /**
   * Free generators only: the product_type values whose purchase this function
   * delivers. Without it no session is a purchase here.
   */
  products?: readonly string[];
  /** A board pass the page sent in the body (job-board signs it; see _shared/board-pass-verify.ts). */
  boardPass?: unknown;
};

export type SpendRefusalCode =
  | "rate_limited_function"
  | "rate_limited_session"
  | "rate_limited_global"
  | "limiter_unavailable";

// Loose client type so the real SupabaseClient and a test fake both fit. Only
// rpc(...), from(...).select(...).eq(...).maybeSingle() and auth.getUser(jwt)
// are used.
// deno-lint-ignore no-explicit-any
export type SpendDb = { rpc: (fn: string, args: Record<string, unknown>) => any; from: (table: string) => any; auth?: { getUser: (jwt: string) => any } };

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
  rate_limited_session: "This purchase has been generated as many times as we allow in one day. Please try again tomorrow.",
  rate_limited_global: "This tool is very busy right now. Please try again later.",
  limiter_unavailable: "This tool is temporarily unavailable. Please try again in a minute.",
};

const RETRY_AFTER: Record<SpendRefusalCode, string> = {
  rate_limited_function: "3600",
  rate_limited_session: "86400",
  rate_limited_global: "3600",
  limiter_unavailable: "60",
};

export function spendRefusal(
  code: SpendRefusalCode,
  limit: number | null,
  cors: Record<string, string>,
): Response {
  const status = code === "limiter_unavailable" ? 503 : 429;
  return new Response(
    JSON.stringify({ error: MESSAGES[code], code, limit, retryable: true }),
    { status, headers: { ...cors, "Content-Type": "application/json", "Retry-After": RETRY_AFTER[code] } },
  );
}

// ── counting ──────────────────────────────────────────────────────────────

function env(k: string): string | undefined {
  return (globalThis as { Deno?: { env?: { get?: (k: string) => string | undefined } } }).Deno?.env?.get?.(k);
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

/** A session id worth looking at: a non-empty string no longer than a real one. */
function sessionOf(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= 255 ? v : null;
}

/**
 * One purchase's bucket name. A hash, so the session id -- which is what a
 * success page proves a purchase with -- is never written into rate_limits;
 * "sess:" plus 32 hex is 37 characters, inside check_rate_limit's 45.
 */
export async function sessionBucket(sessionId: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`spend-session:${sessionId}`));
  const hex = Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
  return `sess:${hex.slice(0, 32)}`;
}

function countSession(db: SpendDb, fn: string, session: string, perDay: number): Promise<boolean | null> {
  return sessionBucket(session).then((p_ip) =>
    counted(db, { p_function: fn, p_ip, p_max_requests: perDay, p_window_minutes: 1440 })
  );
}

/**
 * True only when used_stripe_sessions holds this session with a product_type
 * this function delivers. A NULL product_type is no purchase here, and neither
 * is another product: a $2 scan pack used to switch off the ceiling.
 */
async function deliversProduct(db: SpendDb, session: string, products: readonly string[]): Promise<boolean> {
  try {
    const { data, error } = await db.from("used_stripe_sessions")
      .select("session_id, product_type").eq("session_id", session).maybeSingle();
    if (error || !data) return false;
    const bought = (data as { product_type?: unknown }).product_type;
    return typeof bought === "string" && products.includes(bought);
  } catch {
    return false;
  }
}

// ── a caller who has proven something ─────────────────────────────────────

function bearerOf(h: Headers): string {
  const m = /^bearer\s+(.+)$/i.exec((h.get("authorization") ?? "").trim());
  return m ? m[1].trim() : "";
}

/**
 * A JWT's claims read WITHOUT verifying the signature -- only to decide
 * whether verifying it is worth a round trip. The publishable key is itself a
 * JWT whose role is anon; a signed-in browser sends its access token, role
 * authenticated. Nothing here is trusted until auth.getUser confirms it.
 */
function unverifiedClaims(jwt: string): { role?: unknown; is_anonymous?: unknown } | null {
  const parts = jwt.length <= 4096 ? jwt.split(".") : [];
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return claims && typeof claims === "object" ? claims : null;
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "pass:<id>" for a valid board pass, "user:<uuid>" for a verified signed-in
 * account (an anonymous sign-in is not one: it costs nothing to mint), or null
 * for an anonymous caller. Both names fit check_rate_limit's 45 characters.
 */
async function provenCaller(db: SpendDb, h: Headers, boardPass: unknown): Promise<string | null> {
  const pass = await boardPassId(boardPass, env("SUPABASE_SERVICE_ROLE_KEY"), env("TURNSTILE_SECRET_KEY"));
  if (pass) return `pass:${pass}`;
  const jwt = bearerOf(h);
  const claims = jwt ? unverifiedClaims(jwt) : null;
  if (!claims || claims.role !== "authenticated" || claims.is_anonymous === true) return null;
  if (typeof db.auth?.getUser !== "function") return null;
  try {
    const { data, error } = await db.auth.getUser(jwt);
    const user = data?.user as { id?: unknown; is_anonymous?: unknown } | undefined;
    if (error || !user || user.is_anonymous === true || typeof user.id !== "string" || !UUID.test(user.id)) return null;
    return `user:${user.id.toLowerCase()}`;
  } catch {
    return null;
  }
}

// ── the gate ──────────────────────────────────────────────────────────────

/**
 * One purchase's daily allowance on its own. modelSpendGate applies it; a
 * generator whose purchase check is itself expensive (freelance-boost asks
 * Stripe) counts the address with modelSpendGate first, checks the purchase,
 * and then calls this. null when there is no session to count.
 */
export async function purchaseSpendGate(
  db: SpendDb | null | undefined,
  fn: string,
  session: unknown,
  perDay: number,
  cors: Record<string, string>,
): Promise<Response | null> {
  const id = sessionOf(session);
  if (!id) return null;
  if (!db) return spendRefusal("limiter_unavailable", null, cors);
  const ok = await countSession(db, fn, id, perDay);
  if (ok === null) return spendRefusal("limiter_unavailable", null, cors);
  return ok ? null : spendRefusal("rate_limited_session", perDay, cors);
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
  opts: SpendOptions = {},
): Promise<Response | null> {
  const session = sessionOf(opts.session);
  const perSession = limits.perSessionPerDay ?? DEFAULT_PER_SESSION_PER_DAY;

  // 1. Our own servers: never counted by address or ceiling; a named purchase still is.
  if (isServiceCaller(req.headers, env("SUPABASE_SERVICE_ROLE_KEY"))) {
    return purchaseSpendGate(db, fn, session, perSession, cors);
  }
  if (!db) return spendRefusal("limiter_unavailable", null, cors);

  // 2. The address.
  const mine = await counted(db, {
    p_function: fn,
    p_ip: spendAddressKey(req.headers),
    p_max_requests: limits.perAddress,
    p_window_minutes: limits.windowMinutes ?? 60,
  });
  if (mine === null) return spendRefusal("limiter_unavailable", null, cors);
  if (mine === false) return spendRefusal("rate_limited_function", limits.perAddress, cors);

  // 3a. A purchase-gated generator: the function checked the purchase; its day is a hard limit.
  if (limits.globalPerHour === undefined) return purchaseSpendGate(db, fn, session, perSession, cors);

  // 3b. A free generator delivering a purchase of what it sells: off the ceiling while its day lasts.
  if (session && opts.products && opts.products.length > 0 && await deliversProduct(db, session, opts.products)) {
    if (await countSession(db, fn, session, perSession) === true) return null;
    // Spent (or uncountable): charged to the ceiling below like any caller, never refused for it.
  }

  // 4. The function as a whole: proven callers and strangers spend separate allowances.
  const who = await provenCaller(db, req.headers, opts.boardPass);
  if (who) {
    const own = await counted(db, {
      p_function: fn,
      p_ip: who,
      p_max_requests: limits.perAddress,
      p_window_minutes: limits.windowMinutes ?? 60,
    });
    if (own === null) return spendRefusal("limiter_unavailable", null, cors);
    if (own === false) return spendRefusal("rate_limited_function", limits.perAddress, cors);
  }
  const world = await counted(db, {
    p_function: fn,
    p_ip: who ? PROVEN_BUCKET : GLOBAL_BUCKET,
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
