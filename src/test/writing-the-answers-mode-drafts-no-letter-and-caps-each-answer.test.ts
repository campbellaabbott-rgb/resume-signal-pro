// @vitest-environment node
/**
 * THE SCREENING-ANSWERS MODE WRITES NO LETTER, AND EACH ANSWER IS A SCREENING
 * ANSWER'S LENGTH (S14X-090).
 *
 * A form question asking for a motivation letter, a personal statement or an
 * essay was drafted like any other question, under a flat 4,000-token cap per
 * chunk, so the answers path wrote whole letters outside the writing tools'
 * allowance. Now such a question is handed back for the person (class
 * "writing") before any model call, each chunk's cap is sized from its
 * questions, and every returned answer is at most 1,200 characters.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ANSWER_MAX_CHARS, asksForWriting } from "../../supabase/functions/generate-application-answers/answers";
import { WritingWorld, chatReply, loadWriter, post } from "./helpers/writing-harness";
import { KIT_POSTING, KIT_RESUME } from "./helpers/kit-fixtures";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 240_000 });

let answersFn: EdgeHandler;
let world: WritingWorld;
beforeAll(async () => {
  new WritingWorld().install();
  answersFn = await loadWriter("generate-application-answers");
}, 240_000);
beforeEach(() => {
  world = new WritingWorld();
  world.install();
  for (const level of ["log", "info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const LETTER = "Write us a short motivation letter explaining why you want this role";
const WHY = "Why do you want to work here?";
const LONG = "I led the payments team of five engineers at Initech and cut checkout latency by 40% with a caching layer. ".repeat(48);

describe("a form that asks for a letter and a screening answer", () => {
  it("drafts only the screening answer; the letter comes back for the person", async () => {
    world.reply = () => chatReply(JSON.stringify({ answers: [{ question: WHY, answer: "I led the payments team at Initech.", supported: true, note: "" }] }));
    const r = await post(answersFn, "generate-application-answers", {
      resumeText: KIT_RESUME, jobTitle: "Senior Engineer", jobCompany: "Hooli", jobDescription: KIT_POSTING,
      questions: [{ label: LETTER, type: "textarea" }, { label: WHY, type: "textarea" }],
    }, "service");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const prompt = world.prompts();
    expect(prompt).toContain(WHY);
    expect(prompt).not.toContain(LETTER);
    expect(r.body.skipped).toEqual(expect.arrayContaining([{ question: LETTER, class: "writing" }]));
    expect((r.body.answers as Array<{ question: string }>).map((a) => a.question)).toEqual([WHY]);
  });

  it("a 5,000-character answer comes back at most 1,200, cut at a sentence, under a cap sized for one question", async () => {
    expect(LONG.length).toBeGreaterThan(5_000);
    world.reply = () => chatReply(JSON.stringify({ answers: [{ question: WHY, answer: LONG, supported: true, note: "" }] }));
    const r = await post(answersFn, "generate-application-answers", {
      resumeText: KIT_RESUME, jobTitle: "Senior Engineer", jobCompany: "Hooli", jobDescription: KIT_POSTING,
      questions: [{ label: WHY, type: "textarea" }],
    }, "service");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const answer = String((r.body.answers as Array<{ answer: string }>)[0].answer);
    expect(answer.length).toBeLessThanOrEqual(ANSWER_MAX_CHARS);
    expect(answer.endsWith(".")).toBe(true);
    const cap = Number(world.ai[0].body.max_tokens ?? world.ai[0].body.max_completion_tokens);
    expect(cap).toBeLessThan(4_000);
  });
});

describe("what counts as asking for a whole document", () => {
  it.each([
    LETTER, "Please attach or paste your personal statement", "Write a 500-word essay on our mission",
    "Please rewrite your CV for this role", "Lettre de motivation", "Anschreiben (optional)", "Statement of purpose",
  ])("%s", (label) => expect(asksForWriting(label)).toBe(true));

  it.each([
    WHY, "Describe a time you led a team through a hard deadline.", "What interests you about this role?",
    "Have you written technical documentation before?", "Tell us about a project you are proud of.",
  ])("not: %s", (label) => expect(asksForWriting(label)).toBe(false));
});
