import type { VendorAdapter } from "./types.js";
import { breezy } from "./breezy.js";
import { oracle } from "./oracle.js";
import { personio } from "./personio.js";
import { pinpoint } from "./pinpoint.js";
import { teamtailor } from "./teamtailor.js";

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
  oracle,
  personio,
  pinpoint,
  teamtailor,
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
  // MEASURED 2026-07-31, and it is a decision rather than a defect.
  //
  // The apply URL answers a headless browser with 403 and a headed one with 200.
  // Same URL, same machine, seconds apart. The block keys on the headless signal
  // itself, so SmartRecruiters is saying no to exactly what this worker is.
  //
  // It COULD be worked around — spoof the user agent, or run headed behind a
  // virtual display on the server. Both are ways of not being what we are, which
  // is the same line as solving a CAPTCHA. The adapter stays written and stays
  // unused until someone decides otherwise, on purpose rather than by leaving a
  // flag flipped.
  //
  // Note this is invisible without testing: no CAPTCHA, no challenge page, just a
  // 403 that reads like a broken link.
  smartrecruiters: "the apply app 403s in BOTH modes. Re-measured 2026-08-01 across 4 tenants: clicking through lands on /oneclick-ui/, which then 403s on its own API (/oneclick-ui/api/company/...) and sometimes on its JS bundle. Headless renders nothing at all; HEADED renders the job title and still reaches 0 form inputs after 20s. The old note said headed got 200 — true of the PAGE, false of the form. Reaching the form would mean defeating the protection, not running a browser differently. Adapter stays written and unused.",

  // ORACLE MOVED TO ADAPTERS 2026-08-19. The note that used to sit here said
  // "creates a candidate PROFILE per employer tenant... No guest path offered...
  // Same class of obstacle as workday" — and that was wrong, which is worth
  // recording because it cost three weeks of treating a servable vendor as
  // blocked. A live read of the apply screen has Oracle saying the opposite in
  // its own words: "You don't need to have an account. Get started right away
  // by simply using your email." Zero password inputs, no sign-in requirement,
  // no CAPTCHA. The profile is a CONSEQUENCE of applying, not a gate before it.
  //
  // The real gate was the required terms checkbox — an act performed in
  // someone's name — which now runs through the same consentToProcessing
  // opt-in as every other consent item. See vendors/oracle.ts.

  // The apply control text is written by the EMPLOYER ("Apply Here .xx" on the
  // tenant examined), so the form URL must be derived some other way. Not yet
  // determined.
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
