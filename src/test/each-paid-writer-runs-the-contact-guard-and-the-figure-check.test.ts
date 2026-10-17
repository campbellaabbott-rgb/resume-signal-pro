// @vitest-environment node
/**
 * EACH PAID WRITER RUNS THE CONTACT GUARD AND THE FIGURE CHECK (S11-018).
 *
 * Of the non-stream generators, the premium package ran only the contact
 * guard and the cover letter only the figure check: a package could ship
 * "$250,000" or "10,000 users" the candidate never claimed, and a letter a
 * stranger's phone and LinkedIn in its sign-off. The success page now shows
 * only what these two generators make (the streamed copies are gone from
 * it), so each runs both: an invented figure is never delivered (a letter
 * is refused, retryable; a package's résumé lines go back to the résumé's
 * own after one repair, critical path CP-018), an invented contact item is
 * removed.
 *
 * Run against the shipped handlers, with the model's answer faked.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const RESUME = [
  "Jane Doe | jane.doe@example.com | 555-010-0199",
  "Senior Data Engineer, Acme Corp, 2019 - Present",
  "- Built 40 Airflow pipelines moving 2TB a day",
  "- Cut warehouse spend by $120,000 a year",
].join("\n");
const POSTING = "Globex is hiring a data engineer to scale pipelines for 3 million customers.";

let premium: EdgeHandler;
let letter: EdgeHandler;
const db = new FakeDb({ used_stripe_sessions: ["session_id"] });
let resumeAnswer: Record<string, unknown>;
let letterAnswer: Record<string, unknown>;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness_key_0123456789abcdef", SUPABASE_ANON_KEY: "anon_harness", LOVABLE_API_KEY: "lovable_harness" };
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.__writerDb = { from: (t: string) => db.from(t), rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a) };
  g.fetch = async (url: string, init?: RequestInit) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ content?: string }> };
      const system = String(body.messages?.[0]?.content ?? "");
      // The premium package asks for the résumé and the letter in two calls.
      const answer = /cover letter/i.test(system) && !/resume writer|rewrite/i.test(system.slice(0, 200)) ? letterAnswer : resumeAnswer;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  const STUBS = {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2.39.3": "export const createClient = () => globalThis.__writerDb;",
  };
  premium = await loadEdgeHandler("generate-premium-package", STUBS);
  letter = await loadEdgeHandler("generate-cover-letter", STUBS);
}, 180_000);

beforeEach(() => {
  db.tables = {};
  db.rows("used_stripe_sessions").push({ session_id: "cs_live_writer", product_type: "premium_package" });
  db.rpcs = { check_rate_limit: () => ({ data: true, error: null }) };
});

const post = (h: EdgeHandler, body: Record<string, unknown>) => h(new Request("https://harness.supabase.co/functions/v1/x", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer service_harness_key_0123456789abcdef", "cf-connecting-ip": "203.0.113.7" },
  body: JSON.stringify(body),
}));

const resume = (rewrittenResume: string) => ({ rewrittenResume, professionalSummary: "", keyChanges: [], addedKeywords: [], atsScore: { before: 50, after: 80, improvement: "" }, highlights: [] });

describe("the premium package", () => {
  it("never delivers a rewrite's figure the candidate never claimed: the line goes back to the résumé's own", async () => {
    resumeAnswer = resume("Jane Doe\nSenior Data Engineer, Acme Corp\n- Built 40 Airflow pipelines serving 10,000 users\n- Cut warehouse spend by $250,000 a year");
    letterAnswer = { coverLetter: "Dear Globex team, I built 40 Airflow pipelines.", openingLine: "", keySkillsHighlighted: [], suggestedSubjectLine: "" };
    const res = await post(premium, { resumeText: RESUME, jobDescription: POSTING, jobTitle: "Data Engineer", jobCompany: "Globex", sessionId: "cs_live_writer" });
    const body = await res.json() as { data?: { resume?: { rewrittenResume?: string } } };
    const text = body.data?.resume?.rewrittenResume ?? "";
    expect(res.status).toBe(200);
    expect(text, "an invented figure was delivered in a paid package").not.toMatch(/250,000|10,000/);
    expect(text).toContain("$120,000");
  });

  it("refuses a letter that adds a figure the candidate never claimed", async () => {
    resumeAnswer = resume("Jane Doe\nSenior Data Engineer, Acme Corp\n- Built 40 Airflow pipelines moving 2TB a day");
    letterAnswer = { coverLetter: "Dear Globex team, I built 40 Airflow pipelines serving 10,000 users.", openingLine: "", keySkillsHighlighted: [], suggestedSubjectLine: "" };
    const res = await post(premium, { resumeText: RESUME, jobDescription: POSTING, jobTitle: "Data Engineer", jobCompany: "Globex", sessionId: "cs_live_writer" });
    const body = await res.json() as { error?: string; groundingIssues?: string[]; data?: unknown };
    expect(res.status, "an invented figure was delivered in a paid package").toBe(422);
    expect(body.data).toBeUndefined();
    expect(body.groundingIssues?.join(" ")).toMatch(/10,000/);
  });

  it("delivers a rewrite whose figures are the candidate's own, and a letter citing the posting's", async () => {
    resumeAnswer = resume("Jane Doe\nSenior Data Engineer, Acme Corp\n- Built 40 Airflow pipelines moving 2TB a day\n- Cut warehouse spend by $120,000 a year");
    letterAnswer = { coverLetter: "Dear Globex team, scaling pipelines for your 3 million customers is work I know: I cut spend by $120,000.", openingLine: "", keySkillsHighlighted: [], suggestedSubjectLine: "" };
    const res = await post(premium, { resumeText: RESUME, jobDescription: POSTING, jobTitle: "Data Engineer", jobCompany: "Globex", sessionId: "cs_live_writer" });
    expect(res.status).toBe(200);
  });
});

describe("the cover letter", () => {
  it("removes a phone and a LinkedIn the résumé does not have, and keeps the candidate's own", async () => {
    letterAnswer = {
      coverLetter: "Dear Globex team,\n\nI built 40 Airflow pipelines.\n\nJane Doe | jane.doe@example.com | (512) 555-0142 | linkedin.com/in/janedoe-x | 555-010-0199",
      openingLine: "", keySkillsHighlighted: [], personalizedElements: [], suggestedSubjectLine: "", alternateOpenings: [],
    };
    resumeAnswer = letterAnswer;
    const res = await post(letter, { resumeText: RESUME, jobDescription: POSTING, jobTitle: "Data Engineer", jobCompany: "Globex", tone: "professional", sessionId: "cs_live_writer" });
    const body = await res.json() as { data?: { coverLetter?: string } };
    expect(res.status).toBe(200);
    expect(body.data?.coverLetter, "an invented phone was delivered").not.toContain("555-0142");
    expect(body.data?.coverLetter, "a stranger's LinkedIn was delivered").not.toContain("linkedin.com/in/janedoe-x");
    expect(body.data?.coverLetter).toContain("555-010-0199");
    expect(body.data?.coverLetter).toContain("jane.doe@example.com");
  });
});
