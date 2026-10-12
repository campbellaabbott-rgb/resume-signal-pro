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
// holds the 25, the 1,000 and "the count includes this call", and
// _shared/fit-gate.ts holds who counts as confirmed and what a failed read
// means (moved there by the wave-4 integration, so fit_resume and POST
// /v1/fit cannot give one key two allowances). This file names /v1's figures
// and re-exports the decision under the names index.ts and its tests import.
//
// Import-free apart from those two pure modules, so the Node suite walks it by
// value.

import { FIT_FREE_PER_DAY, FIT_FULL_PER_DAY } from "../_shared/fit-allowance.ts";
export { fitGate, fitStandingFrom } from "../_shared/fit-gate.ts";
export type { FitGate, FitKeyStanding as FitStanding } from "../_shared/fit-gate.ts";

/** Scored calls a day on a free confirmed key, on /v1/fit: the shared free allowance. */
export const FIT_FREE_DAILY = FIT_FREE_PER_DAY;

/**
 * Scored calls a day on a paid key or a key whose account holds a live paid
 * plan: the shared full allowance, which is job-fit's own per-key ceiling
 * (FIT_KEY_MAX, enforced on the x-rb-bucket this API names); a test holds the
 * two equal.
 */
export const FIT_PAID_DAILY = FIT_FULL_PER_DAY;
