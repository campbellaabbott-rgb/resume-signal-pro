/**
 * SHORTLIST REDACTION KEPT A SURNAME THAT IS A WORD OF THE CANDIDATE'S OWN
 * FIELD (register S11-057, a regression of the S8-004 fix d6a1f1bc).
 *
 * Wave 3 masked every name token case-insensitively, so a candidate named
 * John Wells had "40 horizontal wells" scored as "40 horizontal [CANDIDATE]",
 * and Banks, Grant, Mills, Glass and English lost "investment banks", "grant
 * writing", "paper mills", "glass furnaces" and "english-language" the same
 * way: core experience erased before scoring and logged as name redaction, a
 * disparate-scoring risk in an employer compliance product.
 *
 * Below the header block a single name token is masked only in Title case,
 * UPPER case or the case the header wrote it in; inside the header, in any
 * case; the full name and the handles built from it, in any case anywhere.
 */
import { describe, expect, it } from "vitest";
import { redactForScoring } from "../../supabase/functions/_shared/redaction";

const CASES: Array<{ name: string; evidence: string; titled: string }> = [
  { name: "John Wells", evidence: "Drilled 40 horizontal wells in the Permian basin.", titled: "Wells led the completions crew." },
  { name: "Mary Banks", evidence: "Advised investment banks on capital requirements.", titled: "Banks presented to the board." },
  { name: "Sarah Grant", evidence: "Wrote grant applications worth $2M a year.", titled: "Grant ran the program office." },
  { name: "Tom Mills", evidence: "Ran maintenance for two paper mills.", titled: "Mills cut downtime by 30%." },
  { name: "Emma Glass", evidence: "Engineered glass furnaces for container plants.", titled: "Glass owned the furnace rebuild." },
  { name: "Lucy English", evidence: "Taught english-language learners in grades 3-5.", titled: "English wrote the district curriculum." },
];

describe("a surname that is an ordinary word of the field", () => {
  for (const c of CASES) {
    it(`${c.name}: the lower-case evidence survives, the name as written is masked`, () => {
      const [first, last] = c.name.split(" ");
      const r = redactForScoring(`${c.name}\nEXPERIENCE\n${c.evidence}\n${c.titled}\nContact ${first.toLowerCase()}.${last.toLowerCase()}@example.com`);
      expect(r.redacted).toContain(c.evidence);
      expect(r.redacted).not.toContain(c.titled.split(" ")[0] + " ");
      expect(r.redacted).not.toMatch(new RegExp(`\\b${c.name}\\b`, "i"));
      expect(r.redacted).not.toMatch(new RegExp(`${first}\\.${last}@`, "i"));
    });
  }

  it("an UPPER-case surname, and the full name in lower case, are still masked below the header", () => {
    const r = redactForScoring("John Wells\nEXPERIENCE\nWELLS ENERGY SERVICES: drilled 40 horizontal wells.\nreferences: john wells, Midland");
    expect(r.redacted).not.toMatch(/WELLS ENERGY/);
    expect(r.redacted).toContain("drilled 40 horizontal wells.");
    expect(r.redacted).not.toMatch(/john wells/i);
  });

  it("inside the header a lower-case surname is still masked", () => {
    const r = redactForScoring("John Wells\nwells | Midland, TX\nEXPERIENCE\nDrilled 40 horizontal wells.");
    const [header] = r.redacted.split("EXPERIENCE");
    expect(header).not.toMatch(/wells/i);
    expect(r.redacted).toContain("Drilled 40 horizontal wells.");
  });

  it("a surname with an inner capital is masked as the header wrote it", () => {
    const r = redactForScoring("Sean McDonald\nEXPERIENCE\nMcDonald led the rollout at three sites.");
    expect(r.redacted).not.toMatch(/McDonald/);
  });
});
