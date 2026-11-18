// WHY A ROW HAS NO SCORE (S14X-052).
//
// fit-batch answers null for two different postings: one we hold no stored
// description for, and one whose description we hold but in which the scorer
// recognised no skill or tool (a posting in another language, or one made of
// boilerplate). The board printed "we hold no description" for both, which
// was false for the second. The reason now rides beside the null, so the
// board can say which one it is. Pure, so a test can call it without Deno.
//
// A third: a résumé in which the scorer recognised no term (a CV in German,
// say). Every posting scored 0% against it, and the board called a nurse's
// own job a Stretch; that is no measurement, so each is a null with
// no_resume_terms.

/** A description this short or shorter is not read: the same bound the scorer has always used. */
export const FIT_MIN_DESCRIPTION_CHARS = 150;

export type UnscoredReason = "no_description" | "no_recognised_terms" | "no_resume_terms";

/**
 * The reason a row has no score, or null when it has one. `pct` is what
 * computeFit answered for the description (null when it recognised no term);
 * `resumeTerms` is how many terms the résumé scan recognised (0: nothing to
 * compare, whatever the posting holds).
 */
export function unscoredReason(description: string | null | undefined, pct: number | null | undefined, resumeTerms = 1): UnscoredReason | null {
  if (typeof description !== "string" || description.length <= FIT_MIN_DESCRIPTION_CHARS) return "no_description";
  if (resumeTerms === 0) return "no_resume_terms";
  return typeof pct === "number" ? null : "no_recognised_terms";
}
