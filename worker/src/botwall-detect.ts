/**
 * The bot-wall signature table, and the one place it is allowed to live.
 *
 * Extracted from probe-botwall.ts on 2026-08-07 when the scheduled sweep
 * needed the same detection. A second copy of this table is the failure this
 * project keeps writing post-mortems about — the July purchase gate landed on
 * the streaming fallbacks and missed the primaries; SENDABLE_VENDORS is
 * deliberately mirrored rather than duplicated for the same reason. A stale
 * copy here would report a walled vendor as clean, which is the direction that
 * gets an adapter built against a wall.
 *
 * MATCHES ON PATH AND QUERY, NOT ON HOST, and that is the whole design.
 * probe-captcha.ts matched known vendor hosts and reported Recruitee clean
 * 10/10 — Recruitee serves hCaptcha from its own CDN
 * (captcha-base.recruiteecdn.com), so a domain allow-list missed it silently
 * and confidently. A detector that only recognises what it was told about will
 * make that mistake again on the next vendor that self-hosts.
 */

export const SIGNS: Array<[string, RegExp]> = [
  ["captcha", /captcha/i],
  ["turnstile", /turnstile/i],
  ["cf-challenge", /challenge-platform|cdn-cgi\/challenge/i],
  ["datadome", /datadome/i],
  ["perimeterx", /perimeterx|px-cloud|px-cdn/i],
  ["imperva", /incapsula|imperva/i],
  ["akamai-bot", /akam\/\d|_bm\/|akamaized.*sensor/i],
  ["fingerprint", /fingerprintjs|fpjs|botd/i],
  ["arkose", /arkoselabs|funcaptcha/i],
];

/** Which wall names does this request URL implicate? Empty means nothing seen. */
export function signsInUrl(url: string): string[] {
  const out: string[] = [];
  for (const [name, re] of SIGNS) if (re.test(url)) out.push(name);
  return out;
}

export type TenantResult = { company: string; walls: string[]; reached: boolean };

/**
 * A vendor's verdict from its sampled tenants.
 *
 * `unknown` is a state, not a rounding of `clean`. A tenant whose page never
 * loaded tells us nothing about its wall, and folding those into "clean" is
 * how a network failure becomes a green light to build an adapter. So the
 * denominator is tenants actually REACHED, and a sweep that reached nobody
 * reports `unknown` rather than a tidy 0/0 clean.
 */
export function vendorVerdict(rows: TenantResult[]): {
  verdict: "walled" | "mixed" | "clean" | "unknown";
  walled: number;
  reached: number;
  walls: string[];
} {
  const reached = rows.filter((r) => r.reached);
  const walled = reached.filter((r) => r.walls.length);
  const walls = [...new Set(reached.flatMap((r) => r.walls))].sort();
  if (reached.length === 0) return { verdict: "unknown", walled: 0, reached: 0, walls };
  if (walled.length === 0) return { verdict: "clean", walled: 0, reached: reached.length, walls };
  if (walled.length === reached.length) return { verdict: "walled", walled: walled.length, reached: reached.length, walls };
  return { verdict: "mixed", walled: walled.length, reached: reached.length, walls };
}

/**
 * Is this result worth waking a human for?
 *
 * Only a vendor going CLEAN or MIXED, because only that changes what can be
 * built — RECON records Workable as "a two-hour adapter if Turnstile ever
 * comes off", and nothing was watching for that. A vendor that is still walled
 * is the expected state and must stay quiet, or the alert becomes the muted
 * kind that is worse than no alert.
 */
export function isOpportunity(verdict: string): boolean {
  return verdict === "clean" || verdict === "mixed";
}
