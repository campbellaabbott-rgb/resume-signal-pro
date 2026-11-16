/**
 * SHORTLIST REDACTION PASSED ENGLISH PROSE PROXIES (S14X-106).
 *
 * WHAT WAS WRONG. The redactor read labelled fields and a few fixed phrases,
 * so ordinary prose carried the protected facts straight to the scorer: "Ms
 * Okafor" without a stop, "She led her team", "Kappa Kappa Gamma sorority",
 * "Raising my children while studying", "grandfather of four", "Over-50
 * professional", "60 years young", "Graduated from Ohio State in 1980",
 * "Born and raised in Lagos", "native of Kerala", "Eagle Scout",
 * "chairwoman".
 *
 * WHAT HOLDS NOW, against a corpus of 248 lines of job evidence and 66 proxy
 * lines (src/test/fixtures/shortlist-redaction-corpus.ts): every evidence
 * line reaches the scorer exactly as written, and every proxy span is gone.
 * Pronouns read as they/them/their, gendered role nouns as the role, and the
 * rules leave HER2, "HE sector", "Her Majesty's Revenue and Customs", "he
 * trabajado", "Phi Beta Kappa", "Raised in Series A", "maternity ward" and
 * "Over 50 enterprise clients" alone.
 */
import { describe, expect, it } from "vitest";
import { redactForScoring } from "../../supabase/functions/shortlist-evaluate/redaction";
import { EVIDENCE, PROXIES } from "./fixtures/shortlist-redaction-corpus";

const wrap = (line: string) => `Jane Okafor\n\nEXPERIENCE\n${line}\nNext line stays too`;

describe("the corpus", () => {
  it("is big enough to judge a prose rule by", () => {
    expect(EVIDENCE.length + PROXIES.length).toBeGreaterThanOrEqual(300);
    expect(new Set(EVIDENCE).size).toBe(EVIDENCE.length);
  });

  it("every line of job evidence reaches the scorer exactly as written", () => {
    const lost = EVIDENCE.filter((line) => !redactForScoring(wrap(line)).redacted.includes(`${line}\nNext line stays too`));
    expect(lost).toEqual([]);
  });

  it("every proxy span is gone, and the next line survives", () => {
    const kept = PROXIES.flatMap(({ line, gone }) => {
      const out = redactForScoring(wrap(line)).redacted;
      const left = gone.filter((g) => out.includes(g));
      return left.length || !out.includes("\nNext line stays too") ? [`${line} -> ${out.split("\n")[3]}`] : [];
    });
    expect(kept).toEqual([]);
  });
});

describe("pronouns and role nouns read neutrally", () => {
  it("she, her, he, his and him read as they, their and them, with the verb agreeing", () => {
    const r = redactForScoring("Jane Okafor\nSUMMARY\nShe led her team. He is a strong communicator and his reviews were thorough. I promoted him twice.");
    expect(r.redacted).toContain("They led their team. They are a strong communicator and their reviews were thorough. I promoted them twice.");
    expect(r.exclusionsApplied.find((e) => e.feature === "gendered_terms")?.count).toBe(5);
  });

  it("a gendered role noun reads as the role, in the case it was written", () => {
    const r = redactForScoring("Jane Okafor\nSUMMARY\nChairwoman of the board; former waitress; SPOKESWOMAN for the campaign");
    expect(r.redacted).toContain("Chair of the board; former server; SPOKESPERSON for the campaign");
  });
});
