/**
 * A TEACHER IS NOT TOLD SHE LACKS MICROSERVICES (register S13-010).
 *
 * analyzeCompetitiveKeywordGap fell back to technology's list for every field
 * without one (51 of the 58 the scanner knows), so a teacher, a lawyer or a
 * chef was told she lacked "system design, code review, ci/cd,
 * microservices", which the prompt said "appear in 70%+ of top-quartile
 * education resumes". A field with no list of its own now gets no claim:
 * empty lists, no prompt block, and the card (which needs a missing keyword)
 * does not show.
 *
 * Corpus (~/.config/resumebooster/free-scan-wave-corpora/S13-009, part C):
 * every industry x level, 232 cases; main right only on the 28 with a list,
 * the branch on all 232.
 */
import { describe, expect, it } from "vitest";
import { analyzeCompetitiveKeywordGap, formatCompetitiveGapForPrompt } from "../../supabase/functions/free-keyword-scan/market-intelligence";
import { INDUSTRY_KEYWORDS } from "../../supabase/functions/free-keyword-scan/industry-detection";

const TEACHER = "Planned lessons for 28 students, led parent conferences and ran the after-school robotics club.";

describe("the audit's teacher", () => {
  it("education gets no list, no prompt block", () => {
    const gap = analyzeCompetitiveKeywordGap(TEACHER, "education", "mid");
    expect(gap.missingHighFrequency).toEqual([]);
    expect(gap.presentHighFrequency).toEqual([]);
    expect(formatCompetitiveGapForPrompt(gap, "education", "mid")).toBe("");
  });
  it("technology keeps its own list", () => {
    expect(analyzeCompetitiveKeywordGap(TEACHER, "technology", "mid").missingHighFrequency).toContain("microservices");
  });
});

describe("no field borrows technology's list", () => {
  for (const industry of Object.keys(INDUSTRY_KEYWORDS).filter((i) => i !== "technology")) {
    it(industry, () => {
      for (const level of ["entry", "mid", "senior", "executive"]) {
        const tech = analyzeCompetitiveKeywordGap(TEACHER, "technology", level);
        const gap = analyzeCompetitiveKeywordGap(TEACHER, industry, level);
        expect(gap.missingHighFrequency.length === 0 || JSON.stringify(gap.missingHighFrequency) !== JSON.stringify(tech.missingHighFrequency), `${industry}/${level}`).toBe(true);
      }
    });
  }
});
