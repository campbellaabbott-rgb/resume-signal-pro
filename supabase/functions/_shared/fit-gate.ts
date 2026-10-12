// WHO MAY SCORE A RESUME FOR FREE, ON BOTH DOORS (owner decision 2026-10-11,
// MCP economics decision 2).
//
// The free allowance (FIT_FREE_PER_DAY, _shared/fit-allowance.ts) is for a key
// whose email address was confirmed (it came through api-key-request's emailed
// link) or whose account has proven its mailbox. A key that is neither is
// refused and told where a confirmed one comes from; a paid tier or a paid
// plan scores under job-fit's own per-key ceiling; a read that failed is
// "unknown", refused, never opened.
//
// THIS WAS TWO RULES. POST /v1/fit (w4/api) read api_key_fit_allowance and
// refused an unconfirmed key, while fit_resume in agent-mcp (w4/mcp) gave the
// 25 to every live key: an agent key minted for an unproven password account
// scored on the connector and was refused on /v1. The wave-4 integration moved
// the rule here, out of public-api/fit-allowance.ts (which re-exports it), so
// both doors read the same SQL reader (20261011110000, endpoints '/v1/fit' and
// '/mcp/fit_resume') through the same decision. The reader counts the two
// doors together: 25 a key a day in all, never 25 on each.
//
// Pure apart from the import-free fit-allowance.ts, so the Node suite walks it
// by value and Deno imports it unchanged.

import { FIT_FREE_PER_DAY, fitAllowed, fitFreeLeft, fitStanding } from "./fit-allowance.ts";

/** What api_key_fit_allowance (20261011110000) answers for a key. */
export type FitKeyStanding = {
  /** The account the key is bound to, or null for an account-less key. */
  userId: string | null;
  /** The key was issued through a confirmed api-key-request link. */
  confirmed: boolean;
  /** The bound account has proven its mailbox (account_mailbox_proven). */
  proven: boolean;
  /** Scored calls this UTC day through both doors together, the one being judged included. */
  used: number;
};

export type FitGate =
  | { open: true; basis: "paid" | "plan"; limit: null; used: null; left: null }
  | { open: true; basis: "free"; limit: number; used: number; left: number }
  | { open: false; reason: "unconfirmed" | "spent" | "unknown"; limit: number; used: number | null };

/** Parse the RPC's row. null when there is no row (no such key); undefined when the read failed. */
export function fitStandingFrom(data: unknown, failed: boolean): FitKeyStanding | null | undefined {
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
 * unconfirmed). `paid` is the door's own tier test; `plan` is something on the
 * key's account that opens the full allowance.
 */
export function fitGate(o: { paid: boolean; plan: boolean; standing: FitKeyStanding | null | undefined }): FitGate {
  if (o.paid) return { open: true, basis: "paid", limit: null, used: null, left: null };
  if (o.plan) return { open: true, basis: "plan", limit: null, used: null, left: null };
  if (o.standing === undefined) return { open: false, reason: "unknown", limit: FIT_FREE_PER_DAY, used: null };
  if (!o.standing || !(o.standing.confirmed || o.standing.proven)) {
    return { open: false, reason: "unconfirmed", limit: FIT_FREE_PER_DAY, used: o.standing?.used ?? null };
  }
  const used = o.standing.used;
  if (!fitAllowed(fitStanding(false), used)) return { open: false, reason: "spent", limit: FIT_FREE_PER_DAY, used };
  return { open: true, basis: "free", limit: FIT_FREE_PER_DAY, used, left: fitFreeLeft(used) };
}
