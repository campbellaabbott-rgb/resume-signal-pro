/**
 * A CALLER THAT HOLDS THE SERVICE-ROLE KEY, AND NOBODY ELSE.
 *
 * Four mail senders (send-product-email, send-analysis-email,
 * send-affiliate-commission-email, and the batch half of send-market-pulse)
 * were meant to be called only by our own servers, and each was reachable by
 * anyone with the publishable key that ships in the browser bundle -- or with
 * no key at all where verify_jwt is off. Each sends from the verified
 * resumebooster.work domain to whatever address the body names, so each was a
 * relay: a phishing mail that passes SPF and DKIM for our domain, as many times
 * as a script cares to post it (defect sweep 2026-10-02, 1.15 / 2.08 / 2.23).
 *
 * The internal callers sent the PUBLISHABLE key as their bearer, which proves
 * nothing: every visitor has it. They now send the service-role key, which only
 * our own functions hold, and these senders accept nothing else.
 *
 * The comparison is constant-time so a timing probe cannot recover the key a
 * byte at a time, and a key shorter than any real one (an unset env var read
 * as "") can never match.
 */

/** The token after "Bearer ", or "" when the header is absent or another scheme. */
export function bearerOf(h: Headers): string {
  const a = (h.get("authorization") ?? "").trim();
  const m = /^bearer\s+(.+)$/i.exec(a);
  return m ? m[1].trim() : "";
}

/** Constant-time equality for two secrets; false for either one empty. */
export function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** True only when the request's bearer IS the service-role key. */
export function isServiceRoleCaller(h: Headers, serviceKey: string): boolean {
  if (!serviceKey || serviceKey.length < 32) return false;
  return sameSecret(bearerOf(h), serviceKey);
}

