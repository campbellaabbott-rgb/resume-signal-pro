// @vitest-environment node
/**
 * A FAILED CHUNK OF SCREENING ANSWERS IS RETRYABLE, NOT LEFT FOR THE PERSON
 * (S14X-119).
 *
 * A long form is drafted eight questions at a time. When one chunk's model
 * call failed and the others answered, its questions were put in undrafted,
 * which the panel words as questions past the drafting cap, left for the
 * person to answer themselves. They are now named back in their own field,
 * retryable, and undrafted stays the cap's overflow only.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { selectDraftable } from "../../supabase/functions/_shared/application-questions";
import { WritingWorld, chatReply, loadWriter, post } from "./helpers/writing-harness";
import { KIT_POSTING, KIT_RESUME } from "./helpers/kit-fixtures";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

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

const TOPICS = ["payments", "checkout", "billing", "latency", "caching", "Postgres", "TypeScript", "mentoring", "incident response", "code review", "on-call rotations", "roadmaps"];
const QUESTIONS = TOPICS.map((topic) => ({ label: `Describe a time you improved ${topic} for your team.`, type: "textarea" }));
const SECOND_CHUNK = QUESTIONS.slice(8).map((q) => q.label);

describe("twelve questions whose second chunk fails at every model", () => {
  it("returns the first chunk's answers and names the second chunk's questions as retryable, none as undrafted", async () => {
    expect(selectDraftable(QUESTIONS).length).toBe(12);
    world.reply = (call) => {
      const asked = JSON.stringify(call.body.messages);
      if (SECOND_CHUNK.some((label) => asked.includes(label))) return new Response(JSON.stringify({ error: "upstream" }), { status: 500 });
      const labels = QUESTIONS.map((q) => q.label).filter((label) => asked.includes(label));
      return chatReply(JSON.stringify({ answers: labels.map((question) => ({ question, answer: "I led the payments team at Initech.", supported: true, note: "" })) }));
    };
    const r = await post(answersFn, "generate-application-answers", {
      resumeText: KIT_RESUME, jobTitle: "Senior Engineer", jobCompany: "Hooli", jobDescription: KIT_POSTING, questions: QUESTIONS,
    }, "service");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((r.body.answers as unknown[]).length).toBe(8);
    expect(r.body.retryable).toEqual(SECOND_CHUNK);
    expect(r.body.undrafted).toBeUndefined();
  });
});
