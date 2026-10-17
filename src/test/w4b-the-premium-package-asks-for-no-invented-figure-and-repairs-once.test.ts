// @vitest-environment node
/**
 * THE PREMIUM PACKAGE ASKS FOR NO INVENTED FIGURE, AND REPAIRS A DRAFT ONCE.
 *
 * Critical path CP-018 (2026-10-12). The résumé prompt told the model to
 * "QUANTIFY achievements where reasonable (infer if not present)", the figure
 * check then refused every draft that obeyed with a 422 and no repair, and
 * the 422 counted against the purchase's day: a past buyer's package was
 * retried until its delivery row ran out of tries, and the owner read "ran
 * out of retries". The Premium Package is no longer sold (owner decision
 * 2026-10-12); a buyer who already paid is still delivered for 90 days, and
 * this is what that buyer receives.
 *
 * Held by RUNNING the shipped handler with the model faked:
 *   - the prompt the model receives states the cover letter's rule (never a
 *     figure the résumé does not state) and no longer asks it to infer one;
 *   - a draft that adds a figure is sent back ONCE with the issue listed, and
 *     the repaired draft is delivered;
 *   - a résumé draft that still adds a figure after its repair has each such
 *     line put back to the résumé's own (the plan's last resort, as corrected
 *     2026-10-12) and is delivered, and the model is not asked a third time;
 *   - a letter that still adds a figure after its repair is refused;
 *   - a skills line may name the posting's own number ("ISO 27001"), and
 *     "$120K" is the résumé's "$120,000", so neither needs a repair.
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
const POSTING = "Globex is hiring a data engineer to scale pipelines for 3 million customers. ISO 27001 experience is a plus.";
const INVENTED = "Jane Doe\nSenior Data Engineer, Acme Corp\n- Built 40 Airflow pipelines serving 10,000 users\n- Cut warehouse spend by $250,000 a year";
const HONEST = "Jane Doe\nSenior Data Engineer, Acme Corp\n- Built 40 Airflow pipelines moving 2TB a day\n- Cut warehouse spend by $120,000 a year";

type Msg = { role: string; content: string };
let premium: EdgeHandler;
const db = new FakeDb({ used_stripe_sessions: ["session_id"] });
/** Every résumé request the gateway received, in order. */
let resumeRequests: Msg[][];
/** What the résumé model answers, by call number (first draft, repair). */
let resumeAnswers: string[];
/** Every letter request the gateway received, and what the letter model answers, by call number. */
let letterRequests: Msg[][];
let letterAnswers: string[];

const resume = (rewrittenResume: string) => ({ rewrittenResume, professionalSummary: "", keyChanges: [], addedKeywords: [], atsScore: { before: 50, after: 80, improvement: "" }, highlights: [] });
const letter = (coverLetter: string) => ({ coverLetter, openingLine: "", keySkillsHighlighted: [], suggestedSubjectLine: "" });
const HONEST_LETTER = "Dear Globex team, I built 40 Airflow pipelines.";

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness_key_0123456789abcdef", SUPABASE_ANON_KEY: "anon_harness", LOVABLE_API_KEY: "lovable_harness" };
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.__writerDb = { from: (t: string) => db.from(t), rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a) };
  g.fetch = async (url: string, init?: RequestInit) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Msg[] };
      const messages = body.messages ?? [];
      const system = String(messages[0]?.content ?? "");
      const isLetter = /cover letter/i.test(system) && !/resume writer|rewrite/i.test(system.slice(0, 200));
      if (isLetter) {
        letterRequests.push(messages);
        const answer = letterAnswers[Math.min(letterRequests.length - 1, letterAnswers.length - 1)];
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(letter(answer)) } }] }), { status: 200 });
      }
      resumeRequests.push(messages);
      const answer = resumeAnswers[Math.min(resumeRequests.length - 1, resumeAnswers.length - 1)];
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(resume(answer)) } }] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  premium = await loadEdgeHandler("generate-premium-package", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2.39.3": "export const createClient = () => globalThis.__writerDb;",
  });
}, 180_000);

beforeEach(() => {
  db.tables = {};
  db.rows("used_stripe_sessions").push({ session_id: "cs_live_writer", product_type: "premium_package" });
  db.rpcs = { check_rate_limit: () => ({ data: true, error: null }) };
  resumeRequests = [];
  resumeAnswers = [HONEST];
  letterRequests = [];
  letterAnswers = [HONEST_LETTER];
});

const post = () => premium(new Request("https://harness.supabase.co/functions/v1/generate-premium-package", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer service_harness_key_0123456789abcdef", "cf-connecting-ip": "203.0.113.7" },
  body: JSON.stringify({ resumeText: RESUME, jobDescription: POSTING, jobTitle: "Data Engineer", jobCompany: "Globex", sessionId: "cs_live_writer" }),
}));

