import type { VendorAdapter } from "./types.js";
import { breezy } from "./breezy.js";
import { smartrecruiters } from "./smartrecruiters.js";

/**
 * The vendors the worker will act on, and only those.
 *
 * A vendor appears here ONLY when someone has loaded a real posting from it and
 * written down what the form actually looks like (worker/RECON.md). That is the
 * whole rule, and it exists because the first driver was written from
 * imagination and would have failed on every vendor examined — none of them for
 * CAPTCHA reasons.
 *
 * Being in the measured zero-CAPTCHA set is necessary and NOT sufficient. All
 * three vendors examined were CAPTCHA-free and all three would have defeated the
 * generic driver, for three different reasons.
 */
export const ADAPTERS: Record<string, VendorAdapter> = {
  breezy,
  smartrecruiters,
};

/**
 * Zero-CAPTCHA by measurement, but NOT yet examined. The worker refuses these.
 *
 * Listing them here rather than omitting them keeps the gap visible: these are
 * vendors we could serve and currently do not, which is a work item, not an
 * absence. Silently missing vendors get forgotten; a named refusal does not.
 */
export const NEEDS_RECON = ["oracle", "personio", "pinpoint", "teamtailor"] as const;

/**
 * Excluded for a reason that is not about forms at all.
 *
 * Workday needs a per-tenant candidate ACCOUNT — the applicant registers with
 * each employer's Workday instance before applying. That is credential creation
 * and storage per employer, a different problem class from filling a form, and
 * it is unsolved. It is also the largest vendor in the auto tier, so this is the
 * single biggest limit on what the agent can cover.
 */
export const BLOCKED: Record<string, string> = {
  workday: "needs a per-tenant candidate account; credential flow not built",
};

export function adapterFor(source: string): VendorAdapter | null {
  return ADAPTERS[String(source ?? "").toLowerCase()] ?? null;
}
