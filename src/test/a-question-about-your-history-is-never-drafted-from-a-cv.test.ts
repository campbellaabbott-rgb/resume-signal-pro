/**
 * A QUESTION ABOUT YOUR HISTORY IS NEVER DRAFTED FROM A CV.
 *
 * apply_myself hands a person's own AI the employer's real form, and marks
 * each question with who answers it. The adversarial review of 2026-10-11 ran
 * the classifier over the harvested corpus and found it calls these
 * draftable, which the first draft would have handed to the AI as "draft this
 * from the CV":
 *
 *   "Have you ever been terminated from a job?"
 *   "Why are you leaving your current role?"
 *   "Please list two professional references"
 *   "Please explain any gaps in your employment history"
 *
 * So the rule is DEFAULT-DENY (_shared/self-apply.ts, spec §3.6): the AI drafts
 * only a free-text question about WORK DONE or one of a short list of
 * motivation questions; everything else is the person's, a factual question
 * with its topic named, a demographic one voluntary, a consent never ticked.
 * The classifier itself also learns the person's own history
 * (PERSONAL_HISTORY) and a consent to "collect … my data".
 *
 * The full 5,537-question harvest is not in the repository; the replay here
 * is the checked-in consent corpus (real labels, 103 rows) plus the review's
 * labels, the GLG consent and real Greenhouse, Pinpoint and Recruitee labels.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyQuestion } from "../../supabase/functions/_shared/application-questions.ts";
import { MOTIVATION, isFreeText, isMotivationQuestion, topicOf, whoAnswers, whoAnswersEach } from "../../supabase/functions/_shared/self-apply.ts";

type Row = { label: string; type: string; expect: string };
const CORPUS: Row[] = JSON.parse(readFileSync(resolve(__dirname, "fixtures/consent-corpus.json"), "utf8"));

/** The review's own labels, and the near-variants a form actually prints. */
const HISTORY: Array<[string, string]> = [
  ["Have you ever been terminated from a job?", "employment_history"],
  ["Have you ever been dismissed or asked to resign from any position?", "employment_history"],
  ["Why are you leaving your current role?", "employment_history"],
  ["What is your reason for leaving your most recent employer?", "employment_history"],
  ["Please list two professional references", "references"],
  ["References (name, title, phone)", "references"],
  ["Please explain any gaps in your employment history", "employment_history"],
  ["What was your GPA?", "education_results"],
  ["What was your final degree classification?", "education_results"],
  ["Are you able to work on-site three days a week?", "on_site"],
  ["How long is your commute to our Leeds office?", "commute"],
  ["What time zone are you in?", "location"],
  ["Where are you currently located?", "location"],
  ["Have you ever worked for us before?", "employment_history"],
  ["Have you previously been employed by Acme or any of its subsidiaries?", "employment_history"],
];

describe("the person's own history goes to the person, as a factual question with its topic", () => {
  it.each(HISTORY)("%s", (label, topic) => {
    expect(classifyQuestion(label, "textarea")).toBe("factual");
    const q = whoAnswers({ label, required: true, type: "textarea" }, 1);
    expect(q.answeredBy).toBe("you");
    expect(q.topic).toBe(topic);
  });

  it("a question about WORK DONE that mentions the same words stays draftable from the CV", () => {
    for (const label of [
      "Describe your experience handling employee terminations and exit interviews",
      "Tell us about your experience working with references and citation tools",
      "Describe a project where you worked with a distributed team across time zones",
    ]) {
      const q = whoAnswers({ label, required: false, type: "textarea" }, 1);
      expect(q.answeredBy, label).toBe("draft_from_your_cv");
    }
  });

  it("'worked with' a tool is not prior employment by this employer", () => {
    expect(classifyQuestion("Have you ever worked with Kubernetes in production?", "textarea")).not.toBe("factual");
    expect(whoAnswers({ label: "Have you ever worked with Kubernetes in production?", required: false, type: "textarea" }, 1).answeredBy).toBe("you");
  });
});

