/**
 * CREDENTIALS THAT ARRIVE IN A URL, AFTER THE FIRST SCRIPT HAS MOVED THEM.
 *
 * A sign-in link, a provider's return and a payment return each carry a
 * usable credential in the address: tokens in the fragment, a token_hash or
 * code in the query, a Stripe session id. The host injects an analytics
 * script that records full URLs, fragments included, and the address bar is
 * what people copy and share. So the first script in index.html's <head> (an
 * inline classic script, which runs before any deferred or module script)
 * moves those parts into this tab's sessionStorage under STASH_KEY and
 * rewrites the address without them. Everything that used to read them from
 * the URL reads them here, with the URL as the fallback for a browser where
 * the stash could not be written (the address is then left untouched).
 *
 * The stash is one JSON object. Its keys:
 * - from the fragment: access_token, refresh_token, expires_at, expires_in,
 *   token_type, provider_token, provider_refresh_token, type, error,
 *   error_code, error_description (only when the fragment carries a token or
 *   an error, so a plain #orders is never touched);
 * - from the query: token_hash, code, and with them type and error*;
 * - session_id on /product-success and /success, with session_id_path naming
 *   which of the two it came from;
 * - fragment: the whole fragment on /email/unsubscribe, /market-pulse/confirm
 *   and /fix-plan/confirm, whose pages parse it themselves;
 * - _at and _path: when and where the last capture happened.
 *
 * src/test/r1-signin-stash.test.ts runs the script from index.html itself.
 */
import { PENDING_SIGN_IN_TTL_MS } from "@/config/auth-providers";

export const STASH_KEY = "rb_url_stash";

type Stash = Record<string, string | number>;

function readStash(): Stash {
  try {
    const raw = sessionStorage.getItem(STASH_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Stash) : {};
  } catch {
    return {};
  }
}

function writeStash(s: Stash): void {
  try {
    const keys = Object.keys(s).filter((k) => !k.startsWith("_"));
    if (keys.length === 0) sessionStorage.removeItem(STASH_KEY);
    else sessionStorage.setItem(STASH_KEY, JSON.stringify(s));
  } catch { /* storage blocked: nothing was stashed either */ }
}

/** The stashed value for a key, left in place (a reload still finds it). */
export function peekStashed(key: string): string | null {
  const v = readStash()[key];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
}

/** The stashed value for a key, removed as it is read (a credential is used once). */
export function takeStashed(key: string): string | null {
  const s = readStash();
  const v = s[key];
  if (v === undefined) return null;
  delete s[key];
  writeStash(s);
  return typeof v === "string" ? v : String(v);
}

/** Forget everything the first script captured (a deliberate sign-out). */
export function clearStash(): void {
  try { sessionStorage.removeItem(STASH_KEY); } catch { /* nothing to clear */ }
}

/** The keys a provider or a sign-in link sets, which travel together. */
export const STASHED_SESSION_KEYS = [
  "access_token", "refresh_token", "expires_at", "expires_in", "token_type",
  "provider_token", "provider_refresh_token", "type", "error", "error_code", "error_description",
] as const;

/** Drop every sign-in credential from the stash at once (used, refused or discarded). */
export function discardStashedSession(): void {
  const s = readStash();
  for (const k of [...STASHED_SESSION_KEYS, "token_hash", "code"]) delete s[k];
  writeStash(s);
}

/**
 * The Stripe session id a payment-return page uses. One still in the address
 * wins: the first script strips it on every load, so one that is there was
 * written after the load (an in-app navigation) or could not be stashed.
 * Otherwise the stash's, when it was captured on this same path.
 */
export function stashedSessionIdFor(path: "/product-success" | "/success", urlValue: string | null): { id: string | null; fromStash: boolean } {
  if (urlValue) return { id: urlValue, fromStash: false };
  const id = peekStashed("session_id");
  if (id && peekStashed("session_id_path") === path) return { id, fromStash: true };
  return { id: null, fromStash: false };
}

