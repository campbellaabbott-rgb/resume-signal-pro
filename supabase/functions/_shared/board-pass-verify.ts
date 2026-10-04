/**
 * THE BOARD PASS, AS A MODEL ENDPOINT READS IT.
 *
 * job-board signs a half-hour pass for a browser that finished a Cloudflare
 * Turnstile check (supabase/functions/job-board/board-pass.ts). A rotating
 * proxy pool walks past any per-address allowance; a pass costs it one solved
 * challenge per browser. The spend gate (_shared/model-spend-gate.ts) lets a
 * request carrying a valid pass count against an allowance of its own instead
 * of the anonymous function-wide one, so a pool that spends the anonymous
 * allowance cannot lock out a person who proved they are a browser.
 *
 * WHY A COPY AND NOT AN IMPORT. A function is deployed with its own directory
 * and _shared; nothing in this repository has ever imported from another
 * function's directory, so whether a deploy carries such an import is not
 * known, and twenty-odd generators would fail to deploy together if it does
 * not. This is the verification half only (no signing, no Turnstile call),
 * and src/test/the-spend-gate-lets-a-proven-caller-past-a-spent-anonymous-allowance.test.ts
 * signs passes with job-board's own signer and holds this file to the same
 * verdicts, so the two cannot drift apart silently.
 *
 * INERT UNTIL CONFIGURED, like the board: without TURNSTILE_SECRET_KEY (or
 * without the service key the signature is derived from) no pass is valid,
 * and every caller is simply anonymous.
 */

const TTL_S = 30 * 60;
const SHAPE = /^v1\.(\d{10})\.([0-9a-f]{32})\.([0-9a-f]{64})$/;
const enc = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function signatureOf(payload: string, serviceKey: string): Promise<string> {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`${serviceKey}:board-pass`));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

function sameHex(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * The pass's id (the first 16 hex of its nonce, the same id job-board meters a
 * pass by) when `pass` is one job-board signed with this service key, is
 * unexpired, and is not dated further ahead than a pass is ever signed for.
 * null for anything else, and for everyone while the feature is not
 * configured.
 */
export async function boardPassId(
  pass: unknown,
  serviceKey: string | undefined,
  secret: string | undefined,
  now = Date.now(),
): Promise<string | null> {
  if (!serviceKey || !secret || typeof pass !== "string") return null;
  const offered = pass.trim();
  const m = offered.length <= 120 ? SHAPE.exec(offered) : null;
  if (!m) return null;
  const exp = Number(m[1]) * 1000;
  if (exp <= now || exp > now + (TTL_S + 300) * 1000) return null;
  const ok = sameHex(m[3], await signatureOf(`v1.${m[1]}.${m[2]}`, serviceKey));
  return ok ? m[2].slice(0, 16) : null;
}
