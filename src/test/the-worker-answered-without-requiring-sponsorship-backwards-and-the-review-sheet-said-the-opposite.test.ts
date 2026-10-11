import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchQuestion, RE_SPONSOR_INVERTED, type StandingAnswers } from "../../worker/src/questions/match.js";
import type { DomQuestion } from "../../worker/src/vendors/enumerate-dom.js";
import { buildPacket, SPONSOR_INVERTED } from "../../supabase/functions/_shared/submission-packet";

/**
 * Sweep S8-006. Wave 1 widened the review sheet's inversion rule to read
 * "without needing / requiring sponsorship" as the opposite question, and left
 * the worker's own rule alone. A candidate who needs sponsorship then approved
 * a sheet that said "No" to "able to work in the US without requiring visa
 * sponsorship?" while the worker, filling the real form, sent "Yes".
 *
 * The two runtimes cannot share a file (the worker builds from worker/src
 * only), so they share a literal and this test feeds the same labels through
 * both and requires the same answer.
 */
const LABELS = [
  "Are you able to work in the US without requiring visa sponsorship?",
  "Are you authorized to work in the US without needing sponsorship?",
  "Can you work in the US without needing any sponsorship?",
  "Are you legally authorised to work in the US without requiring any visa sponsorship?",
  "Can you work in the US without the need for sponsorship?",
  "Will you now or in the future require sponsorship to work in the US?",
  "Do you require visa sponsorship to work in the US?",
  // Review of S8-006: an article, "the need of", and "needing a work visa"
  // still read forwards, and the sheet did not see the visa phrasing at all.
  "Are you eligible to work in the US without a visa sponsorship?",
  "Can you work in the US without the need of sponsorship?",
  "Can you work in the US without needing a work visa?",
  "Are you able to work in the US without requiring a visa?",
];

const worker = (requiresSponsorship: boolean): StandingAnswers => ({
  fullName: "Sam Rivera", firstName: "Sam", lastName: "Rivera", email: "sam@example.com", phone: "",
  city: "Denver", country: "United States", address: "", postcode: "", linkedin: "", website: "",
  coverNote: "", salaryExpectation: "", earliestStart: "",
  workAuthorized: true, requiresSponsorship, willingToRelocate: null,
  workAuthorizedCountries: [], shareDemographics: false, consentToProcessing: false,
});

const radio = (label: string): DomQuestion => ({ name: "q", type: "radio", required: true, label, options: ["Yes", "No"] });

function sheetAnswer(label: string, requiresSponsorship: boolean): string | undefined {
  const p = buildPacket({
    questions: [{ label, required: true, fieldType: "radio" }],
    profile: { fullName: "Sam Rivera", country: "United States" },
    standing: { workAuthorized: true, requiresSponsorship },
    drafted: [],
    automationTier: "auto",
  });
  return p.fields.find((f) => f.key === label)?.value;
}

/**
 * The answer itself, not just agreement (S11-012): two runtimes that agree on
 * the wrong answer passed this test while both read an authorisation question
 * backwards. A "require" label is answered Yes by a candidate who needs
 * sponsorship; a "without" label No.
 */
const forwards = (label: string) => !/\bwithout\b/i.test(label);
const want = (label: string, needs: boolean) => (forwards(label) === needs ? "Yes" : "No");

describe("the worker and the review sheet answer a sponsorship question the same way", () => {
  for (const needs of [true, false]) {
    it.each(LABELS)(`requiresSponsorship=${needs}: %s`, (label) => {
      const sheet = sheetAnswer(label, needs);
      const sent = matchQuestion(radio(label), worker(needs));
      expect(sheet, "the review sheet answers it").toBe(want(label, needs));
      expect(sent).toMatchObject({ kind: "choose", option: want(label, needs) });
    });
  }

  it("a candidate who needs sponsorship says No to working without it, in both runtimes", () => {
    const label = "Are you able to work in the US without requiring visa sponsorship?";
    expect(sheetAnswer(label, true)).toBe("No");
    expect(matchQuestion(radio(label), worker(true))).toMatchObject({ kind: "choose", option: "No" });
    expect(matchQuestion(radio(label), worker(false))).toMatchObject({ kind: "choose", option: "Yes" });
  });

  it.each([
    "Are you eligible to work in the US without a visa sponsorship?",
    "Can you work in the US without the need of sponsorship?",
    "Can you work in the US without needing a work visa?",
  ])("a candidate who needs sponsorship never says Yes to %s", (label) => {
    expect(sheetAnswer(label, true)).toBe("No");
    expect(matchQuestion(radio(label), worker(true))).toMatchObject({ kind: "choose", option: "No" });
  });

  it("a sponsorship question whose 'without' neither rule can read goes to the candidate in both", () => {
    const label = "Do you require sponsorship, or can you work in the US without it?";
    for (const needs of [true, false]) {
      expect(sheetAnswer(label, needs)).toBeUndefined();
      expect(matchQuestion(radio(label), worker(needs))).toMatchObject({ kind: "unanswerable", category: "sponsorship" });
    }
  });

  it("the two runtimes carry the same inversion literal", () => {
    expect(RE_SPONSOR_INVERTED.source).toBe(SPONSOR_INVERTED.source);
  });

  it("and the same sponsorship rule, byte for byte", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    const START = "// ── SPONSORSHIP QUESTION:";
    const END = "// ── end of the sponsorship rule ──";
    const blockOf = (src: string) => {
      const at = src.indexOf(START);
      const to = src.indexOf(END);
      if (at < 0 || to < at) throw new Error("the sponsorship block is gone — RE-ANCHOR this guard");
      return src.slice(at, to);
    };
    const worker = blockOf(read("worker/src/questions/match.ts"));
    expect(worker.length).toBeGreaterThan(800);
    expect(blockOf(read("supabase/functions/_shared/submission-packet.ts"))).toBe(worker);
  });
});
