/**
 * apply-agent wrote the answers and the sender threw them away.
 *
 * MEASURED 2026-08-03 by dry-running twelve live postings. Two of them blocked
 * on questions like "How familiar are you with Service Titan?" and "What are
 * the brands or types of units you have worked on?" — ordinary résumé
 * questions, refused as `unrecognised` with "no standing answer covers ...".
 *
 * apply-agent had already answered them. It harvests the employer's real
 * questions from six vendors, drafts each draftable one against the résumé and
 * the job description, runs every draft past the grounding gate, and ships the
 * survivors in `packet.fields` keyed by question label. That payload travels
 * intact — apply-agent → agent_submissions → apply-broker → the worker — and
 * the worker read exactly one key out of it, the cover note, then discarded the
 * rest in `toFieldKeys` and refused the posting.
 *
 * So the entire question pipeline contributed nothing to the submit path.
 *
 * THE PROPERTY THIS FILE PROTECTS is not "use the drafts" — it is "use them
 * ONLY where nothing else could have answered". A drafted sentence must never
 * reach a consent box, a truthfulness declaration, a work-authorisation
 * question or a salary expectation. Those refuse on PRINCIPLE: they must come
 * from the person, and a generated answer is precisely what they exist to
 * prevent. `unrecognised` is the single category that means "our schema has
 * nothing for this", which is exactly what a grounded draft is for.
 */
import { describe, expect, it } from "vitest";
import {
  matchQuestion,
  planAnswers,
  normaliseLabel,
  type PreparedAnswers,
  type StandingAnswers,
} from "../../worker/src/questions/match.js";
import type { DomQuestion } from "../../worker/src/vendors/enumerate-dom.js";

const FULL: StandingAnswers = {
  fullName: "Alex Fairweather", firstName: "Alex", lastName: "Fairweather",
  email: "alex@example.com", phone: "+44 7700 900123",
  city: "Leeds", country: "United Kingdom", address: "12 Example Street", postcode: "LS1 4AP",
  linkedin: "https://linkedin.com/in/example", website: "",
  coverNote: "A short note.", salaryExpectation: "£55,000", earliestStart: "4 weeks",
  workAuthorized: true, requiresSponsorship: false, willingToRelocate: true,
  workAuthorizedCountries: ["US"],
  shareDemographics: false, consentToProcessing: false,
};
const q = (over: Partial<DomQuestion> = {}): DomQuestion => ({
  name: "x", type: "text", required: true, label: "", options: [], ...over,
});
const prep = (o: Record<string, string>): PreparedAnswers =>
  new Map(Object.entries(o).map(([k, v]) => [normaliseLabel(k), v]));

/** Verbatim from the 2026-08-03 dry runs. Not invented question text. */
const LIVE_UNRECOGNISED = "How familiar are you with Service Titan?";

describe("a drafted answer resolves what nothing else could", () => {
  it("answers the live question that was blocking a real posting", () => {
    const dq = q({ label: LIVE_UNRECOGNISED });
    expect(matchQuestion(dq, FULL)?.kind, "precondition: this must refuse without a draft")
      .toBe("unanswerable");

    const r = matchQuestion(dq, FULL, undefined,
      prep({ [LIVE_UNRECOGNISED]: "I used ServiceTitan daily for two years scheduling field jobs." }));
    expect(r?.kind).toBe("fill");
    expect((r as { value: string }).value).toMatch(/ServiceTitan/);
  });

  it("matches labels across case, spacing and a required marker", () => {
    // The harvested label and the DOM label come from the same vendor but not
    // the same surface, so they differ in exactly these ways.
    const r = matchQuestion(q({ label: "  How Familiar Are You With Service Titan? *" }), FULL, undefined,
      prep({ [LIVE_UNRECOGNISED]: "Two years, daily." }));
    expect(r?.kind).toBe("fill");
  });

  it("leaves the refusal alone when no draft covers the question", () => {
    const r = matchQuestion(q({ label: "What is your favourite colour of forklift?" }), FULL, undefined,
      prep({ "something else entirely": "unrelated" }));
    expect(r?.kind).toBe("unanswerable");
  });

  it("ignores an empty or whitespace draft rather than filling blank", () => {
    for (const bad of ["", "   ", "\n"]) {
      const r = matchQuestion(q({ label: LIVE_UNRECOGNISED }), FULL, undefined,
        prep({ [LIVE_UNRECOGNISED]: bad }));
      expect(r?.kind, `filled from ${JSON.stringify(bad)}`).toBe("unanswerable");
    }
  });
});

