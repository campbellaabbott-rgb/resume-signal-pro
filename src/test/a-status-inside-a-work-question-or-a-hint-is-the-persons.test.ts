/**
 * A STATUS INSIDE A WORK QUESTION, OR IN THE EMPLOYER'S HINT, IS THE PERSON'S.
 *
 * Sweep S12-081. The work-done exemption read a later clause as part of the
 * work unless it addressed the person ("you", "list", "explain"), so a
 * protected status with no such word rode through: "Describe your experience
 * and current visa status" came back draft_from_your_cv, and so did pay,
 * vaccination and accommodation asks in the same shape. A model asked to
 * draft that writes a visa status, a pay figure or a medical fact in the
 * person's name.
 *
 * Sweep S12-082. apply_myself never read the employer's hint under a label:
 * "Tell us about your experience with Kubernetes" with the note "Include your
 * salary expectations and whether you need sponsorship" was drafted, and the
 * packet printed the note under "Questions your AI may draft".
 *
 * The real modules: the server's classifier, the worker's mirror of the
 * work-done rule (which a cross-runtime check holds equal), the who-answers
 * rule and the markdown packet.
 */
import { describe, expect, it } from "vitest";
import {
  asksAboutWorkDone,
  classifyQuestion,
  PERSON_STATE,
  PROTECTED_FACTUAL,
} from "../../supabase/functions/_shared/application-questions";
import { hintIsPlain, whoAnswers } from "../../supabase/functions/_shared/self-apply";
import { applyMyselfAnswer, applyMyselfMarkdown } from "../../supabase/functions/agent-mcp/apply-myself";
import * as workerProtected from "../../worker/src/questions/protected.js";

/** Compound work-done labels carrying a visa, pay, vaccination, accommodation or other protected status ask. */
const STATUS_INSIDE_WORK = [
  "Describe your experience and current visa status",
  "Describe your relevant experience and immigration status",
  "Describe your experience and green card status",
  "Describe your experience and H-1B status",
  "Describe your current visa status and experience",
  "Describe your experience and expected hourly rate",
  "Describe your sales experience and desired day rate",
  "Tell us about your experience and current wage",
  "Describe your work experience and remuneration expectations",
  "Explain your experience and minimum pay rate",
  "Describe your sales experience, plus OTE expectations",
  "Tell us about your experience, including vaccination status",
  "Describe your nursing experience and vaccination status",
  "Describe your experience in retail and vaccination status",
  "Describe your background in nursing and vaccination history",
  "Describe your experience and any accommodations needed for the interview",
  "Describe your experience and any reasonable accommodations",
  "Describe your customer service experience and interview accommodations required",
  "Describe your experience with patients, as well as medical conditions requiring accommodation",
  "Describe your experience in logistics and shift availability",
  "Describe your experience in finance and passport details",
  "Describe your experience and tax ID",
  "Describe your experience and expected rate",
];

/** Work done in protected words, which a CV establishes: still drafted. */
const WORK_IN_PROTECTED_WORDS = [
  "Describe your experience with immigration law and visa petitions",
  "Tell us about your experience processing payroll and wages",
  "Describe your experience with payroll, including wages and overtime",
  "Describe your experience administering vaccinations to children",
  "Describe your experience handling reasonable accommodation requests for employees",
  "Describe your experience in immigration law, including H-1B petitions",
  "Describe your experience handling employee terminations and exit interviews",
];

