// The tier predicates, shared — ... docs/shared-notes.md#s84

import { PASS_TIER } from "./pass.ts";

const UNPAID_TIERS: ReadonlySet<string> = new Set(["free", "trial"]);

// Paid for /v1 purposes and ... docs/shared-notes.md#s85
export function isPaidKeyTier(tier: string | null | undefined): boolean {
  return tier != null && !UNPAID_TIERS.has(tier) && tier !== PASS_TIER;
}

/** fit_resume: the paid tiers AND a live pass. */
export function hasFitAccess(tier: string | null | undefined): boolean {
  return isPaidKeyTier(tier) || tier === PASS_TIER;
}
