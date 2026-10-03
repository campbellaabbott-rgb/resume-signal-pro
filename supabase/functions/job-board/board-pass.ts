/**
 * THE BOARD PASS: proof that a browser finished a Cloudflare Turnstile check
 * in the last half hour. A rotating proxy pool walks past a per-address cap;
 * a pass costs it a solved challenge per browser, which a headless pool cannot
 * share around cheaply. Why, and the owner's levers: docs/job-board-deploy-notes.md
 * (2026-09-09.87). Pure apart from the fetch it is handed, so vitest imports it.
 *
 * INERT UNTIL CONFIGURED. Without TURNSTILE_SECRET_KEY every caller's state is
 * 'unconfigured', which the counter never refuses, and the board-pass action
 * answers 503: a missing secret must never take the board down.
 *
 * A pass is "v1.<exp>.<nonce>.<sig>": exp in unix seconds, a random nonce, and
 * sig the hex HMAC-SHA256 of "v1.<exp>.<nonce>" under a key DERIVED from the
 * service-role key (never the raw key; the style of _shared/board-reader-key.ts).
 * It is not bound to the address: a pool rotates, and so does a phone.
 */

/** The request header a browser carries its pass in. Listed in job-board's CORS allow-list. */
export const BOARD_PASS_HEADER = "x-rb-pass";
/** A pass lives half an hour. */
export const BOARD_PASS_TTL_S = 30 * 60;
export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const SITEVERIFY_TIMEOUT_MS = 5_000;
/** Where a Turnstile token may have been solved: the site, and the project's lovable.app host. */
export const BOARD_PASS_HOSTS: ReadonlySet<string> = new Set([
  "resumebooster.work", "www.resumebooster.work", "resumebooster.lovable.app",
]);

export type PassState = "valid" | "invalid" | "none" | "unconfigured";

const enc = new TextEncoder();
const hexOf = (u: Uint8Array): string => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const hex = (buf: ArrayBuffer): string => hexOf(new Uint8Array(buf));

async function sigOf(payload: string, serviceKey: string): Promise<string> {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`${serviceKey}:board-pass`));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

/** Constant time over equal-length hex. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length || !a) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function signBoardPass(serviceKey: string, now = Date.now()): Promise<{ pass: string; expiresAt: string }> {
  const exp = Math.floor(now / 1000) + BOARD_PASS_TTL_S;
  const body = `v1.${exp}.${hexOf(crypto.getRandomValues(new Uint8Array(16)))}`;
  return { pass: `${body}.${await sigOf(body, serviceKey)}`, expiresAt: new Date(exp * 1000).toISOString() };
}

const PASS_SHAPE = /^v1\.(\d{10})\.([0-9a-f]{32})\.([0-9a-f]{64})$/;

/** Signed by us with this service key, unexpired, and not dated further ahead than we ever sign. */
export async function verifyBoardPass(pass: string, serviceKey: string, now = Date.now()): Promise<boolean> {
  const m = serviceKey && pass.length <= 120 ? PASS_SHAPE.exec(pass) : null;
  if (!m) return false;
  const exp = Number(m[1]) * 1000;
  if (exp <= now || exp > now + (BOARD_PASS_TTL_S + 300) * 1000) return false;
  return sameHex(m[3], await sigOf(`v1.${m[1]}.${m[2]}`, serviceKey));
}

/** What the gate knows of this request's pass. No secret (or no service key to sign with): 'unconfigured' for everyone. */
export async function passStateOf(h: Headers, serviceKey: string, secret: string, now = Date.now()): Promise<PassState> {
  if (!secret || !serviceKey) return "unconfigured";
  const offered = (h.get(BOARD_PASS_HEADER) ?? "").trim();
  if (!offered) return "none";
  return (await verifyBoardPass(offered, serviceKey, now)) ? "valid" : "invalid";
}

type Siteverify = { success?: unknown; hostname?: unknown; "error-codes"?: unknown };

/**
 * The board-pass action: a Turnstile token in, a pass out. Not counted and no
 * database. 503 without the secret; 403 with Cloudflare's error codes when the
 * token fails or was solved on a host we do not serve; 503 when siteverify
 * cannot be reached inside its deadline.
 */
export async function boardPassAction(
  body: Record<string, unknown>,
  opts: { secret: string; serviceKey: string; remoteip: string; fetch?: typeof fetch; now?: number; timeoutMs?: number },
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!opts.secret || !opts.serviceKey) return { status: 503, body: { error: "board_pass_unconfigured" } };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token || token.length > 4096) return { status: 403, body: { error: "board_pass_failed", codes: ["missing-input-response"] } };
  const form = new URLSearchParams({ secret: opts.secret, response: token });
  if (opts.remoteip) form.set("remoteip", opts.remoteip);
  let out: Siteverify | null;
  try {
    const res = await (opts.fetch ?? fetch)(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(opts.timeoutMs ?? SITEVERIFY_TIMEOUT_MS),
    });
    out = await res.json() as Siteverify | null;
  } catch (e) {
    console.warn("[JOB-BOARD] board-pass siteverify unavailable:", String(e).slice(0, 120));
    return { status: 503, body: { error: "board_pass_failed", codes: ["siteverify-unavailable"] } };
  }
  const raw = out?.["error-codes"];
  const codes = (Array.isArray(raw) ? raw : []).filter((c): c is string => typeof c === "string").slice(0, 8);
  if (out?.success !== true) return { status: 403, body: { error: "board_pass_failed", codes } };
  const host = typeof out.hostname === "string" ? out.hostname.toLowerCase() : "";
  if (!BOARD_PASS_HOSTS.has(host)) return { status: 403, body: { error: "board_pass_failed", codes: [...codes, "hostname-not-allowed"] } };
  return { status: 200, body: await signBoardPass(opts.serviceKey, opts.now) };
}
