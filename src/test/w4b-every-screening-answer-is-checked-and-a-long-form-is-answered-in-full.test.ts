// @vitest-environment node
/**
 * EVERY SCREENING ANSWER IS CHECKED, AND A LONG FORM IS ANSWERED IN FULL.
 *
 * S12-062: the drafter trusted the model's supported:true under a badge that
 * said "nothing invented"; a replayed draft gave the candidate a PhD and a
 * "$1.2M" figure marked supported. Every answer is now read against the
 * résumé, and one naming a credential, degree, figure, employer or title the
 * résumé does not state is marked for the person with a note.
 *
 * S12-148: up to 25 questions were drafted in one 3,500-token call and at most
 * 12 returned, so a 15-question form came back short. One cap (ANSWER_CAP),
 * drafted ANSWER_CHUNK at a time, every drafted answer returned, and any
 * question past the cap named back.
 *
 * S12-026 / S12-147: answers follow the posting's language and the posting is
 * fenced as data.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EdgeHandler } from "./helpers/edge-harness";
import { chatReply, loadWriter, post, WritingWorld } from "./helpers/writing-harness";
import { ANSWER_CAP, ANSWER_CHUNK, groundAnswers } from "../../supabase/functions/generate-application-answers/answers";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const RESUME = "Sam Park\nSoftware Engineer, Initech, 2019-2024: built billing services in Go and Postgres; cut invoice errors by 30%; mentored 3 engineers.\nBSc Computer Science, State University, 2019.";
const POSTING = "Senior Backend Engineer at Globex. You will own our billing platform, work in Go and Postgres, and partner with finance. We value mentoring and clear writing. PhD a plus. Our platform processes $1.2M a day.";

describe("groundAnswers", () => {
  it("demotes an answer that invents a PhD and a figure, and says what to fix", () => {
    const [a] = groundAnswers(RESUME, [{ question: "Why are you a fit?", answer: "With my PhD in distributed systems, I scaled billing to $1.2M a day at Initech.", supported: true, note: "" }], { posting: POSTING, company: "Globex" });
    expect(a.supported).toBe(false);
    expect(a.note).toMatch(/PhD/);
    expect(a.note).toMatch(/\$1\.2M/);
  });

  it("keeps an answer the résumé supports, even one without an \"I\"", () => {
    const answers = [
      { question: "Describe your billing work.", answer: "Built billing services in Go and Postgres at Initech and cut invoice errors by 30%.", supported: true, note: "" },
      { question: "Mentoring?", answer: "I mentored 3 engineers at Initech.", supported: true, note: "" },
    ];
    expect(groundAnswers(RESUME, answers, { posting: POSTING, company: "Globex" })).toEqual(answers);
  });

  it("an answer naming the posting's figure without an \"I\" is still the candidate's claim", () => {
    const [a] = groundAnswers(RESUME, [{ question: "Scale?", answer: "Scaled billing to $1.2M a day.", supported: true, note: "" }], { posting: POSTING });
    expect(a.supported).toBe(false);
  });
});

const QUESTIONS = Array.from({ length: 15 }, (_, i) => ({ label: `Describe a time you improved a billing process (part ${i + 1}).`, required: true, type: "textarea" }));

const handlers = new Map<string, EdgeHandler>();
let world: WritingWorld;
beforeAll(async () => {
  new WritingWorld().install();
  handlers.set("generate-application-answers", await loadWriter("generate-application-answers"));
}, 180_000);
beforeEach(() => {
  world = new WritingWorld();
  world.install();
});

/** A model that answers every numbered question in the user prompt it was sent. */
const answerEverything = (opts: { supported?: boolean; text?: string } = {}) => (call: { body: Record<string, unknown> }) => {
  const user = String((call.body.messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "");
  const asked = [...user.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]);
  return chatReply(JSON.stringify({
    answers: asked.map((question) => ({ question, answer: opts.text ?? "Built billing services in Go and Postgres at Initech.", supported: opts.supported ?? true, note: "" })),
  }));
};

