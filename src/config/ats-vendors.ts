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

/**
 * Sources the board serves that are NOT ATS platforms, and that the agent can
 * NEVER apply on.
 *
 * Kept out of ATS_VENDORS deliberately. Every entry there carries a `tier`
 * mirrored from apply-automation.ts, and src/test/ats-vendors.test.ts fails if
 * the two disagree — so putting a non-ATS source in that list would force a
 * lie in one direction or the other: either a fake tier the agent does not
 * obey, or a broken mirror.
 *
 * USAJOBS is the U.S. federal government's own hiring system. Applications run
 * through USAJOBS accounts and agency assessments, so the agent does not apply
 * there at all — not "auto", not "click", not ever. It still belongs in the
 * board's SOURCE list, because a "where these jobs come from" note that omits
 * a source is false by omission however true each named item is.
 */
export const NON_ATS_SOURCES = [
  { key: "usajobs", label: "USAJOBS" },
] as const;

/**
 * ATS platforms the board serves whose application forms we have NOT measured.
 *
 * Not ATS_VENDORS: every entry there carries a tier backed by a sampled
 * measurement in apply-automation.ts, and the mirror test holds the two to it.
 * Not NON_ATS_SOURCES either: that list is for systems that are not ATS
 * platforms at all, and Paylocity is one. An unmeasured ATS goes here, the
 * automation table answers "unknown" for it honestly, and the source copy
 * still names it — because "where these jobs come from" that omits a source
 * is false by omission however true each named item is. Graduation path:
 * sample the apply pages, write the FACTS row, move the entry up.
 */
export const UNMEASURED_ATS_SOURCES = [
  { key: "paylocity", label: "Paylocity" },
] as const;

export const AUTO_VENDORS = ATS_VENDORS.filter((v) => v.tier === "auto");
export const CLICK_VENDORS = ATS_VENDORS.filter((v) => v.tier === "click");

/**
 * Every platform as one prose string, for interpolation into copy.
 *
 * The board's own "Sources:" note used to spell the list out in its English
 * default AND in all nine locales — ten copies of a fact this file exists to
 * hold once. The default had already drifted to ten platforms and was missing
 * Workday, the largest source on the board; it went unnoticed because the
 * en.json key overrides the default, so the stale text only becomes visible the
 * day a translation goes missing. Interpolating removes the possibility.
 *
 * COMMA-JOINED, with no "and" before the last. The nine locales each have their
 * own conjunction (und / y / et / en / e / at / और) and this string is dropped
 * into all of them; an English "and" welded on here would be wrong in eight
 * languages. The surrounding sentence supplies the grammar, this supplies the
 * names.
 */
export const ATS_VENDOR_LIST = ATS_VENDORS.map((v) => v.label).join(", ");

/**
 * EVERY source the board serves, ATS or not — the string for "where these jobs
 * come from" copy.
 *
 * Distinct from ATS_VENDOR_LIST, which answers a different question ("which
 * platforms does the agent work with") and must never grow a source the agent
 * cannot drive. Source copy uses THIS; agent copy uses that. Conflating them is
 * how a board ends up either hiding a source or promising applications it
 * cannot send.
 */
export const BOARD_SOURCE_LIST = [...ATS_VENDORS, ...UNMEASURED_ATS_SOURCES, ...NON_ATS_SOURCES]
  .map((v) => v.label)
  .join(", ");

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
