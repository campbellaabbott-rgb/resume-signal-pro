import type { VendorAdapter } from "./types.js";
import { breezy } from "./breezy.js";
import { smartrecruiters } from "./smartrecruiters.js";
import { personio } from "./personio.js";

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
  personio,
};

/**
 * Zero-CAPTCHA by measurement, but NOT yet examined. The worker refuses these.
 *
 * Listing them here rather than omitting them keeps the gap visible: these are
 * vendors we could serve and currently do not, which is a work item, not an
 * absence. Silently missing vendors get forgotten; a named refusal does not.
 */
/**
 * Reconnoitred, but not yet servable — with what the recon found, so the next
 * person starts from evidence rather than from scratch.
 *
 * All three are CAPTCHA-free. None is blocked by anything we refuse to do; each
 * needs one more pass to map its fields.
 */
export const NEEDS_RECON: Record<string, string> = {
  // Form URL rule known: the apply link's href is `{postingUrl}/application`.
  // Fields not yet mapped — the posting page itself carries none.
  pinpoint: "form URL is {posting}/application; fields not yet mapped",

  // Reaching the form needs an email + a REQUIRED terms-and-conditions
  // checkbox, and it carries a `honey-pot` field (see HONEYPOTS below). No
  // account is needed — "simply using your email" — so it is servable, but
  // agreeing to an employer's terms on someone's behalf is a product decision
  // rather than a coding one.
  oracle: "email-first auth screen; REQUIRED terms checkbox; has a honeypot",

  // The apply control text is written by the EMPLOYER ("Apply Here .xx" on the
  // tenant examined), so the form URL must be derived some other way. Not yet
  // determined.
  teamtailor: "apply control text is employer-authored; form URL rule unknown",
};

/**
 * Fields that exist to catch bots, and must NEVER be filled.
 *
 * Oracle ships `name="honey-pot"` / `aria-label="honeypot"` on its application
 * screen: invisible to a person, so anything that fills it is not one. This is
 * why the driver fills ONLY fields an adapter has explicitly mapped, and never
 * "every input it can find" — a fill-everything strategy would announce itself
 * on the first Oracle application.
 *
 * Listed so the rule is enforceable and testable rather than merely implied by
 * the design.
 */
export const HONEYPOT_PATTERNS = [/honey.?pot/i, /\bbot.?trap\b/i, /^hp_/i] as const;

export function isHoneypot(nameOrId: string): boolean {
  return HONEYPOT_PATTERNS.some((re) => re.test(nameOrId ?? ""));
}

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
