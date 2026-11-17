/**
 * A POSTING NOT IN ENGLISH IS FLAGGED (MCP upgrade 3, W1 lane L4: U3-08r,
 * critique M10).
 *
 * WHAT WAS WRONG. The excerpt picks lines with English patterns only. A
 * "remote data engineer in Europe" search returns German, Dutch, French and
 * Spanish postings, whose sponsorship or work-permit lines it never picks
 * out, and the answer said nothing about that: an AI reading an empty
 * excerpt reports "doesn't mention sponsorship" for a posting that may well
 * say it, in its own language.
 *
 * WHAT IS NOW TRUE. requirementsExcerptOf adds excerptLanguage, "not English:
 * lines in other languages are not picked out", to a posting written mostly
 * in another language. The test is a stop-word one: the share of distinctive
 * English function words among the posting's words, or letters in another
 * script. It never names a language, and a terse English list is not
 * flagged. Judged on the 463 real postings of the posting-language corpus
 * (259 labelled English, 204 in 20 other languages): every posting in
 * another language is flagged, and of the English-labelled ones only two
 * whose own text is Hungarian, or half Chinese, are.
 */
import { describe, expect, it } from "vitest";
import { EXCERPT_NOT_ENGLISH, requirementsExcerptOf } from "../../supabase/functions/agent-mcp/posting-excerpt";
import C14 from "./fixtures/posting-excerpt-c14.json";
import LANG from "./fixtures/posting-language-corpus-2026-11-15.json";

const CASES = (LANG as { cases: Array<{ id: string; truth: string; text: string }> }).cases;
const flagged = (text: string) => requirementsExcerptOf(text).excerptLanguage === EXCERPT_NOT_ENGLISH;

describe("the flag", () => {
  it("says what it means in the spec's words", () => {
    expect(EXCERPT_NOT_ENGLISH).toBe("not English: lines in other languages are not picked out");
  });

  it("is set on every posting of the language corpus written in another language, and on no English one but two whose own text is not", () => {
    const english = CASES.filter((c) => c.truth === "en");
    const other = CASES.filter((c) => c.truth !== "en");
    const flaggedEnglish = english.filter((c) => flagged(c.text)).map((c) => c.id);
    const missed = other.filter((c) => !flagged(c.text)).map((c) => `${c.truth} ${c.id}`);
    console.log(`[L4] language corpus: English-labelled flagged ${flaggedEnglish.length}/${english.length}; other languages flagged ${other.length - missed.length}/${other.length}`);
    expect(english.length).toBe(259);
    expect(other.length).toBe(204);
    expect(missed).toEqual([]);
    // The corpus labels these two by the language their page was served in.
    // Their text is not English: GKN's body is Hungarian after an English
    // title block, and ABB's internship alternates Chinese and English lines,
    // so lines in another language are indeed not picked out.
    expect(flaggedEnglish.sort()).toEqual([
      "site:/jobs/posting/workday/aampower~wd1~AAM-Career-Site/JREQ-226298",
      "site:/jobs/posting/workday/abb~wd3~external_career_page/JR00051285",
    ]);
    expect(CASES.find((c) => c.id.endsWith("JREQ-226298"))!.text).toMatch(/Az alábbi feladatokra lehet számítani a pozícióban/);
    expect(CASES.find((c) => c.id.endsWith("JR00051285"))!.text).toMatch(/岗位职责/);
  });

  it("is not set on any c14 posting (all English), cut or whole", () => {
    for (const p of (C14 as { postings: Array<{ id: string; cutText: string; wholeText?: string }> }).postings) {
      expect(flagged(p.cutText), p.id).toBe(false);
      if (p.wholeText) expect(flagged(p.wholeText), p.id).toBe(false);
    }
  });

  it("is not set on a terse English list, or on English that names Des Moines, MIT or an au pair", () => {
    expect(flagged("Requirements:\n· SQL\n· Python\n· Airflow\n· dbt\n· 3+ years")).toBe(false);
    expect(flagged("Based in Des Moines. MIT or equivalent degree preferred. Previous au pair or nanny experience welcome. You will report to the director of the school.")).toBe(false);
  });

  it("is not set on an empty description", () => {
    expect("excerptLanguage" in requirementsExcerptOf("")).toBe(false);
  });

  it("rides beside the lines, which are still picked from any English lines", () => {
    const de = CASES.find((c) => c.truth === "de")!.text;
    const ex = requirementsExcerptOf(`${de}\nApplicants must have the right to work in Germany.`);
    expect(ex.excerptLanguage).toBe(EXCERPT_NOT_ENGLISH);
    expect(ex.postingExcerpt).toContain("Applicants must have the right to work in Germany.");
  });
});
