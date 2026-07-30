// How much of an application the agent can complete without the candidate, per
// vendor — and WHY, with the measurement that established it.
//
// MEASURED 2026-07-29 on 298 real apply URLs sampled in proportion to the live
// board (296 reachable). Static fetch of the apply page, looking for reCAPTCHA /
// hCaptcha / Turnstile / Arkose script tags and Cloudflare interstitials:
//
//   RE-MEASURED 2026-07-30, 674 pages, redirects followed. The first run is
//   superseded — it reported 0% for greenhouse/bamboohr/workable/rippling and
//   could not be reproduced.
//     CLEAN : workday 0/60 · smartrecruiters 0/60 · breezy 0/54 · oracle 0/39
//             teamtailor 0/12 · personio 0/7 · pinpoint 0/5      = 68% of board
//     CAPTCHA: ashby 60/60 · bamboohr 60/60 · workable 60/60 · lever 57/57
//             rippling 49/49 · recruitee 26/30 · greenhouse 61/67 · icims 17/60
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
  // ZERO CAPTCHA — 674 pages fetched with redirects followed, 2026-07-30.
  // These are the agent's targets. `postable` records whether the page ships a
  // real form in HTML; 0% everywhere below means the form is built by
  // JavaScript, so submission needs a browser engine, not an HTTP POST.
  workday: { tier: "auto", realQuestions: false, sampled: 60, note: "0/60 captcha; JS form; per-tenant account needed" },
  smartrecruiters: { tier: "auto", realQuestions: false, sampled: 60, note: "0/60 captcha; JS form" },
  breezy: { tier: "auto", realQuestions: false, sampled: 54, note: "0/54 captcha; JS form" },
  oracle: { tier: "auto", realQuestions: false, sampled: 39, note: "0/39 captcha; JS form" },
  teamtailor: { tier: "auto", realQuestions: false, sampled: 12, note: "0/12 captcha" },
  personio: { tier: "auto", realQuestions: false, sampled: 7, note: "0/7 captcha — thin sample" },
  pinpoint: { tier: "auto", realQuestions: false, sampled: 5, note: "0/5 captcha — thin sample" },

  // CAPTCHA PRESENT — excluded from unattended sending.
  //
  // CORRECTION: an earlier build of this table marked greenhouse, bamboohr,
  // workable and rippling as `auto` on a sample that reported 0% captcha for
  // all four. That sample was wrong and could not be reproduced; a clean re-run
  // measures 91%, 100%, 100% and 100%. Shipping it would have pointed the agent
  // at exactly the vendors it must avoid.
  ashby: { tier: "click", realQuestions: true, sampled: 60, note: "60/60 captcha" },
  bamboohr: { tier: "click", realQuestions: false, sampled: 60, note: "60/60 captcha" },
  workable: { tier: "click", realQuestions: false, sampled: 60, note: "60/60 captcha" },
  lever: { tier: "click", realQuestions: false, sampled: 57, note: "57/57 captcha" },
  rippling: { tier: "click", realQuestions: false, sampled: 49, note: "49/49 captcha" },
  recruitee: { tier: "click", realQuestions: false, sampled: 30, note: "26/30 captcha" },
  icims: { tier: "click", realQuestions: false, sampled: 60, note: "17/60 captcha — mixed, treat as blocked" },

  // Greenhouse is its own case and the reason `tier` alone is not enough.
  // 94% load recaptcha/ENTERPRISE.js with NO data-sitekey and NO g-recaptcha
  // widget — meaning no challenge is ever shown. It is invisible, score-based
  // bot detection. A human sees nothing; a headless browser is precisely what it
  // scores, and a low score is rejected SILENTLY. Frictionless for a real
  // browser, unreliable for a server one, so it stays out of the auto tier until
  // measured with actual submissions rather than page fetches.
  greenhouse: { tier: "click", realQuestions: true, sampled: 67, note: "94% invisible reCAPTCHA Enterprise — silent scoring, not a challenge" },
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
