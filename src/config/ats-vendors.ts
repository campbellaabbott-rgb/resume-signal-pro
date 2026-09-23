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

/**
 * What every list in this file holds: a source the board carries an entry for.
 *
 * `serving` is the DORMANCY MARKER, and it exists because an entry here is two
 * separate claims — "we can read this system" and "we are serving its rows
 * today" — and they came apart. USAJOBS sat in the vendor menu and in every
 * public "where these jobs come from" sentence while the board served ZERO
 * rows from it, because its secrets are not set. A reader filtered the board
 * to it and got an empty page; a reader of the sources line was told about an
 * inventory that is not there.
 *
 * Absent means serving, `serving: false` means the entry is carried but
 * dormant. Deleting the entry instead would lose the tier, the label and the
 * standing the moment its secrets land; marking it keeps all of that and takes
 * it off the public surfaces until it has rows. The surfaces filter on the
 * marker (SERVING_SOURCES below) — they must never re-spell the list.
 */
export interface BoardSource {
  /** Matches the `source` value on postings and the key in apply-automation.ts. */
  key: string;
  /** How the vendor writes its own name. */
  label: string;
  /**
   * Set to `false` — explicitly — for a source the board carries but serves no
   * rows from. Absent is the normal case and means the source has rows.
   */
  serving?: false;
}

export interface AtsVendor extends BoardSource {
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
 * there at all — not "auto", not "click", not ever.
 *
 * IT IS DORMANT, and that is why it carries the marker. Measured 2026-09-23
 * against the board's own per-source facet and its date-coverage rollup: both
 * return nineteen sources with rows and usajobs is in neither. The entry stays
 * — it comes back the day its secrets are set, and deleting it would lose this
 * note with it — but a "where these jobs come from" sentence that names a
 * system serving nothing is false in the other direction, and a menu entry
 * that filters to an empty page is worse than no entry. So the public
 * surfaces read SERVING_SOURCES, which drops it, and the moment rows appear
 * the marker comes off and every surface names it again with no copy edit.
 */
export const NON_ATS_SOURCES = [
  { key: "usajobs", label: "USAJOBS", serving: false },
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
  { key: "ukg", label: "UKG Pro Recruiting" },
  // ADP Workforce Now joined 2026-08-31, same standing as Paylocity: the
  // board serves its postings, and its apply flow is unmeasured — no sampled
  // CAPTCHA measurement, no tier, so the automation table answers "unknown"
  // honestly until someone samples the apply pages and writes the FACTS row.
  { key: "adp", label: "ADP Workforce Now" },
  // JazzHR joined 2026-09-04 (vendor #20) with the same standing: the board
  // serves its postings, and its apply form has not been sampled for a
  // CAPTCHA — no tier, so the automation table answers "unknown" honestly.
  { key: "jazzhr", label: "JazzHR" },
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
 * EVERY SOURCE THE BOARD CARRIES AN ENTRY FOR, in one array — the thing the
 * three lists above are, read as one.
 *
 * The three lists are split by what the AGENT may do on a source (measured
 * tier / unmeasured / not an ATS at all). Nothing public asks that question,
 * so every public surface had to re-spell the union by hand, and six of them
 * did: a six-name list and a twelve-name list in the prerender, a fifteen-name
 * list and an "and 8 more" on the Ghost Job Index, a nineteen-name list on the
 * Entry-Level Index, and the board's own note. Five of the six were wrong on
 * the day this was written.
 */
export const ALL_BOARD_SOURCES: readonly BoardSource[] = [
  ...ATS_VENDORS,
  ...UNMEASURED_ATS_SOURCES,
  ...NON_ATS_SOURCES,
];

/**
 * The sources that actually have rows — what a reader is told about.
 *
 * THE ONE LIST PUBLIC COPY MAY NAME. BOARD_SOURCE_LIST answers "what do we
 * hold an entry for", which is an internal question; this answers "where do
 * the postings on this page come from", which is the one every public sentence
 * is really asking. They differ by the dormancy marker, and the day they stop
 * differing this still reads correctly.
 */
export const SERVING_SOURCES: readonly BoardSource[] = ALL_BOARD_SOURCES.filter((v) => v.serving !== false);

/** Carried, but serving nothing today. Named where the ABSENCE is the point. */
export const DORMANT_SOURCES: readonly BoardSource[] = ALL_BOARD_SOURCES.filter((v) => v.serving === false);

/**
 * The `source` values a public surface may offer as a filter.
 *
 * WHO READS IT, named here because a documented list with no reader is the
 * shape that drifts next: the board's vendor menu is built from SERVING_SOURCES
 * (it needs the labels too), and the guards bind the two together -- the menu
 * builder's option set is asserted to equal this list, key for key, and this
 * list is asserted to equal the set of sources the board was MEASURED to have
 * rows for. So this is the keys-only view the checks are written against, not
 * a second source of truth for the menu.
 */
export const SERVING_SOURCE_KEYS: readonly string[] = SERVING_SOURCES.map((v) => v.key);

/**
 * Every serving source as one prose string, for interpolation into copy.
 *
 * Comma-joined with no "and", for the same reason ATS_VENDOR_LIST is: the
 * surrounding sentence supplies the grammar, this supplies the names.
 */
export const SERVING_SOURCE_LIST = SERVING_SOURCES.map((v) => v.label).join(", ");

/**
 * The same fact in a short sentence — "A, B, C and 16 more" — for places where
 * nineteen names would swamp the line.
 *
 * Derived, so the tail count cannot go stale the way "and 8 more" did: it was
 * written when the board served eleven sources, and by the time anyone read it
 * again the board served nineteen. A number that describes a list must be
 * computed from that list.
 */
export const servingSourceSummary = (lead = 3): string => {
  const names = SERVING_SOURCES.map((v) => v.label);
  if (names.length <= lead) return names.join(", ");
  return `${names.slice(0, lead).join(", ")} and ${names.length - lead} more`;
};

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
