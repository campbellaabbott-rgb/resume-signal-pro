// WHO MAY SCORE A RESUME ON POST /v1/fit, AND HOW OFTEN (owner decision
// 2026-10-11, MCP economics decision 2).
//
// Fit scoring is a dictionary scorer in job-fit: no AI call, and the website
// already gives it away at 60 an hour per address. Keeping it paid-only on
// /v1 recreated the two-doors gap agent-mcp records closing (the same feature
// paid on one door and free on the other). So:
//
//   - a paid key scores under job-fit's own per-key ceiling (FIT_PAID_DAILY),
//     as before;
//   - a key whose account holds a live paid plan scores the same way (the
//     plan rows are read by the account, never an address: the one rule in
//     _shared/pro-standing.ts);
//   - any other key scores FIT_FREE_DAILY calls a UTC day, but only when its
//     email address was confirmed (the key came through api-key-request's
//     emailed link) or its account has proven its mailbox;
//   - a key that is neither is refused, and told where a confirmed one comes
//     from.
//
// The count is api_usage's own row for (key, today, "/v1/fit"), which
// api_key_check has already incremented for the call being judged, so `used`
// includes it: call 25 is allowed and call 26 is refused. A malformed body
// spends a call, exactly as it spends one of the key's daily quota.
//
// The tier test stays in index.ts (isPaidKeyTier, the shared predicate): this
// module takes its answer as a boolean and never reads a tier string.
//
// THE NUMBERS AND THE COUNT RULE ARE THE CONNECTOR'S. _shared/fit-allowance.ts
// holds the 25, the 1,000 and "the count includes this call", so fit_resume
// and POST /v1/fit cannot give one key two allowances; this file adds only what
// /v1 decides on top: who counts as confirmed, and what a failed read means.
//
// Pure apart from that import-free module, so the Node suite walks it by value.

import { FIT_FREE_PER_DAY, FIT_FULL_PER_DAY, fitAllowed, fitFreeLeft, fitStanding } from "../_shared/fit-allowance.ts";

/** Scored calls a day on a free confirmed key, on /v1/fit: the shared free allowance. */
export const FIT_FREE_DAILY = FIT_FREE_PER_DAY;

/**
 * Scored calls a day on a paid key or a key whose account holds a live paid
 * plan: the shared full allowance, which is job-fit's own per-key ceiling
 * (FIT_KEY_MAX, enforced on the x-rb-bucket this API names); a test holds the
 * two equal.
 */
export const FIT_PAID_DAILY = FIT_FULL_PER_DAY;

/** What api_key_fit_allowance (20261011110000) answers for a key. */
export type FitStanding = {
  /** The account the key is bound to, or null for an account-less key. */
  userId: string | null;
  /** The key was issued through a confirmed api-key-request link. */
  confirmed: boolean;
  /** The bound account has proven its mailbox (account_mailbox_proven). */
  proven: boolean;
  /** Scored calls this UTC day, the one being judged included. */
  used: number;
};

export type FitGate =
  | { open: true; basis: "paid" | "plan"; limit: null; used: null; left: null }
  | { open: true; basis: "free"; limit: number; used: number; left: number }
  | { open: false; reason: "unconfirmed" | "spent" | "unknown"; limit: number; used: number | null };

/** Parse the RPC's row. null when there is no row (no such key); undefined when the read failed. */
export function fitStandingFrom(data: unknown, failed: boolean): FitStanding | null | undefined {
  if (failed) return undefined;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const used = Number(r.fa_used);
  return {
    userId: typeof r.fa_user_id === "string" && r.fa_user_id ? r.fa_user_id : null,
    confirmed: r.fa_confirmed === true,
    proven: r.fa_proven === true,
    used: Number.isFinite(used) && used > 0 ? Math.floor(used) : 0,
  };
}

/**
 * The decision. `standing` is undefined when it could not be read (refused as
 * unknown, never opened), null when the key has no standing row (refused as
 * unconfirmed).
 */
export function fitGate(o: { paid: boolean; plan: boolean; standing: FitStanding | null | undefined }): FitGate {
  if (o.paid) return { open: true, basis: "paid", limit: null, used: null, left: null };
  if (o.plan) return { open: true, basis: "plan", limit: null, used: null, left: null };
  if (o.standing === undefined) return { open: false, reason: "unknown", limit: FIT_FREE_DAILY, used: null };
  if (!o.standing || !(o.standing.confirmed || o.standing.proven)) {
    return { open: false, reason: "unconfirmed", limit: FIT_FREE_DAILY, used: o.standing?.used ?? null };
  }
  const used = o.standing.used;
  if (!fitAllowed(fitStanding(false), used)) return { open: false, reason: "spent", limit: FIT_FREE_DAILY, used };
  return { open: true, basis: "free", limit: FIT_FREE_DAILY, used, left: fitFreeLeft(used) };
}