describe("a protected status inside a work-done question is never drafted (S12-081)", () => {
  it.each(STATUS_INSIDE_WORK)("%s", (label) => {
    expect(asksAboutWorkDone(label), "not a question about work done").toBe(false);
    expect(classifyQuestion(label, "textarea"), "the classifier keeps it from a model").not.toBe("draftable");
    for (const type of ["textarea", "paragraph", "input_text"]) {
      expect(whoAnswers({ label, required: true, type }, 1).answeredBy, type).toBe("you");
    }
  });

  it.each(WORK_IN_PROTECTED_WORDS)("still drafted: %s", (label) => {
    expect(asksAboutWorkDone(label)).toBe(true);
    expect(whoAnswers({ label, required: false, type: "textarea" }, 1).answeredBy).toBe("draft_from_your_cv");
  });

  it("the widened lists name the asks the clause rule now refuses", () => {
    for (const s of ["visa requirements", "expected hourly rate", "desired rate", "rate expectations", "base pay", "accommodation needs", "interview accommodations", "immunization records"]) {
      expect(PROTECTED_FACTUAL.test(s), s).toBe(true);
    }
    for (const s of ["current visa status", "accommodations needed", "vaccination history", "passport details"]) {
      expect(PERSON_STATE.test(s), s).toBe(true);
    }
  });

  it("the worker, which never imports the server, reads every one of them the same way", () => {
    expect(workerProtected.PERSON_STATE.source).toBe(PERSON_STATE.source);
    expect(workerProtected.PROTECTED_FACTUAL.source).toBe(PROTECTED_FACTUAL.source);
    for (const label of [...STATUS_INSIDE_WORK, ...WORK_IN_PROTECTED_WORDS]) {
      expect(workerProtected.asksAboutWorkDone(label), label).toBe(asksAboutWorkDone(label));
    }
    for (const label of STATUS_INSIDE_WORK) expect(workerProtected.isProtectedQuestion(label), label).toBe(true);
  });
});

describe("the employer's hint is read with the label (S12-082)", () => {
  const LABEL = "Tell us about your experience with Kubernetes in production";

  it("a hint asking for pay or sponsorship keeps the question with the person, and says what it is about", () => {
    const q = whoAnswers({ label: LABEL, required: true, type: "textarea", hint: "Include your salary expectations and whether you need sponsorship." }, 1);
    expect(q.answeredBy).toBe("you");
    expect(q.cvMayHelp).toBe(true);
    expect(q.topic).toBe("sponsorship");
  });

  it.each([
    "Please also state your current visa status.",
    "Mention any accommodations you need for the interview.",
    "Include your notice period.",
    "Tell us why you are leaving your current role.",
    "Add two references.",
    "Are you vaccinated?",
  ])("not drafted with the hint %s", (hint) => {
    expect(hintIsPlain(hint)).toBe(false);
    expect(whoAnswers({ label: LABEL, required: true, type: "textarea", hint }, 1).answeredBy).toBe("you");
  });

  it.each(["A few sentences.", "Max 300 words.", "Include the scale of the clusters you ran and the tools you used.", "What was the outcome?"])(
    "a plain hint still lets the work question be drafted: %s",
    (hint) => {
      expect(hintIsPlain(hint)).toBe(true);
      expect(whoAnswers({ label: LABEL, required: true, type: "textarea", hint }, 1).answeredBy).toBe("draft_from_your_cv");
    },
  );

  it("a cover-letter box whose hint asks for pay is the person's too", () => {
    const q = whoAnswers({ label: "Cover letter", required: false, type: "textarea", hint: "Please include your expected salary." }, 1);
    expect(q.answeredBy).toBe("you");
    expect(whoAnswers({ label: "Cover letter", required: false, type: "textarea", hint: "Optional." }, 1).answeredBy).toBe("draft_from_your_cv");
  });

  it("the packet prints such a hint under the person's heading, never under the drafting one", () => {
    const posting = { id: "greenhouse:acme:1", title: "Platform Engineer", company: "Acme", location: "Leeds", pay: null, postedAt: null, applyUrl: "https://boards.greenhouse.io/acme/jobs/1", siteUrl: "https://resumebooster.work/jobs?job=greenhouse:acme:1" };
    const hint = "Include your salary expectations and whether you need sponsorship.";
    const read = { kind: "read", vendor: "greenhouse", readAt: "2026-10-12T00:00:00Z", cached: false, form: { questions: [{ label: LABEL, required: true, type: "textarea", hint }, { label: STATUS_INSIDE_WORK[0], required: true, type: "textarea" }], documents: [], alsoOnForm: [] } };
    const md = applyMyselfMarkdown(applyMyselfAnswer(posting, read as never, []));
    const drafting = md.split(/^## /m).find((s) => /^Questions your AI may draft/.test(s)) ?? "";
    const yours = md.split(/^## /m).find((s) => /^Questions you answer yourself/.test(s)) ?? "";
    expect(drafting).not.toContain(hint);
    expect(drafting).not.toContain(STATUS_INSIDE_WORK[0]);
    expect(yours).toContain(hint);
    expect(yours).toContain(STATUS_INSIDE_WORK[0]);
  });
});
