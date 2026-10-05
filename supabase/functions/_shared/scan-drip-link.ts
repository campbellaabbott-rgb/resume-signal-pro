/**
 * THE FIX-PLAN EMAILS START ONLY WHEN THE INBOX'S OWNER PRESSES A BUTTON.
 *
 * "Break my fix plan into a short email sequence" used to queue four mails
 * (days 2, 4, 6 and 14) to whatever address was typed, the moment the box was
 * ticked: a third party could enrol any inbox (the 1.59 defect, on the other
 * checkbox). Now a ticked box puts a button in the report mail itself, which
 * goes to that address; nothing is queued until the button's page is opened
 * and pressed (a button, not the page load, because mail scanners open links).
 *
 * The free scan stores nothing, so the plan the sequence needs travels in the
 * link: the address, the score, the report id and up to six steps, signed with
 * an HMAC under a key only our functions hold and good for seven days. The
 * link rides in a URL fragment, which no server and no Referer header ever
 * sees. Opening it re-cleans every step, so the sequence carries nothing the
 * report mail could not.
 */
import { mailSafeText } from "./mail-text.ts";

export const DRIP_LINK_MAX_AGE_S = 7 * 24 * 3600;
const SKEW_S = 300;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type DripPlan = {
  email: string;
  score: number;
  reportId: string | null;
  steps: Array<{ step: string; minutes: number; scoreImpact: number }>;
};

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(`scan-drip:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

const clampInt = (v: unknown, lo: number, hi: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : lo;

function cleanPlan(p: { email: unknown; score: unknown; reportId: unknown; steps: unknown }): DripPlan | null {
  const email = typeof p.email === "string" ? p.email.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  const reportId = typeof p.reportId === "string" && /^[A-Za-z0-9]{6,32}$/.test(p.reportId) ? p.reportId : null;
  const steps = Array.isArray(p.steps)
    ? p.steps.slice(0, 6).map((s) => {
      const a = Array.isArray(s) ? s : [];
      return { step: mailSafeText(a[0], 240), minutes: clampInt(a[1], 0, 600), scoreImpact: clampInt(a[2], -100, 100) };
    }).filter((s) => s.step)
    : [];
  return { email, score: clampInt(p.score, 0, 100), reportId, steps };
}

/** "<payload>.<hmac>" for this plan, issued at `issuedAtS`; "" without a usable key. */
export async function signDripLink(secret: string, plan: DripPlan, issuedAtS = Math.floor(Date.now() / 1000)): Promise<string> {
  if (!secret || secret.length < 32) return "";
  const body = {
    v: 1,
    e: plan.email,
    s: plan.score,
    r: plan.reportId,
    st: plan.steps.slice(0, 6).map((s) => [s.step, s.minutes, s.scoreImpact]),
    at: Math.floor(issuedAtS),
  };
  const payload = b64url(new TextEncoder().encode(JSON.stringify(body)));
  return `${payload}.${await hmacHex(secret, `scan-drip.1|${payload}`)}`;
}

/** The plan a link carries, or null when it is malformed, forged, or older than seven days. */
export async function openDripLink(secret: string, token: unknown, nowMs = Date.now()): Promise<DripPlan | null> {
  if (typeof token !== "string" || token.length > 6000) return null;
  const m = /^([A-Za-z0-9_-]{8,5800})\.([0-9a-f]{64})$/.exec(token);
  if (!m || !secret || secret.length < 32) return null;
  const want = await hmacHex(secret, `scan-drip.1|${m[1]}`);
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ m[2].charCodeAt(i);
  if (d !== 0) return null;
  const bytes = unb64url(m[1]);
  if (!bytes) return null;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!body || body.v !== 1 || typeof body.at !== "number") return null;
  const now = Math.floor(nowMs / 1000);
  if (body.at > now + SKEW_S || now - body.at > DRIP_LINK_MAX_AGE_S) return null;
  return cleanPlan({ email: body.e, score: body.s, reportId: body.r, steps: body.st });
}
