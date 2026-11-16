// WHY A ROW HAS NO SCORE (S14X-052).
//
// fit-batch answers null for two different postings: one we hold no stored
// description for, and one whose description we hold but in which the scorer
// recognised no skill or tool (a posting in another language, or one made of
// boilerplate). The board printed "we hold no description" for both, which
// was false for the second. The reason now rides beside the null, so the
// board can say which one it is. Pure, so a test can call it without Deno.

/** A description this short or shorter is not read: the same bound the scorer has always used. */
export const FIT_MIN_DESCRIPTION_CHARS = 150;

export type UnscoredReason = "no_description" | "no_recognised_terms";

/**
 * The reason a row has no score, or null when it has one. `pct` is what
 * computeFit answered for the description (null when it recognised no term).
 */
export function unscoredReason(description: string | null | undefined, pct: number | null | undefined): UnscoredReason | null {
  if (typeof description !== "string" || description.length <= FIT_MIN_DESCRIPTION_CHARS) return "no_description";
  return typeof pct === "number" ? null : "no_recognised_terms";
}
