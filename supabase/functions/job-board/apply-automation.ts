// How much of an application the agent can complete without the candidate, per
// vendor — and WHY, with the measurement that established it.
//
// MEASURED 2026-07-29 on 298 real apply URLs sampled in proportion to the live
// board (296 reachable). Static fetch of the apply page, looking for reCAPTCHA /
// hCaptcha / Turnstile / Arkose script tags and Cloudflare interstitials:
//
//   ashby            10/10  100%   reCAPTCHA          lever   6/6  100%  reCAPTCHA
//   icims             1/8     12%   reCAPTCHA
//   greenhouse        0/30     0%   smartrecruiters   0/23    0%
//   bamboohr          0/22     0%   workable          0/11    0%
//   oracle 0/7 · breezy 0/7 · teamtailor 0/5 · rippling 0/4 · recruitee 0/4
//   personio 0/2 · pinpoint 0/2
//   Cloudflare challenge walls: 0 of 296, everywhere.
//
// KNOWN LIMIT OF THAT MEASUREMENT, recorded so nobody later reads it as more
// than it is: Workday renders zero visible words to a static fetch — it is a JS
// shell — so its 0% is a NON-MEASUREMENT, not a finding. Workday is classified
// `signup` here on its documented behaviour (a candidate account per employer
// tenant), which is a different and larger obstacle than a CAPTCHA, and one no
// solver service addresses. Re-measure Workday with a real browser before
// promoting it.
//
// WHY THIS IS NOT A LIST OF WHERE WE CAN "AUTO-SUBMIT FROM THE SERVER"
// No vendor exposes a public submit endpoint — measured the same day:
//   POST boards-api.greenhouse.io/v1/boards/{t}/jobs/{id}  -> 401 HTTP Basic
//   POST api.lever.co/v0/postings/{t}                      -> 404 Cannot POST
//   POST api.ashbyhq.com/posting-api/job-board/{t}         -> 401 Unauthorized
// Submission always means driving the real form in the candidate's own session.
// The absence of a CAPTCHA does not change that; it changes how often a human
// has to touch the form once the extension is already driving it.

export type AutomationTier =
  | "auto" // extension completes and submits with no human step
  | "signup" // needs a candidate account with that employer, once
  | "click" // a CAPTCHA appears; the human clears it and the run continues
  | "unknown"; // vendor not measured — never claim more than this

export type AutomationFact = {
  tier: AutomationTier;
  /** Real application questions published by the vendor's public API? */
  realQuestions: boolean;
  /** Sample size behind the tier, so a caller can weigh it. 0 = not measured. */
  sampled: number;
  note: string;
};

const FACTS: Record<string, AutomationFact> = {
  // The best target on the board: no CAPTCHA AND the only vendor that publishes
  // a posting's actual questions, so the agent fills a form it can see rather
  // than one it is guessing at.
  greenhouse: { tier: "auto", realQuestions: true, sampled: 30, note: "0/30 captcha; real questions via boards-api" },
  smartrecruiters: { tier: "auto", realQuestions: false, sampled: 23, note: "0/23 captcha" },
  bamboohr: { tier: "auto", realQuestions: false, sampled: 22, note: "0/22 captcha" },
  workable: { tier: "auto", realQuestions: false, sampled: 11, note: "0/11 captcha" },
  oracle: { tier: "auto", realQuestions: false, sampled: 7, note: "0/7 captcha" },
  breezy: { tier: "auto", realQuestions: false, sampled: 7, note: "0/7 captcha" },
  teamtailor: { tier: "auto", realQuestions: false, sampled: 5, note: "0/5 captcha" },
  rippling: { tier: "auto", realQuestions: false, sampled: 4, note: "0/4 captcha" },
  recruitee: { tier: "auto", realQuestions: false, sampled: 4, note: "0/4 captcha" },
  // Two-posting samples. The tier is a best guess, and `sampled` says so — a
  // caller that wants confidence should treat these like `unknown`.
  personio: { tier: "auto", realQuestions: false, sampled: 2, note: "0/2 captcha — thin sample" },
  pinpoint: { tier: "auto", realQuestions: false, sampled: 2, note: "0/2 captcha — thin sample" },

  workday: {
    tier: "signup",
    realQuestions: false,
    sampled: 0,
    note: "JS shell — captcha NOT measured; classified on the documented per-tenant candidate account",
  },

  ashby: { tier: "click", realQuestions: true, sampled: 10, note: "10/10 reCAPTCHA" },
  lever: { tier: "click", realQuestions: false, sampled: 6, note: "6/6 reCAPTCHA" },
  icims: { tier: "click", realQuestions: false, sampled: 8, note: "1/8 reCAPTCHA" },
};

const UNKNOWN: AutomationFact = {
  tier: "unknown",
  realQuestions: false,
  sampled: 0,
  note: "vendor not measured",
};

// Object-index lookups on a plain record reach Object.prototype — "constructor"
// and "toString" return functions, and `??` does not catch a function. That has
// bitten this codebase three separate times (NAME_FIXES, CATEGORY_ACCENT,
// VENDOR_MODE), so this one is a Map.
const TABLE = new Map<string, AutomationFact>(Object.entries(FACTS));

export function automationFor(source: string): AutomationFact {
  return TABLE.get(String(source ?? "").trim().toLowerCase()) ?? UNKNOWN;
}

/** Can the agent finish this one end-to-end with no human step? */
export function isFullyAutomatable(source: string): boolean {
  return automationFor(source).tier === "auto";
}

// What the candidate is told BEFORE the run, so nobody discovers a signup wall
// halfway through a batch. Deliberately plain: an unmeasured vendor says it is
// unmeasured rather than borrowing the optimism of its neighbours.
export function automationLabel(source: string): string {
  const f = automationFor(source);
  switch (f.tier) {
    case "auto":
      return "Applies automatically";
    case "signup":
      return "Needs a one-time account with this employer";
    case "click":
      return "You clear one CAPTCHA; the rest is automatic";
    default:
      return "We haven't measured this employer's form yet";
  }
}
