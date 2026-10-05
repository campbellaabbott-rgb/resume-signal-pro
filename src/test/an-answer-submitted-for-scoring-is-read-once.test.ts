// @vitest-environment node
/**
 * AN ANSWER SUBMITTED FOR SCORING IS READ ONCE.
 *
 * WHAT WAS WRONG (defect sweep 1.24). generate-interview-coach parsed the
 * request body, then for mode "evaluate" handed the same Request to
 * handleEvaluate, which called req.json() a second time. A body can be read
 * once: the second read threw "Body already consumed", the outer catch made it
 * a 500, and every answer a candidate typed into the Interview Coach and
 * submitted for scoring failed -- from the day the function shipped. The paid
 * interview_coach product sold questions whose answers could never be scored.
 *
 * WHAT THIS HOLDS, against the shipped handler with its network faked:
 *   - the exact body InterviewCoach.tsx sends for evaluation returns 200 with
 *     the model's evaluation, and the model was given the question and the
 *     answer;
 *   - the question and answer are bounded (an over-length one is a 400 before
 *     the count and the model) and required;
 *   - generate mode still works.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/@supabase/supabase-js@2.39.3":
    "export function createClient() { const db = globalThis.__coachDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t) }; }",
};

const RESUME = "Jane Doe -- Senior software engineer. Led the payments migration that cut checkout errors by 40%. ".repeat(3);
const EVALUATION = { score: 7, grade: "B+", strengths: ["Specific"], improvements: ["Add the result"], revisedAnswer: "...", recruiterReaction: "Solid" };
const QUESTIONS = { interviewProfile: { targetRole: "Engineer" }, questions: [{ id: 1, category: "Behavioral", question: "Tell me about a hard migration." }] };

let handler: EdgeHandler;
let db: FakeDb;
let ai: Array<{ messages: Array<{ role: string; content: string }>; max_tokens?: number }>;
let counted: number;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", LOVABLE_API_KEY: "lk" };
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.fetch = async (url: string, init?: { body?: string }) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      ai.push(body);
      const evaluating = String(body.messages?.[0]?.content ?? "").includes("evaluating a candidate's answer");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(evaluating ? EVALUATION : QUESTIONS) } }] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  handler = await loadEdgeHandler("generate-interview-coach", STUBS);
}, 120_000);

beforeEach(() => {
  db = new FakeDb();
  ai = [];
  counted = 0;
  db.rpcs.check_rate_limit = () => { counted++; return { data: true, error: null }; };
  (globalThis as Record<string, unknown>).__coachDb = db;
});

const post = async (body: unknown) => {
  const res = await handler(new Request("https://h.supabase.co/functions/v1/generate-interview-coach", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};

describe("Interview Coach answer evaluation", () => {
  it("the body InterviewCoach.tsx sends is scored, not a 500", async () => {
    const r = await post({ resumeText: RESUME, question: "Tell me about a hard migration.", answer: "I led the payments migration and we cut errors by 40%.", category: "Behavioral", mode: "evaluate", language: "en" });
    expect(r.status, `evaluate answered ${r.status}: ${JSON.stringify(r.body).slice(0, 160)}`).toBe(200);
    expect(r.body).toMatchObject({ success: true, data: EVALUATION });
    const user = ai[0].messages.find((m) => m.role === "user")!.content;
    expect(user).toContain("Tell me about a hard migration.");
    expect(user).toContain("we cut errors by 40%");
    expect(ai[0].max_tokens).toBe(1500);
    expect(counted).toBe(2);
  });

  it("a question and an answer are both required", async () => {
    expect((await post({ resumeText: RESUME, question: "Q?", mode: "evaluate" })).status).toBe(400);
    expect((await post({ resumeText: RESUME, answer: "A.", mode: "evaluate" })).status).toBe(400);
    expect(ai).toEqual([]);
  });

  it("an over-length answer or question is refused before the count and the model", async () => {
    expect((await post({ resumeText: RESUME, question: "Q?", answer: "a".repeat(6001), mode: "evaluate" })).status).toBe(400);
    expect((await post({ resumeText: RESUME, question: "q".repeat(1001), answer: "A.", mode: "evaluate" })).status).toBe(400);
    expect((await post({ resumeText: "r".repeat(50_001), question: "Q?", answer: "A.", mode: "evaluate" })).status).toBe(400);
    expect(counted).toBe(0);
    expect(ai).toEqual([]);
  });

  it("generate mode still returns questions", async () => {
    const r = await post({ resumeText: RESUME, targetRole: "Engineer", mode: "generate" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, data: QUESTIONS });
  });

  it("a target role cannot carry an essay into the prompt", async () => {
    await post({ resumeText: RESUME, targetRole: `Engineer\n${"x".repeat(10_000)}`, mode: "generate" });
    const user = ai[0].messages.find((m) => m.role === "user")!.content;
    expect(user).not.toMatch(/x{121}/);
  });
});
