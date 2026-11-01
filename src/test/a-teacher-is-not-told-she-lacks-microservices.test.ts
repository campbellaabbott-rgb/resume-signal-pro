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
 *
 * Review fix (fix2): the real corpus the register asked for, 3,693 real
 * postings as the résumé stand-in (builder 2,067 + reviewer 1,626), in
 * ~/.config/resumebooster/free-scan-wave-corpora/S13-010/corpus.json. A
 * missing-keyword claim is judged by the field's own postings: supported when
 * the keyword appears in at least 3% of them. Main made 19,478 claims, 28.4%
 * supported; 89c2bc0b 12,984, 34.8%; the fix 13,167, 35.0%. The software
 * fields among the scanner's (data engineering, machine learning,
 * cybersecurity) read technology's list again: its terms appear in their
 * postings about as often as in technology's own. Main's other supported
 * claims (921 across 739 postings) are generic words of technology's list
 * ("cross-functional", "architecture", "monitoring") that happen to occur in
 * other fields' postings: main made them for every field, at 22% support in
 * engineering and 18% in legal.
 */
import { describe, expect, it } from "vitest";
import { analyzeCompetitiveKeywordGap, formatCompetitiveGapForPrompt } from "../../supabase/functions/free-keyword-scan/market-intelligence";
import { INDUSTRY_KEYWORDS } from "../../supabase/functions/free-keyword-scan/industry-detection";
import slice from "./fixtures/free-scan-wave/s13-010-competitive-gap.json";

const SOFTWARE_FIELDS = ["data_engineering", "machine_learning", "cybersecurity"];

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

describe("the software fields read technology's list (review fix)", () => {
  for (const industry of SOFTWARE_FIELDS) {
    it(industry, () => {
      for (const level of ["entry", "mid", "senior", "executive"]) {
        expect(analyzeCompetitiveKeywordGap(TEACHER, industry, level)).toEqual(analyzeCompetitiveKeywordGap(TEACHER, "technology", level));
      }
    });
  }
  it("data science does not", () => {
    expect(analyzeCompetitiveKeywordGap(TEACHER, "data_science", "mid").missingHighFrequency).toEqual([]);
  });
});

describe("the corpus slice: real posting text", () => {
  const cases = (slice as { cases: Array<{ id: string; industry: string; level: string; text: string; missing: string[]; main: string[] }> }).cases;
  it("holds at least 80 cases over 40 fields, most of them ones main got wrong", () => {
    expect(cases.length).toBeGreaterThanOrEqual(80);
    expect(new Set(cases.map((c) => c.industry)).size).toBeGreaterThanOrEqual(40);
    expect(cases.filter((c) => JSON.stringify(c.main) !== JSON.stringify(c.missing)).length).toBeGreaterThanOrEqual(cases.length / 2);
  });
  for (const c of cases) {
    it(`${c.industry}/${c.level} ${c.id.slice(0, 50)}`, () => {
      expect(analyzeCompetitiveKeywordGap(c.text, c.industry, c.level).missingHighFrequency).toEqual(c.missing);
    });
  }
});

describe("no other field borrows technology's list", () => {
  for (const industry of Object.keys(INDUSTRY_KEYWORDS).filter((i) => i !== "technology" && !SOFTWARE_FIELDS.includes(i))) {
    it(industry, () => {
      for (const level of ["entry", "mid", "senior", "executive"]) {
        const tech = analyzeCompetitiveKeywordGap(TEACHER, "technology", level);
        const gap = analyzeCompetitiveKeywordGap(TEACHER, industry, level);
        expect(gap.missingHighFrequency.length === 0 || JSON.stringify(gap.missingHighFrequency) !== JSON.stringify(tech.missingHighFrequency), `${industry}/${level}`).toBe(true);
      }
    });
  }
});
