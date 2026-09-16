// The tier predicates, shared — so agent-mcp and public-api cannot answer
// "is this key paid" differently. Before this file each spelled the same
// inline string predicate (one copy in agent-mcp, three in public-api), and a
// new tier would have had to be added to all four by hand or silently become
// paid in the ones that were missed.
//
// The pass is the reason the two questions are separate. It is sold as "your
// agent", never "your script" (project_public_data_api: /v1 is a promise to
// someone else's code), so a live pass answers key_tier = PASS_TIER and must
// read as UNPAID to every /v1 gate — the ranked engine, /v1/fit, the long
// changes window — while fit_resume opens to it, because the pipeline refuses
// unattended release on unknown or low fit and "research the board and apply"
// is honest only if research can score before the spend.
//
// Import-free apart from pass.ts, so the Node test suite can walk the values.

import { PASS_TIER } from "./pass.ts";

const UNPAID_TIERS: ReadonlySet<string> = new Set(["free", "trial"]);

/**
 * Paid for /v1 purposes and for the "paid" MCP tools other than fit_resume.
 * Null, free, trial and the pass all answer false; any other non-null tier is
 * paid — the same shape the inline predicate had, plus the pass exclusion.
 */
export function isPaidKeyTier(tier: string | null | undefined): boolean {
  return tier != null && !UNPAID_TIERS.has(tier) && tier !== PASS_TIER;
}

/** fit_resume: the paid tiers AND a live pass. */
export function hasFitAccess(tier: string | null | undefined): boolean {
  return isPaidKeyTier(tier) || tier === PASS_TIER;
}