/**
 * THE HALF THAT MATTERS MORE. Every one of these refuses for a reason no draft
 * can satisfy. If a future edit makes `prepared` apply to any of them, the
 * agent starts attesting and asserting on a candidate's behalf — which is the
 * exact failure the whole honesty layer exists to prevent.
 */
describe("a drafted answer can never override a refusal of principle", () => {
  const CANNOT = [
    ["consent", "Allow us to process your personal information"],
    ["consent", "I've read the Privacy Notice below and consent to it"],
    ["declaration", "I confirm the information given is true and complete"],
    ["work auth", "Are you eligible to work in the USA?"],
    ["salary", "What are your compensation expectations?"],
    ["notice", "What is your notice period?"],
  ] as const;

  for (const [kind, label] of CANNOT) {
    it(`refuses "${label.slice(0, 42)}" (${kind}) even with a draft on file`, () => {
      const withDraft = matchQuestion(q({ label }), FULL, undefined,
        prep({ [label]: "Yes, absolutely — happy to confirm." }));
      // Either it still refuses, or it resolved from the PROFILE — never from
      // the draft. A profile-sourced fill is fine; a drafted one is not.
      if (withDraft?.kind === "unanswerable") return;
      expect(
        (withDraft as { value?: string })?.value ?? "",
        `a draft leaked into a ${kind} question`,
      ).not.toMatch(/happy to confirm/i);
    });
  }

  it("never overrides a SUCCESSFUL standing answer", () => {
    const dq = q({ label: "What is your notice period?" });
    const without = matchQuestion(dq, FULL);
    const withDraft = matchQuestion(dq, FULL, undefined, prep({ "What is your notice period?": "Immediately" }));
    expect(withDraft).toEqual(without);
  });
});

describe("planAnswers threads the drafts through", () => {
  it("moves a question from blocking to answerable", () => {
    const questions = [q({ label: LIVE_UNRECOGNISED, name: "q1" })];
    const before = planAnswers(questions, FULL, new Set());
    expect(before.blocking.length).toBe(1);

    const after = planAnswers(questions, FULL, new Set(), undefined,
      prep({ [LIVE_UNRECOGNISED]: "Two years of daily use." }));
    expect(after.blocking.length).toBe(0);
    expect(after.answerable.length).toBe(1);
  });

  it("an OPTIONAL unrecognised question still needs no draft to pass", () => {
    // Optional questions were never blocking; drafts must not change that.
    const questions = [q({ label: "Anything else?", name: "q2", required: false })];
    expect(planAnswers(questions, FULL, new Set()).blocking.length).toBe(0);
  });
});

/**
 * The wiring, asserted at source. The matcher can be perfect and still useless
 * if index.ts keeps dropping the fields — which is exactly what it did.
 */
describe("the worker actually extracts drafts from the packet", () => {
  it("builds prepared answers and passes them to the apply call", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const idx = readFileSync(resolve(__dirname, "../../worker/src/index.ts"), "utf8");
    const code = idx.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code, "toPrepared is gone — drafts are being dropped again").toMatch(/function toPrepared/);
    expect(code, "prepared is not passed to applyToPosting").toMatch(/prepared: toPrepared\(/);
    // Only grounded drafts travel. A `standing` copy would shadow the profile.
    expect(code).toMatch(/field\?\.source !== "drafted"/);
  });
});
