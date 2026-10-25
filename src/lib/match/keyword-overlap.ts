// KEYWORD OVERLAP, ON THE DEVICE.
//
// resume-match returns each posting's recognised terms (the dictionary walk
// behind job-fit's score) and never sees the résumé on the site's paste path.
// The device answers "how many of those terms does my résumé carry" itself,
// with the scorer's own whole-word rule, and the card says exactly that:
// "Keyword overlap: N of M recognised terms in this posting appear in your
// résumé." It is the last tie-break within a tier and never a tier itself.
// A test holds matched/missing equal to computeFit's for the same posting.

// Relative, not "@/": the same module may be bundled by scripts that know no alias.
import { fill, KEYWORD_OVERLAP } from "../../../supabase/functions/_shared/match-tiers";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TERM_RE = new Map<string, RegExp>();
function containsTerm(haystack: string, term: string): boolean {
  let re = TERM_RE.get(term);
  if (!re) {
    re = new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}([^a-z0-9]|$)`, "i");
    TERM_RE.set(term, re);
  }
  return re.test(haystack);
}

export interface Overlap {
  matched: string[];
  missing: string[];
  /** matched.length */
  n: number;
  /** recognised terms in the posting */
  m: number;
  line: string;
}

/** null when the posting's terms are still pending (the server walks at most six per call). */
export function keywordOverlap(postingTerms: readonly string[] | "pending", resumeText: string): Overlap | null {
  if (postingTerms === "pending") return null;
  const lower = resumeText.toLowerCase();
  const matched = postingTerms.filter((t) => containsTerm(lower, t));
  const missing = postingTerms.filter((t) => !containsTerm(lower, t));
  return { matched, missing, n: matched.length, m: postingTerms.length, line: fill(KEYWORD_OVERLAP, { n: matched.length, m: postingTerms.length }) };
}
