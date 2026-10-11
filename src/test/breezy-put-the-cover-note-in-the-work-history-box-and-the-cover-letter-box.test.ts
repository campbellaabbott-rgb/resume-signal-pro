import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { breezy } from "../../worker/src/vendors/breezy.js";
import { normaliseLabel, planAnswers, type StandingAnswers } from "../../worker/src/questions/match.js";
import type { DomQuestion } from "../../worker/src/vendors/enumerate-dom.js";

/**
 * Sweep S8-082. The Breezy adapter mapped the cover note to cSummary, which is
 * labelled "Work History" on all 8 fixture forms (and required on
 * barloworldequipment), and the matcher then filled the real "Cover Letter" box
 * (cCoverLetter) with the same note. Every Breezy application with a note
 * carried a misfiled Work History; where Work History was required and the
 * candidate had no note, the form was refused.
 */
const forms: Array<{ host: string; questions: DomQuestion[] }> = JSON.parse(
  readFileSync(resolve(__dirname, "../../worker/src/vendors/__fixtures__/breezy-questions.json"), "utf8"),
);
const NOTE = "I build reliable payment systems and would like to do it for you.";
const A: StandingAnswers = {
  fullName: "Alex Doe", firstName: "Alex", lastName: "Doe", email: "a@example.com", phone: "+44 7700 900123",
  city: "Leeds", country: "United Kingdom", address: "1 Main St", postcode: "LS1 4AP", linkedin: "", website: "",
  coverNote: NOTE, salaryExpectation: "£50,000", earliestStart: "4 weeks",
  workAuthorized: true, requiresSponsorship: false, willingToRelocate: true,
  workAuthorizedCountries: ["US", "ZA", "AU"], shareDemographics: false, consentToProcessing: true,
};

async function selectorFor(field: "coverNote"): Promise<string | null> {
  let seen: string | null = null;
  const page = {
    locator: (sel: string) => {
      seen = sel;
      return { first: () => ({ count: async () => 1, fill: async () => {}, isVisible: async () => true }) };
    },
  };
  await breezy.locate(page as never, field);
  return seen;
}

describe("the cover note goes in the cover letter box, once", () => {
  it("the adapter places the note in cCoverLetter", async () => {
    expect(await selectorFor("coverNote")).toBe('textarea[name="cCoverLetter"]');
  });

  it("nothing else on a real Breezy form is filled with the note", () => {
    for (const f of forms) {
      const { answerable } = planAnswers(f.questions, A, breezy.mappedNames);
      const withNote = answerable.filter((x) => x.r.kind === "fill" && x.r.value === NOTE).map((x) => x.q.name);
      expect(withNote, f.host).toEqual([]);
    }
  });

  it("a required Work History box is a question, answered by its draft or asked of the candidate", () => {
    const form = forms.find((f) => f.host.startsWith("barloworldequipment"))!;
    const ws = form.questions.find((q) => q.name === "cSummary")!;
    expect(ws.required).toBe(true);
    const asked = planAnswers([ws], A, breezy.mappedNames);
    expect(asked.blocking.map((b) => b.q.name)).toEqual(["cSummary"]);
    const drafted = planAnswers([ws], A, breezy.mappedNames, undefined, new Map([[normaliseLabel(ws.label), "Payments engineer, 2019-2026."]]));
    expect(drafted.answerable).toMatchObject([{ r: { kind: "fill", value: "Payments engineer, 2019-2026." } }]);
  });
});
