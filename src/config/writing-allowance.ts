/**
 * THE WRITING TOOLS' ALLOWANCE, AS THE PAGES STATE IT.
 *
 * MIRROR of WRITING_ALLOWANCE in supabase/functions/_shared/writing-allowance.ts
 * (the server decides; this file only lets a page say the same numbers). A
 * test holds the two equal, so copy that says "one a day" cannot drift from
 * a server that counts something else.
 *
 * Owner decision 2026-10-12: signed out, none; a free account, one tailored
 * résumé, one cover letter and one interview-prep set a UTC day; Pro, five
 * packages a UTC day and sixty a UTC month.
 */
export const WRITING_ALLOWANCE = Object.freeze({
  freePerToolPerDay: 1,
  proPackagesPerDay: 5,
  proPackagesPerMonth: 60,
});

/** The refusal codes the writing tools answer, for pages that word them. */
export type WritingRefusalCode = "sign_in_required" | "daily_limit" | "monthly_limit";