describe("generate-application-answers, run as shipped", () => {
  const body = { resumeText: RESUME, jobTitle: "Senior Backend Engineer", jobCompany: "Globex", jobDescription: POSTING, questions: QUESTIONS };

  it("a 15-question form gets 15 answers, drafted in chunks", async () => {
    world.reply = answerEverything();
    const r = await post(handlers.get("generate-application-answers")!, "generate-application-answers", body, "anon");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((r.body.answers as unknown[]).length).toBe(15);
    expect(world.ai.length).toBe(Math.ceil(15 / ANSWER_CHUNK));
    for (const c of world.ai) expect(Number(c.body.max_tokens ?? c.body.max_completion_tokens)).toBeGreaterThanOrEqual(4000);
    expect(r.body.undrafted).toBeUndefined();
  });

  it("past the cap, the extra questions are named back, not dropped", async () => {
    world.reply = answerEverything();
    const many = Array.from({ length: ANSWER_CAP + 3 }, (_, i) => ({ label: `Tell us about project ${i + 1}.`, type: "textarea" }));
    const r = await post(handlers.get("generate-application-answers")!, "generate-application-answers", { ...body, questions: many }, "anon");
    expect((r.body.answers as unknown[]).length).toBe(ANSWER_CAP);
    expect(r.body.undrafted).toEqual([`Tell us about project ${ANSWER_CAP + 1}.`, `Tell us about project ${ANSWER_CAP + 2}.`, `Tell us about project ${ANSWER_CAP + 3}.`]);
  });

  it("an answer the model marks supported but which invents a PhD comes back marked for the person", async () => {
    world.reply = answerEverything({ text: "With my PhD, I built billing services in Go at Initech." });
    const r = await post(handlers.get("generate-application-answers")!, "generate-application-answers", { ...body, questions: QUESTIONS.slice(0, 2) }, "anon");
    const answers = r.body.answers as Array<{ supported: boolean; note: string }>;
    expect(answers.every((a) => a.supported === false)).toBe(true);
    expect(answers[0].note).toMatch(/PhD/);
  });

  it("a reply that is not the JSON asked for is a 502, never 200 with no answers", async () => {
    world.reply = () => chatReply("Sorry, I can't help with that.");
    const r = await post(handlers.get("generate-application-answers")!, "generate-application-answers", { ...body, questions: QUESTIONS.slice(0, 2) }, "anon");
    expect(r.status).toBe(502);
    expect(r.body.code).toBe("draft_failed");
  });

  it("the model's echo of a question comes back as the label asked, verbatim", async () => {
    world.reply = () => chatReply(JSON.stringify({ answers: [{ question: "1. describe a time you improved a billing process (PART 1).", answer: "Built billing services in Go at Initech.", supported: true, note: "" }] }));
    const r = await post(handlers.get("generate-application-answers")!, "generate-application-answers", { ...body, questions: QUESTIONS.slice(0, 1) }, "anon");
    expect((r.body.answers as Array<{ question: string }>).map((a) => a.question)).toEqual([QUESTIONS[0].label]);
  });

  it("one chunk failing while another answers names the failed chunk's questions back", async () => {
    let n = 0;
    const good = answerEverything();
    world.reply = (call) => (n++ === 0 ? good(call) : new Response("{}", { status: 500 }));
    const r = await post(handlers.get("generate-application-answers")!, "generate-application-answers", body, "anon");
    expect(r.status).toBe(200);
    expect((r.body.answers as unknown[]).length).toBe(ANSWER_CHUNK);
    expect((r.body.undrafted as string[]).length).toBe(15 - ANSWER_CHUNK);
    // The failed chunk walked the whole model chain, retries and their
    // one-second pauses included (_shared/ai-fallback.ts), hence the budget.
  }, 15_000);

  it("a busy model is answered with a code and a Retry-After the page can word", async () => {
    world.reply = () => new Response(JSON.stringify({ error: "busy" }), { status: 429 });
    const r = await post(handlers.get("generate-application-answers")!, "generate-application-answers", { ...body, questions: QUESTIONS.slice(0, 2) }, "anon");
    expect(r.status).toBe(429);
    expect(r.body.code).toBe("model_busy");
    expect(r.headers.get("retry-after")).toBe("60");
  });

  it("answers follow a German posting's language, notes the reader's, and the posting is fenced", async () => {
    world.reply = answerEverything();
    const de = "Wir suchen eine erfahrene Entwicklerin für unser Team. Deine Aufgaben: Du betreust unsere Abrechnung und arbeitest eng mit dem Finanzteam zusammen. Wir bieten dir eine unbefristete Stelle. Das bringst du mit: Erfahrung mit Go und Postgres.";
    await post(handlers.get("generate-application-answers")!, "generate-application-answers", { ...body, jobDescription: de, questions: [{ label: "Warum möchten Sie bei uns arbeiten?" }], language: "fr" }, "anon");
    const prompt = world.prompts();
    expect(prompt).toContain("written in German");
    expect(prompt).toMatch(/Write each "note" in French/);
    expect(prompt).toContain("<job_posting>");
  });
});