/** The fragment a confirm or unsubscribe page parses: the address's when it has one, else the stash's. */
export function stashedFragment(urlHash: string): string {
  return urlHash && urlHash !== "#" ? urlHash : (peekStashed("fragment") ?? "");
}

// ── where to go after signing in ────────────────────────────────────────────

/**
 * ONLY A SAME-ORIGIN RELATIVE PATH IS HONOURED. `next` arrives in a URL
 * anyone can write, so an absolute URL, a scheme, a protocol-relative
 * `//host` or a backslash (browsers read `/\host` as `//host`) would turn
 * the sign-in page into an open redirect. Anything that is not a plain path
 * starting with a single slash falls back to the account page.
 */
export const DEFAULT_AFTER_AUTH = "/account";
export function safeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== "string") return DEFAULT_AFTER_AUTH;
  const s = raw.trim();
  if (!s.startsWith("/") || s.startsWith("//") || /[\\\s]/.test(s) || /^\/[^/?#]*:/.test(s)) return DEFAULT_AFTER_AUTH;
  return s;
}

// ── the sign-in this browser started ────────────────────────────────────────

/**
 * THE PENDING-SIGN-IN MARKER (login-CSRF protection). A session that arrives
 * in a URL (a provider's return, a link from the mail) is adopted without a
 * question only when THIS browser started a sign-in within the last hour.
 * Otherwise the person is asked first, because a crafted link could sign a
 * victim into the sender's account and collect what they upload there.
 * localStorage, not sessionStorage: a link opened from the mail lands in a
 * new tab.
 */
export const PENDING_KEY = "rb_auth_pending";
export const PENDING_TTL_MS = PENDING_SIGN_IN_TTL_MS;

export type PendingSignIn = { at: number; next: string };

export function setPendingSignIn(next: string | null | undefined, now: number = Date.now()): void {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ at: now, next: safeNextPath(next) })); } catch { /* storage blocked: links ask first */ }
}

export function readPendingSignIn(now: number = Date.now()): PendingSignIn | null {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null") as { at?: unknown; next?: unknown } | null;
    if (!raw || typeof raw.at !== "number" || !Number.isFinite(raw.at)) return null;
    if (raw.at > now + 60_000 || now - raw.at > PENDING_TTL_MS) return null;
    return { at: raw.at, next: safeNextPath(typeof raw.next === "string" ? raw.next : null) };
  } catch {
    return null;
  }
}

export function clearPendingSignIn(): void {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* nothing to clear */ }
}

// ── showing an address without disclosing it ────────────────────────────────

/** "jane@gmail.com" -> "j***@gmail.com". Idempotent; never returns the whole local part. */
export function maskEmail(email: string | null | undefined): string {
  const s = String(email ?? "").trim();
  const at = s.lastIndexOf("@");
  if (at < 0) return s ? `${s.slice(0, 1)}***` : "";
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

/** The claims of a JWT, read without checking its signature (for display and keys only). */
export function jwtClaims(token: string | null | undefined): Record<string, unknown> | null {
  try {
    const part = String(token ?? "").split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const json = decodeURIComponent(Array.from(atob(b64), (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""));
    const claims = JSON.parse(json);
    return claims && typeof claims === "object" ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The newest authentication method a session's token records (otp, password, oauth, recovery, ...). */
export function newestAmr(token: string | null | undefined): string | null {
  const amr = jwtClaims(token)?.amr;
  if (!Array.isArray(amr)) return null;
  let best: { method: string; ts: number } | null = null;
  for (const e of amr) {
    const method = (e as { method?: unknown })?.method;
    const ts = Number((e as { timestamp?: unknown })?.timestamp ?? 0);
    if (typeof method === "string" && (!best || ts >= best.ts)) best = { method, ts };
  }
  return best?.method ?? null;
}