describe("the résumé prompt the model receives", () => {
  it("states the cover letter's rule and no longer asks the model to infer a figure", async () => {
    await post();
    const system = resumeRequests[0][0].content;
    expect(system).not.toMatch(/infer if not present/i);
    expect(system).toMatch(/NEVER add a number, percentage, amount, count or date the resume does not state/);
  });
});

describe("a rewrite that adds a figure the candidate never claimed", () => {
  it("is sent back once with the figure named, and the repaired rewrite is delivered", async () => {
    resumeAnswers = [INVENTED, HONEST];
    const res = await post();
    const body = await res.json() as { data?: { resume?: { rewrittenResume?: string } }; groundingIssues?: string[] };
    expect(res.status, "a repaired package was refused").toBe(200);
    expect(body.data?.resume?.rewrittenResume).toContain("$120,000");
    expect(body.data?.resume?.rewrittenResume).not.toContain("250,000");
    expect(resumeRequests.length, "the model was asked for the résumé").toBe(2);
    const repair = resumeRequests[1];
    expect(repair.length).toBe(4);
    expect(repair[2].role).toBe("assistant");
    expect(repair[3].role).toBe("user");
    expect(repair[3].content).toMatch(/REJECTED/);
    expect(repair[3].content).toMatch(/250,000|10,000/);
  });

  it("has each invented line put back to the résumé's own when the repair still adds a figure, is delivered, and the model is not asked a third time", async () => {
    resumeAnswers = [INVENTED, INVENTED];
    const res = await post();
    const body = await res.json() as { data?: { resume?: { rewrittenResume?: string } }; groundingIssues?: string[] };
    expect(res.status, "a package whose lines could go back to the résumé's own was refused").toBe(200);
    const text = body.data?.resume?.rewrittenResume ?? "";
    expect(text).toContain("- Built 40 Airflow pipelines moving 2TB a day");
    expect(text).toContain("- Cut warehouse spend by $120,000 a year");
    expect(text).not.toMatch(/250,000|10,000/);
    expect(text).toContain("Senior Data Engineer, Acme Corp");
    expect(resumeRequests.length).toBe(2);
  });

  it("leaves out an invented line the résumé has nothing like, and keeps the rest", async () => {
    const extra = HONEST + "\n- Mentored 25 junior analysts across three offices";
    resumeAnswers = [extra, extra];
    const res = await post();
    const body = await res.json() as { data?: { resume?: { rewrittenResume?: string } } };
    expect(res.status).toBe(200);
    const text = body.data?.resume?.rewrittenResume ?? "";
    expect(text).not.toMatch(/Mentored 25/);
    expect(text).toContain("- Cut warehouse spend by $120,000 a year");
  });
});

describe("a letter that adds a figure the candidate never claimed", () => {
  it("is sent back once, and refused when its repair still adds the figure", async () => {
    letterAnswers = ["Dear Globex team, I built 40 Airflow pipelines and saved $900,000."];
    const res = await post();
    const body = await res.json() as { data?: unknown; groundingIssues?: string[]; retryable?: boolean };
    expect(res.status).toBe(422);
    expect(body.data).toBeUndefined();
    expect(body.retryable).toBe(true);
    expect(body.groundingIssues?.join(" ")).toMatch(/900,000/);
    expect(letterRequests.length, "the letter was not repaired exactly once").toBe(2);
  });
});

describe("figures the candidate did claim, written another way or quoting the posting", () => {
  it("delivers a skills line naming the posting's own number without a repair", async () => {
    resumeAnswers = [HONEST + "\n\nSKILLS\nPython\nAirflow, ISO 27001"];
    const res = await post();
    const body = await res.json() as { data?: { resume?: { rewrittenResume?: string } } };
    expect(res.status).toBe(200);
    expect(body.data?.resume?.rewrittenResume).toContain("ISO 27001");
    expect(resumeRequests.length, "a skills line quoting the posting was sent back for repair").toBe(1);
  });

  it("still sends back a bullet that lifts the posting's number as an achievement", async () => {
    resumeAnswers = [HONEST + "\n- Led the ISO 27001 certification audit", HONEST];
    const res = await post();
    expect(res.status).toBe(200);
    expect(resumeRequests.length).toBe(2);
  });

  it("reads $120K as the résumé's $120,000", async () => {
    resumeAnswers = [HONEST.replace("$120,000", "$120K")];
    const res = await post();
    expect(res.status).toBe(200);
    expect(resumeRequests.length, "$120K was refused as an invented figure").toBe(1);
  });

  it("is delivered first time, with no repair call, when its figures are the candidate's own", async () => {
    resumeAnswers = [HONEST];
    const res = await post();
    expect(res.status).toBe(200);
    expect(resumeRequests.length).toBe(1);
  });
});
