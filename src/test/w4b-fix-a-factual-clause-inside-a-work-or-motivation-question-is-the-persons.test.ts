/**
 * A FACTUAL CLAUSE INSIDE A WORK OR MOTIVATION QUESTION IS THE PERSON'S
 * (wave 4 round 2 review, agents lens; S12-081 widened).
 *
 * WHAT WAS WRONG. S12-081 refused a later clause naming a protected status,
 * but the clause loop in asksAboutWorkDone never ran FACTUAL or a factual
 * topic, and isMotivationQuestion had the same gap. A start date, pay,
 * references, gaps, where the person lives or a legal covenant asked in a
 * later clause came back draft_from_your_cv: apply_myself and
 * GET /v1/jobs/{id}/application told the person's AI to draft it, though
 * /v1's ANSWERED_BY_MEANS says these always go to the person. A hint asking
 * "Tell us what you would need to be paid." passed hintIsPlain.
 *
 * WHAT HOLDS NOW (the real modules; the worker's mirror reads the same):
 *   - every label the review ran is answered by the person;
 *   - work done in the same words (drafting covenants, payroll and salary
 *     processing) is still drafted;
 *   - the worker, which never imports the server, agrees label for label.
 */
import { describe, expect, it } from "vitest";
import { asksAboutWorkDone, PERSON_ASKS, PERSON_FACT_NOUNS } from "../../supabase/functions/_shared/application-questions";
import { hintIsPlain, whoAnswers } from "../../supabase/functions/_shared/self-apply";
import * as workerProtected from "../../worker/src/questions/protected.js";

const PERSONS = [
  "Describe your experience in sales and how soon you could start",
  "Describe your experience in sales and when you would be available",
  "Describe your experience in sales and the pay you expect",
  "Describe your experience in sales and what you expect to earn",
  "Describe your experience in sales and what you would need to be paid",
  "Describe your experience in sales and your references",
  "Describe your experience in sales and two references we can contact",
  "Describe your experience in sales and any gaps",
  "Describe your experience in sales and where you live",
  "Tell us about your experience and what you were paid in your last role",
  "Describe your experience in sales and when you can begin",
  "Describe your experience and any restrictive covenants",
  "Describe your experience and any conflicts of interest",
  "Why do you want to work here, and how soon you could start",
  "Why do you want to join us and what you would expect to be paid",
  "Why are you interested in this role, and do you have references we can contact",
];

const STILL_DRAFTED = [
  "Describe your experience drafting restrictive covenants and non-solicitation agreements",
  "Tell us about your experience processing payroll and wages",
  "Describe your experience in sales, including key accounts and pipeline",
  "Describe your experience in sales",
  "Why do you want to work here?",
];

describe("a fact asked in a later clause is answered by the person", () => {
  it.each(PERSONS)("%s", (label) => {
    expect(whoAnswers({ label, required: true, type: "textarea" }, 1).answeredBy).toBe("you");
  });

  it.each(STILL_DRAFTED)("control, still drafted: %s", (label) => {
    expect(whoAnswers({ label, required: true, type: "textarea" }, 1).answeredBy).toBe("draft_from_your_cv");
  });

  it("a hint asking what the person would need to be paid is not plain", () => {
    expect(hintIsPlain("Tell us what you would need to be paid.")).toBe(false);
    expect(hintIsPlain("A few sentences is fine."), "control").toBe(true);
  });
});

describe("the worker reads every one of them the same way", () => {
  it("the same patterns, and the same verdict on every label", () => {
    expect(workerProtected.PERSON_ASKS.source).toBe(PERSON_ASKS.source);
    expect(workerProtected.PERSON_FACT_NOUNS.source).toBe(PERSON_FACT_NOUNS.source);
    for (const label of [...PERSONS, ...STILL_DRAFTED]) expect(workerProtected.asksAboutWorkDone(label), label).toBe(asksAboutWorkDone(label));
  });
});
