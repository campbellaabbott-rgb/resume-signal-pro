/**
 * THE CALLER'S ADDRESS, AS THE PLATFORM STATES IT, NEVER AS THE CALLER DOES.
 *
 * cf-connecting-ip first: Cloudflare sets it on every request and refuses one a
 * client wrote itself (403, error code 1000; measured 2026-10-03). Then the LAST
 * x-forwarded-for hop, the one the nearest proxy appended. Never the first hop:
 * that is whatever the client wrote, so a limiter keyed on it lets each request
 * pick its own bucket (defect-sweep 1.64: about twenty public model endpoints
 * keyed their per-address limit on it).
 *
 * The same rule as job-board/anon-budget.ts callerAddress, which the board's
 * forgery probes verify live (verify-deploy 7j); a test keeps the two equal.
 */
export type ClientAddressSource = "cf" | "xff" | "none";

export function clientAddress(h: Headers): { address: string; source: ClientAddressSource } {
  const cf = h.get("cf-connecting-ip")?.trim();
  if (cf) return { address: cf, source: "cf" };
  const hops = (h.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const last = hops.at(-1);
  return last ? { address: last, source: "xff" } : { address: "", source: "none" };
}

/** The address for a rate-limit key, or `fallback` when the platform named none. */
export function clientAddressOr(h: Headers, fallback = "unknown"): string {
  return clientAddress(h).address || fallback;
}
