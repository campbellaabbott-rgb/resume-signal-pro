/**
 * CLAIM GROUNDING: does a "verbatim" quote in the report appear in the résumé?
 *
 * Several report fields promise quotes from the candidate's own résumé. Each
 * one is checked here, and anything the model invented is dropped. Text is
 * compared after normalising both sides the same way.
 *
 * The normaliser keeps the letters, combining marks and digits of EVERY
 * script (register L5-08). It used to keep only [a-z0-9%$ ], so a Hindi
 * résumé normalised to its digits and every quote from it to '', which never
 * "appears", and every rewrite card was dropped as invented.
 *
 * Plain TypeScript, no imports: the Node test suite runs it directly.
 */
export const normalizeForGrounding = (s: string): string =>
  s.normalize("NFKC")
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^\p{L}\p{M}\p{N}%$ ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** A predicate: true when a claimed quote appears in `resumeText` (short quotes exactly, long ones 70% of their significant words). */
export function groundedIn(resumeText: string): (claim: unknown) => boolean {
  const groundedResume = normalizeForGrounding(resumeText);
  return (claim: unknown): boolean => {
    if (typeof claim !== "string") return false;
    const n = normalizeForGrounding(claim);
    if (!n) return false;
    if (n.length <= 45) return groundedResume.includes(n);
    // Long quotes: tolerate minor paraphrase — 70% of significant tokens must appear.
    const tokens = n.split(" ").filter((w) => w.length >= 4);
    if (tokens.length < 3) return groundedResume.includes(n.slice(0, 45));
    const hits = tokens.filter((tk) => groundedResume.includes(tk)).length;
    return hits / tokens.length >= 0.7;
  };
}
