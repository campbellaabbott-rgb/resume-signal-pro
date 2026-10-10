import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchQuestion, type StandingAnswers } from "../../worker/src/questions/match.js";
import type { DomQuestion } from "../../worker/src/vendors/enumerate-dom.js";
import { buildPacket } from "../../supabase/functions/_shared/submission-packet";

/**
 * Review of S8-007. The worker learned which country a work-authorisation
 * question is about ("U.S.", "U.K.", "the US and Canada"); the review sheet
 * kept answering every one of them from the single workAuthorized boolean. A
 * UK candidate's sheet said "Yes" to "Are you legally authorized to work in
 * the U.S.?" while the worker refused the same box, and on the prepared-only
 * vendors the sheet is what the candidate approves and sends. The S8-008
 * widening made it worse: "legally able to work in the United States" used to
 * reach the model and block as unsupported; it became factual and the sheet
 * answered it "Yes" with no country check.
 */
type Who = { country: string; extra?: string[] };
const UK: Who = { country: "United Kingdom" };
const US: Who = { country: "United States" };
const UK_PLUS_US: Who = { country: "United Kingdom", extra: ["US"] };

const workerOf = (w: Who, requiresSponsorship = false): StandingAnswers => ({
  fullName: "Alex Doe", firstName: "Alex", lastName: "Doe", email: "a@example.com", phone: "",
  city: "", country: w.country, address: "", postcode: "", linkedin: "", website: "",
  coverNote: "", salaryExpectation: "", earliestStart: "",
  workAuthorized: true, requiresSponsorship, willingToRelocate: null,
  workAuthorizedCountries: w.extra ?? [], shareDemographics: false, consentToProcessing: false,
});
const radio = (label: string): DomQuestion => ({ name: "auth", type: "radio", required: true, label, options: ["Yes", "No"] });

function sheet(label: string, w: Who, requiresSponsorship = false): string | undefined {
  const p = buildPacket({
    questions: [{ label, required: true, fieldType: "radio" }],
    profile: { fullName: "Alex Doe", country: w.country },
    standing: { workAuthorized: true, requiresSponsorship, workAuthorizedCountries: w.extra ?? [] },
    drafted: [],
    automationTier: "auto",
  });
  return p.fields.find((f) => f.key === label)?.value;
}
const sent = (label: string, w: Who, requiresSponsorship = false) => {
  const r = matchQuestion(radio(label), workerOf(w, requiresSponsorship));
  return r && r.kind === "choose" ? r.option : undefined;
};

describe("the sheet does not claim work rights in a country the candidate never stated", () => {
  it.each([
    ["Are you legally able to work in the United States?", UK],
    ["Are you legally authorized to work in the U.S.?", UK],
    ["Do you have the right to work in the U.K.?", US],
    ["Are you authorized to work in the US and Canada?", UK],
    ["Are you authorized to work in the US and Canada?", UK_PLUS_US],
  ] as Array<[string, Who]>)("%s (%j) is left for the candidate", (label, who) => {
    expect(sheet(label, who)).toBeUndefined();
    expect(sent(label, who)).toBeUndefined();
  });

  it("a sponsorship question about another country is not answered from home either", () => {
    const label = "Will you require visa sponsorship to work in the U.K.?";
    expect(sheet(label, US)).toBeUndefined();
    expect(sent(label, US)).toBeUndefined();
  });
});

describe("a country the candidate did state still answers, in both runtimes", () => {
  it.each([
    ["Are you legally authorized to work in the U.S.?", US, "Yes"],
    ["Are you legally authorized to work in the U.S.?", UK_PLUS_US, "Yes"],
    ["Are you legally able to work in the United States?", US, "Yes"],
    ["Do you have the right to work in the U.K.?", UK, "Yes"],
    ["Are you authorised to work in the UK or the EU?", UK, "Yes"],
    ["Are you legally authorized to work?", UK, "Yes"],
  ] as Array<[string, Who, string]>)("%s (%j) -> %s", (label, who, want) => {
    expect(sheet(label, who)).toBe(want);
    expect(sent(label, who)).toBe(want);
  });
});

describe("the sheet's country rule is the worker's", () => {
  it("the shared copy is byte-identical to the worker's module", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    const worker = read("worker/src/questions/countries.ts");
    expect(worker.length).toBeGreaterThan(5000);
    expect(read("supabase/functions/_shared/work-countries.ts")).toBe(worker);
  });
});
