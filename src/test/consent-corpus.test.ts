/**
 * A REGRESSION LOCK ON REAL QUESTIONS, and an admission about how it came to
 * exist.
 *
 * The `consent` class shipped on 2026-08-03 with a unit test that passed and a
 * deployed classifier that did not work. The test fixture for the Dutch case
 * was written from a sample I had TRUNCATED to 110 characters, and I completed
 * the tail from memory as "gelezen en ga akkoord" (read and agreed). The real
 * label ends "gelezen en begrijp hoe mijn persoonsgegevens worden verwerkt"
 * (read and understand how my personal data is processed) — different words,
 * and far enough past "heb" to fall outside the 40-character window the regex
 * allowed. The unit test was green against my invention while the live
 * classifier called the real thing `draftable`.
 *
 * A fixture I wrote is a test of my imagination. A fixture harvested from the
 * vendors is a test of the product. So this file replays LIVE LABELS, verbatim:
 * 5,537 real questions were harvested from 532 postings across all six reader
 * vendors, and `fixtures/consent-corpus.json` holds a deduplicated slice —
 * every consent-classified label, plus every near-miss in the other classes,
 * because the near-misses are what an over-eager pattern breaks first.
 *
 * WHAT THIS FILE IS AND IS NOT. The `expect` values were not derived
 * independently; they are this classifier's output over the corpus, after I
 * read all 75 labels whose classification changed and confirmed each one. So it
 * is a RATCHET, not an oracle: it cannot tell us the classifier is right, only
 * that it has not silently drifted from a state a human checked. That is worth
 * having and it is not worth more than it is.
 *
 * THE TAIL IS REAL. This is pattern matching over free text in at least six
 * languages; there will be phrasings it misses. Two things bound the damage: a
 * missed consent lands in `draftable`, where the grounding validator marks an
 * unsupported answer rather than passing it off as fact, and the packet's
 * blockers still surface it to a human on the click-to-submit path — which is
 * 94.7% of the board.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyQuestion } from "../../supabase/functions/_shared/application-questions.ts";

type Row = { label: string; type: string; expect: string };
const CORPUS: Row[] = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/consent-corpus.json"), "utf8"),
);

describe("the classifier over 103 live vendor questions", () => {
  it("has a corpus worth replaying", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(100);
    // If the consent slice ever empties, the fixture was regenerated against a
    // broken classifier and every assertion below became vacuous.
    expect(CORPUS.filter((r) => r.expect === "consent").length).toBeGreaterThanOrEqual(40);
    expect(CORPUS.filter((r) => r.expect === "draftable").length).toBeGreaterThanOrEqual(20);
  });

  for (const cls of ["consent", "factual", "draftable", "identity", "file", "demographic"]) {
    const rows = CORPUS.filter((r) => r.expect === cls);
    if (!rows.length) continue;
    it(`classifies all ${rows.length} live "${cls}" labels unchanged`, () => {
      const wrong = rows
        .map((r) => ({ got: classifyQuestion(r.label, r.type), r }))
        .filter((x) => x.got !== cls)
        .map((x) => `${x.got} (want ${cls}): ${x.r.label.slice(0, 90)}`);
      expect(wrong, `\n${wrong.join("\n")}`).toEqual([]);
    });
  }
});

/**
 * THE SPECIFIC LABEL THAT BEAT THE FIRST VERSION. Kept separate and verbatim,
 * because a regression here is not a general drift — it is this exact defect
 * returning, and it should say so by name when it fails.
 */
const THE_DUTCH_ONE =
  "Ik heb de privacyverklaring van Pon Holding B.V. gelezen en begrijp hoe mijn " +
  "persoonsgegevens worden verwerkt.";

describe("the label the invented fixture hid", () => {
  it("is consent, in full, as the vendor actually returns it", () => {
    expect(classifyQuestion(THE_DUTCH_ONE, "")).toBe("consent");
  });

  it("is still consent with the markup the vendor wraps it in", () => {
    const withTags =
      '<p>Ik heb de <a href="https://www.jobsatpon.com/nl/nl/privacy-statement" ' +
      'target="_blank" rel="noopener">privacyverklaring</a> van Pon Holding B.V. ' +
      "gelezen en begrijp hoe mijn persoonsgegevens worden verwerkt.</p>";
    expect(classifyQuestion(withTags, "")).toBe("consent");
  });

  it("does not depend on any single branch matching", () => {
    // "privacyverklaring", "persoonsgegevens" and "ik heb ... gelezen" each
    // independently identify this. One pattern edit should not be able to
    // silently un-catch it.
    expect(classifyQuestion("Ik heb de voorwaarden gelezen en begrijp deze.", "")).toBe("consent");
    expect(classifyQuestion("Verwerking van mijn persoonsgegevens", "")).toBe("consent");
    expect(classifyQuestion("Akkoord met de privacyverklaring", "")).toBe("consent");
  });
});

/**
 * THE OTHER HALF OF THE RATCHET. Widening a safety pattern is cheap and feels
 * free; the cost lands on questions that WERE being answered well. Each of
 * these is a live label that a résumé can genuinely answer, and every one of
 * them sits close enough to consent wording to be swallowed by a careless edit.
 */
describe("questions a résumé can answer keep getting answered", () => {
  const MUST_DRAFT = [
    "Please confirm whether you have 3+ years of hands-on experience with revenue recognition under US GAAP (ASC 606)?",
    "Do you speak, write, or understand any other language?",
    "Are you RBT Certified? If so, please share your RBT certification number below.",
    "Do you have experience directly selling products, services, and service agreements in the commercial and/or industrial sectors?",
    "Do you agree that good design is invisible? Why or why not?",
    "Describe a time you had to get a team to agree on a difficult tradeoff.",
    "Do you have IPC-A-610 / J-STD-001 or any other certifications?",
    "Kindly, write down professional certificates you have",
  ];

  it("stay draftable", () => {
    const stolen = MUST_DRAFT
      .map((l) => ({ got: classifyQuestion(l, ""), l }))
      .filter((x) => x.got !== "draftable")
      .map((x) => `${x.got}: ${x.l.slice(0, 80)}`);
    expect(stolen, `consent patterns have grown too greedy:\n${stolen.join("\n")}`).toEqual([]);
  });

  it("the split between a commitment and a résumé fact holds", () => {
    // These two differ by three words and belong to different classes. If a
    // future edit collapses them, it collapses the whole distinction.
    expect(classifyQuestion("Please confirm you are comfortable with these requirements.", ""))
      .toBe("consent");
    expect(classifyQuestion("Please confirm you have 5 years of Kubernetes experience.", ""))
      .toBe("draftable");
  });
});
