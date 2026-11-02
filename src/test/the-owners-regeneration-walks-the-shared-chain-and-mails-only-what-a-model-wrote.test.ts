// @vitest-environment node
/**
 * THE OWNER'S REGENERATION WALKS THE SHARED CHAIN AND MAILS ONLY WHAT A MODEL
 * WROTE (FA-2).
 *
 * admin-regenerate-delivery (the owner's tool that remakes a customer's
 * Premium Package and mails it to them) kept its own model loop after the
 * paid writers moved onto the shared chain: gpt-5 only, 60 s three times and
 * no deadline. A résumé reply with no JSON in it shipped as the delivery with
 * an invented "ATS 60 -> 90", the mail printed 60% -> 92% for a reply that
 * named no score, and the customer mail promised "GPT-5" whichever model
 * answered.
 *
 * Held here on the shipped handler, with the gateway, the database and
 * Resend faked and the background task awaited:
 *   - the models are asked in the premium package's order, with the bodies
 *     this function always sent, and a reply with no résumé in it (prose, cut
 *     off at its cap) asks the next model, whose résumé is the delivery;
 *   - when no model writes a résumé, nothing is saved and nothing is mailed;
 *   - a letter that comes back as prose is still the letter;
 *   - no score block without the reply's own scores, and no model's name in
 *     the customer's mail or the saved product name.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const ADMIN = "admin-key-for-the-harness-0123456789abcdef";
type Sent = { subject: string; html: string; to: string[] };
type Asked = { model: string; body: Record<string, unknown> };

const sent: Sent[] = [];
const asked: Asked[] = [];
const background: Promise<unknown>[] = [];
let db: FakeDb;
let answer: (a: Asked, n: number) => Response = () => new Response("{}", { status: 500 });
let handler: EdgeHandler;

const chat = (content: string, finish = "stop") =>
  new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content } }] }), { status: 200 });
const isLetter = (a: Asked) => (a.body.max_completion_tokens as number) === 4000;

const RESUME_JSON = JSON.stringify({
  rewrittenResume: "JANE DOE\nSenior Engineer, Acme Corp\n- Led a team of five on payments in TypeScript and Postgres.",
  professionalSummary: "Engineer with ten years of payments work.",
  keyChanges: [{ section: "Experience", before: "a", after: "b", reason: "Stronger verbs" }],
  addedKeywords: ["Postgres", "TypeScript"],
  highlights: [],
});
const LETTER_JSON = JSON.stringify({ coverLetter: "Dear Hiring Manager,\n\nI led payments work at Acme.\n\nJane", openingLine: "x", keySkillsHighlighted: [], personalizedElements: [], suggestedSubjectLine: "Senior Engineer application" });

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-harness", RESEND_API_KEY: "re_harness",
    LOVABLE_API_KEY: "lovable-harness", ADMIN_API_KEY: ADMIN,
  };
  g.__sent = sent;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { background.push(p); } };
  handler = await loadEdgeHandler("admin-regenerate-delivery", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__sent.push(m); return { data: { id: 'em_1' }, error: null }; } }; } }",
  });
  const realFetch = g.fetch as typeof fetch;
  g.fetch = async (url: string, init?: { body?: string }) => {
    if (!String(url).includes("ai.gateway.lovable.dev")) return realFetch(url, init as RequestInit);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const a = { model: String(body.model), body };
    asked.push(a);
    return answer(a, asked.length - 1);
  };
}, 60_000);

beforeEach(() => {
  db = new FakeDb();
  (globalThis as Record<string, unknown>).__fakeSupabase = db;
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
});
afterEach(() => {
  sent.length = 0;
  asked.length = 0;
  background.length = 0;
  vi.restoreAllMocks();
});

async function regenerate(): Promise<Record<string, unknown>> {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/admin-regenerate-delivery", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-key": ADMIN },
    body: JSON.stringify({ email: "buyer@example.com", resumeText: "Jane Doe, engineer at Acme. ".repeat(10), jobTitle: "Senior Engineer", jobCompany: "Initech" }),
  }));
  expect(res.status).toBe(200);
  const json = await res.json() as Record<string, unknown>;
  await Promise.all(background);
  return json;
}
const saved = () => db.rows("purchased_content");

describe("FA-2: the regeneration walks the shared chain", () => {
  it("a résumé reply with no JSON asks the next model in the premium package's order, and that model's résumé is delivered", async () => {
    answer = (a) => {
      if (isLetter(a)) return chat(LETTER_JSON);
      return a.model === "openai/gpt-5" ? chat("Here is your improved resume: JANE DOE, engineer.") : chat(RESUME_JSON);
    };
    await regenerate();
    const resumeAsks = asked.filter((a) => !isLetter(a));
    expect(resumeAsks.map((a) => a.model)).toEqual(["openai/gpt-5", "google/gemini-2.5-pro"]);
    expect(resumeAsks[0].body.max_completion_tokens).toBe(12000);
    expect(asked.filter(isLetter)[0].body.max_completion_tokens).toBe(4000);
    expect(saved()).toHaveLength(1);
    const content = saved()[0].generated_content as { resume: { rewrittenResume: string; atsScore?: unknown } };
    expect(content.resume.rewrittenResume).toContain("Led a team of five");
    expect(content.resume.atsScore, "an invented score was saved").toBeUndefined();
    expect(sent).toHaveLength(1);
  });

  it("a résumé cut off at its token cap is not the delivery: the next model is asked", async () => {
    answer = (a) => {
      if (isLetter(a)) return chat(LETTER_JSON);
      return a.model === "openai/gpt-5" ? chat(RESUME_JSON.slice(0, 60), "length") : chat(RESUME_JSON);
    };
    await regenerate();
    expect(asked.filter((a) => !isLetter(a)).map((a) => a.model)).toEqual(["openai/gpt-5", "google/gemini-2.5-pro"]);
    expect((saved()[0].generated_content as { resume: { rewrittenResume: string } }).resume.rewrittenResume).toContain("Led a team of five");
  });

  it("when no model writes a résumé, nothing is saved and nothing is mailed", async () => {
    answer = (a) => (isLetter(a) ? chat(LETTER_JSON) : chat("I'm sorry, I can't help with that."));
    await regenerate();
    expect(asked.filter((a) => !isLetter(a)).map((a) => a.model)).toEqual(["openai/gpt-5", "google/gemini-2.5-pro", "openai/gpt-5-mini"]);
    expect(saved()).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("a letter that comes back as prose is still the letter", async () => {
    answer = (a) => (isLetter(a) ? chat("Dear Hiring Manager,\n\nI led payments work at Acme.\n\nJane") : chat(RESUME_JSON));
    await regenerate();
    expect(asked.filter(isLetter)).toHaveLength(1);
    expect((saved()[0].generated_content as { coverLetter: { coverLetter: string } }).coverLetter.coverLetter).toContain("I led payments work");
  });
});

describe("FA-2: the customer's mail says only what the reply wrote", () => {
  it("no score block for a reply that named no score, and no model's name anywhere the customer reads", async () => {
    answer = (a) => (isLetter(a) ? chat(LETTER_JSON) : chat(RESUME_JSON));
    const json = await regenerate();
    expect(sent[0].html).not.toContain("ATS Score Improvement");
    expect(sent[0].html).not.toMatch(/60%|92%/);
    for (const text of [sent[0].subject, sent[0].html, String(saved()[0].product_name), String(json.message)]) {
      expect(text).not.toMatch(/GPT|Gemini|OpenAI/i);
    }
  });

  it("the reply's own scores are shown", async () => {
    answer = (a) => (isLetter(a) ? chat(LETTER_JSON) : chat(JSON.stringify({ ...JSON.parse(RESUME_JSON), atsScore: { before: 48, after: 81, improvement: "x" } })));
    await regenerate();
    expect(sent[0].html).toContain("ATS Score Improvement");
    expect(sent[0].html).toMatch(/>48%</);
    expect(sent[0].html).toMatch(/>81%</);
  });

  it("the preflight names this build", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/admin-regenerate-delivery", { method: "OPTIONS" }));
    expect(res.headers.get("x-fn-build")).toBe("admin-regenerate-delivery.2026-11-03.1");
  });
});
