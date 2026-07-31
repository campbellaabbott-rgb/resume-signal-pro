// The ATS platforms we integrate with, and what the agent can do on each.
//
// ONE LIST, READ BY EVERY SURFACE. The front page, the pricing page and any
// future comparison table all import this. Two hand-maintained lists drift, and
// the drift always lands somewhere public — a platform we quietly dropped still
// listed on the home page, or a vendor moved out of auto-apply while pricing
// still promises it.
//
// `tier` MIRRORS supabase/functions/_shared/apply-automation.ts, which is what
// the agent actually obeys. src/test/ats-vendors.test.ts reads that Deno file
// and fails if the two disagree, so marketing can never claim auto-apply on a
// vendor the code refuses to auto-apply to.
//
// The tiers came from a measurement of 674 real apply pages on 2026-07-30:
// `auto` vendors showed no CAPTCHA in the sample, `click` vendors did — up to
// 60/60 on some. Greenhouse is `click` despite showing no visible challenge,
// because 94% load reCAPTCHA Enterprise, which scores silently and rejects
// without saying so. Being unable to tell whether an application was rejected is
// worse than being told no.

export type AtsTier = "auto" | "click";

export interface AtsVendor {
  /** Matches the `source` value on postings and the key in apply-automation.ts. */
  key: string;
  /** How the vendor writes its own name. */
  label: string;
  tier: AtsTier;
}

export const ATS_VENDORS: readonly AtsVendor[] = [
  // Applications the agent can complete and submit on its own.
  { key: "workday", label: "Workday", tier: "auto" },
  { key: "smartrecruiters", label: "SmartRecruiters", tier: "auto" },
  { key: "breezy", label: "Breezy", tier: "auto" },
  { key: "oracle", label: "Oracle", tier: "auto" },
  { key: "teamtailor", label: "Teamtailor", tier: "auto" },
  { key: "personio", label: "Personio", tier: "auto" },
  { key: "pinpoint", label: "Pinpoint", tier: "auto" },

  // Prepared in full; the person presses send. These carry a CAPTCHA or an
  // equivalent human check, and we do not solve or evade those.
  { key: "greenhouse", label: "Greenhouse", tier: "click" },
  { key: "lever", label: "Lever", tier: "click" },
  { key: "ashby", label: "Ashby", tier: "click" },
  { key: "bamboohr", label: "BambooHR", tier: "click" },
  { key: "workable", label: "Workable", tier: "click" },
  { key: "rippling", label: "Rippling", tier: "click" },
  { key: "recruitee", label: "Recruitee", tier: "click" },
  { key: "icims", label: "iCIMS", tier: "click" },
] as const;

export const AUTO_VENDORS = ATS_VENDORS.filter((v) => v.tier === "auto");
export const CLICK_VENDORS = ATS_VENDORS.filter((v) => v.tier === "click");

/**
 * Deliberately no "percentage of the board" export.
 *
 * The obvious thing to put here is "auto-apply covers N% of jobs". I tried to
 * measure it and could not: sampling the board at different offsets returned
 * 79%, 100% and 0.6% for the same question, because postings cluster by vendor
 * and the board exposes no per-source facet. The "68%" written in
 * apply-automation.ts is a different quantity — the share of sampled APPLY
 * PAGES that were CAPTCHA-free, not the share of the board those vendors hold.
 *
 * So the surfaces name platforms instead of claiming a share. A reader can
 * check a platform name against their own job search. They cannot check a
 * percentage, which is exactly why it would need to be right.
 */
