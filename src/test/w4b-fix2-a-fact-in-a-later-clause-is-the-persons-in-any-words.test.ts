/**
 * A FACT IN A LATER CLAUSE IS THE PERSON'S, IN ANY WORDS (wave 4 round 2
 * recheck; S12-081 widened again).
 *
 * WHAT WAS WRONG. The round 1 fix (67cecf0e) pinned the review's sixteen
 * spellings. Asked a little differently, a start date, notice, past pay or a
 * referee inside a work-done or motivation question still came back
 * draft_from_your_cv, so apply_myself and /v1 told the person's AI to draft
 * what ANSWERED_BY_MEANS says always goes to the person: "... and when you are
 * able to start", "... and how much notice you must give", "... and what you
 * earned in your last job", "... and who we can contact to confirm it", "Why
 * do you want this role and what's your earliest availability?". topicOf
 * labelled most of them, but no clause was read against it.
 *
 * THE RULE NOW. TOPICS lives beside the patterns, shared by both runtimes. In
 * a work-done prompt a later sentence naming any topic is its own question,
 * and a later clause naming one follows the clause rule (the work's object
 * only when the work took one and the clause neither addresses the person
 * nor names their state). In a motivation question every clause after the
 * opening's own is read against topicOf. PERSON_ASKS reads able or free to
 * start, the earliest date or availability, notice, what the person made or
 * earned and their earnings, and who to contact to confirm.
 */
import { describe, expect, it } from "vitest";
import { asksAboutWorkDone, PERSON_ASKS, PROTECTED_FACTUAL, TOPICS, topicOf } from "../../supabase/functions/_shared/application-questions";
import { hintIsPlain, whoAnswers } from "../../supabase/functions/_shared/self-apply";
import * as workerProtected from "../../worker/src/questions/protected.js";

const RECHECK = [
  "Describe your experience in sales and when you are able to start",
  "Describe your experience in sales and the earliest you could join",
  "Describe your experience in sales and the date you can join us",
  "Describe your experience in sales and how much notice you must give",
  "Describe your experience in sales and how much you made last year",
  "Describe your experience in sales and what you earned in your last job",
  "Describe your experience in sales and your earnings in your last role",
  "Describe your sales experience and who we can contact to confirm it",
  "Why do you want this role and what's your earliest availability?",
  "Why do you want to join us, and what you earn today",
];

const OURS = [
  "Describe your experience in sales and when you would be free to begin",
  "Tell us about your experience managing teams, and how many weeks' notice you need",
  "Describe your experience in retail and your current hourly rate",
  "Describe your experience with Salesforce. When are you able to start?",
  "Describe your experience in sales, plus whom we may call to verify it",
  "Tell us about your experience in logistics and whether you can travel",
  "Describe your experience with payroll and your income last year",
  "Why are you interested in this position, and when could you join?",
  "What excites you about this role, and how much notice would you have to give?",
  "Why this company, and what's your desired pay?",
  "Why do you want this job, and which shifts can you work?",
];

const STILL_DRAFTED = [
  "Describe your experience drafting restrictive covenants and non-solicitation agreements",
  "Tell us about your experience processing payroll and wages",
  "Describe your experience in sales, including key accounts and pipeline",
  "Describe your experience in sales",
  "Tell us about your experience in fixed income and equities trading",
  "Describe your experience working with clients across different time zones",
  "Why do you want to work here?",
  "Why are you interested in this role, and what excites you about our mission?",
];

const textarea = (label: string, hint?: string) => whoAnswers({ label, required: true, type: "textarea", ...(hint ? { hint } : {}) }, 1);

describe("a fact asked in a later clause or sentence is answered by the person", () => {
  it.each([...RECHECK, ...OURS])("%s", (label) => {
    expect(textarea(label).answeredBy).toBe("you");
  });

  it.each(STILL_DRAFTED)("control, still drafted: %s", (label) => {
    expect(textarea(label).answeredBy).toBe("draft_from_your_cv");
  });

  it("a hint asking what the person made is not plain", () => {
    expect(hintIsPlain("Tell us what you made last year.")).toBe(false);
    expect(hintIsPlain("Include how much notice you need.")).toBe(false);
    expect(hintIsPlain("Mention your earliest start date.")).toBe(false);
    expect(hintIsPlain("A few sentences is fine."), "control").toBe(true);
    expect(hintIsPlain("Include the fixed income products you traded."), "control: income as the work's object").toBe(true);
  });

  it("topicOf names what each later clause is about", () => {
    expect(topicOf(" the earliest you could join")).toBe("start_date");
    expect(topicOf(" how much notice you must give")).toBe("start_date");
    expect(topicOf(" your earnings in your last role")).toBe("salary");
    expect(topicOf(" who we can contact to confirm it")).toBe("references");
    expect(topicOf(" what's your earliest availability?")).toBe("start_date");
    expect(PROTECTED_FACTUAL.test("What's your earliest availability?")).toBe(true);
  });
});

describe("the worker reads every one of them the same way", () => {
  it("the same patterns and topics, and the same verdict on every label", () => {
    expect(workerProtected.PERSON_ASKS.source).toBe(PERSON_ASKS.source);
    expect(workerProtected.PROTECTED_FACTUAL.source).toBe(PROTECTED_FACTUAL.source);
    expect(workerProtected.TOPICS.map(([t, re]) => [t, re.source, re.flags])).toEqual(TOPICS.map(([t, re]) => [t, re.source, re.flags]));
    for (const label of [...RECHECK, ...OURS, ...STILL_DRAFTED]) {
      expect(workerProtected.asksAboutWorkDone(label), label).toBe(asksAboutWorkDone(label));
      expect(workerProtected.topicOf(label), label).toBe(topicOf(label));
    }
  });
});