describe("the AI drafts only free-text work-done and motivation questions (default-deny)", () => {
  it("motivation questions in free text are drafted; the same words with options are the person's", () => {
    for (const label of ["Why do you want to work at Acme?", "What interests you about this role?", "Cover letter", "Is there anything else you'd like us to know?"]) {
      expect(whoAnswers({ label, required: false, type: "textarea" }, 1).answeredBy, label).toBe("draft_from_your_cv");
      expect(whoAnswers({ label, required: false, type: "select", options: ["A", "B"] }, 1).answeredBy, `${label} (select)`).not.toBe("draft_from_your_cv");
    }
  });

  it("a motivation opening that asks the person's own status is not motivation", () => {
    expect(isMotivationQuestion("Why are you interested in this role, and are you authorised to work in the UK?")).toBe(false);
    expect(isMotivationQuestion("Why do you want this role?")).toBe(true);
    expect(MOTIVATION.test("Tell us why you want this role")).toBe(false);
  });

  it("an unrecognised draftable question is the person's, with a note that the CV may help", () => {
    const q = whoAnswers({ label: "What does great customer service mean to you?", required: true, type: "textarea" }, 3);
    expect(q).toMatchObject({ n: 3, answeredBy: "you", cvMayHelp: true });
  });

  it("only free-text controls are free text: options, yes/no, dates and unknown types never are", () => {
    expect(isFreeText("textarea")).toBe(true);
    expect(isFreeText("input_text")).toBe(true);
    expect(isFreeText("textarea", ["Yes", "No"])).toBe(false);
    for (const t of ["boolean", "multi_value_single_select", "date", "number", "", "weird_type"]) expect(isFreeText(t), t).toBe(false);
  });

  it("identity, files, demographics and consents each get their own answerer", () => {
    const qs = whoAnswersEach([
      { label: "First Name", required: true, type: "input_text" },
      { label: "Resume/CV", required: true, type: "input_file" },
      { label: "What is your gender?", required: false, type: "multi_value_single_select", options: ["Female", "Male", "Decline"] },
      { label: "I agree that GLG may collect and process my data for recruitment purposes", required: true, type: "boolean" },
    ]);
    expect(qs.map((q) => q.answeredBy)).toEqual(["your_details", "your_documents", "you", "you"]);
    expect(qs[2].voluntary).toBe(true);
    expect(qs.map((q) => q.n)).toEqual([1, 2, 3, 4]);
  });

  it("a sponsorship question keeps its sense, so an inverted wording is explained before the person answers", () => {
    const q = whoAnswers({ label: "Will you now or in the future require visa sponsorship?", required: true, type: "boolean" }, 1);
    expect(q.answeredBy).toBe("you");
    expect(q.topic).toBe("sponsorship");
    expect(q.sponsorshipSense).toBeTruthy();
  });
});

describe("the consent the review found: 'collect … my data' is a consent, never a draft", () => {
  it("GLG's label classifies as consent", () => {
    expect(classifyQuestion("I agree that GLG may collect and process my data for recruitment purposes", "textarea")).toBe("consent");
    expect(classifyQuestion("Do you consent to us collecting your personal information?", "boolean")).toBe("consent");
  });
});

describe("the corpus replay", () => {
  it("no real label is drafted unless it is free text about work done or motivation", () => {
    const drafted = CORPUS.map((r) => ({ r, q: whoAnswers({ label: r.label, required: false, type: r.type }, 1) }))
      .filter(({ q }) => q.answeredBy === "draft_from_your_cv");
    for (const { r, q } of drafted) {
      expect(isFreeText(r.type), `${r.label} drafted on a ${r.type} control`).toBe(true);
      expect(classifyQuestion(q.label, r.type), r.label).toBe("draftable");
    }
    // Every consent and demographic label in the corpus stays the person's.
    for (const r of CORPUS.filter((x) => x.expect === "consent" || x.expect === "demographic")) {
      expect(whoAnswers({ label: r.label, required: false, type: r.type }, 1).answeredBy, r.label).toBe("you");
    }
  });

  it("the history labels never come back as drafts, whatever control they sit in", () => {
    for (const [label] of HISTORY) {
      for (const type of ["textarea", "input_text", "boolean", "select"]) {
        expect(whoAnswers({ label, required: true, type }, 1).answeredBy, `${label} (${type})`).not.toBe("draft_from_your_cv");
      }
    }
  });

  it("topicOf names 'other' rather than guessing", () => {
    expect(topicOf("Favourite colour?")).toBe("other");
  });
});
