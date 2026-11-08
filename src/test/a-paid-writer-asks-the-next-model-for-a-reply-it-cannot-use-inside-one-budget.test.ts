// @vitest-environment node
//
// Node, not jsdom: the handlers are bundled with esbuild (helpers/edge-harness.ts).
/**
 * A PAID WRITER ASKS THE NEXT MODEL FOR A REPLY IT CANNOT USE, INSIDE ONE
 * BUDGET (review of S13-001 and S10-009).
 *
 * The first build moved the paid writers onto the shared chain, but:
 *   - the cover letter, the tailored résumé and the premium package took the
 *     chain's first 200 whatever it held: a reply cut off at its cap (the
 *     thinking counts against it), an empty one, or JSON that does not parse
 *     ended the request with a 500, 502 or 422, the rest of the chain unused
 *     (S10-009's failure, which callAIForUsableReply was written to close
 *     and which only interview prep and the preview used);
 *   - the Apply Kit's grounding regeneration and the cover note's repair
 *     each had a fresh 125 s, so a slow draft and its second call could run
 *     about 250 s, past the platform's 150 s;
 *   - test-ai-fallback's mode "all" asked its four models one after another,
 *     40 s each: 160 s when the gateway hangs, the platform's 504 instead of
 *     the report.
 *
 * Held here, on the shipped handlers with a faked gateway and a fake clock:
 *   - a cut-off, empty or unreadable reply goes to the next model, which
 *     writes the delivery; when none can, each function's own retryable
 *     answer, with the use given back;
 *   - every model request in one request starts and ends inside 125 s of it,
 *     the Apply Kit's regeneration and the cover note's repair included, and
 *     a second call with no time left fails as a failed second call did;
 *   - the diagnostic's "all" answers inside about 40 s whatever hangs.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { SLOW } from "./helpers/mount-budget";
import { FREE_USER, WRITING_STUBS, WritingWorld, loadWriter, post, tokenFor } from "./helpers/writing-harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

const DEADLINE_MS = 125_000;
const SERVICE_KEY = "service-role-harness-key-0123456789abcdef";

type Seen = { model: string; body: Record<string, unknown>; at: number; abortedAt?: number };
type Plan = (s: Seen, n: number) => "hang" | Response | { after: number; reply: Response };

/** The gateway: records every model request with the fake clock's time and answers by plan ("hang" waits for the abort). */
class Gateway {
  seen: Seen[] = [];
  t0 = 0;
  plan: Plan = () => "hang";
  install(): void {
    const g = globalThis as Record<string, unknown>;
    const fallback = g.fetch as (url: string, init?: unknown) => Promise<Response>;
    g.fetch = (url: string, init?: { body?: string; signal?: AbortSignal }) => {
      if (!String(url).includes("ai.gateway.lovable.dev")) return fallback(url, init);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const s: Seen = { model: String(body.model), body, at: Date.now() - this.t0 };
      this.seen.push(s);
      const answer = this.plan(s, this.seen.length - 1);
      if (answer instanceof Response) return Promise.resolve(answer);
      return new Promise<Response>((resolve, reject) => {
        const timer = answer === "hang" ? undefined : setTimeout(() => resolve(answer.reply), answer.after);
        const abort = () => {
          if (timer) clearTimeout(timer);
          s.abortedAt = Date.now() - this.t0;
          reject(Object.assign(new Error("The signal has been aborted"), { name: "AbortError" }));
        };
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort);
      });
    };
  }
  start(): void {
    this.t0 = Date.now();
  }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * One request on the fake clock, in one-second steps until the answer comes.
 * The clock moves only while the request is waiting on it -- a timer of its
 * own is pending -- and stands still while it waits on real I/O (the gates).
 *
 * THE SAME RACE AS the-paid-writers-walk-one-chain-inside-one-deadline.test.ts
 * (2026-11-07), whose drive() comment tells it in full. This loop used to give
 * the request 3,000 setImmediate turns and then step the clock whatever the
 * request was doing; the spend gates' crypto.subtle.digest comes back in real
 * time on Node's threadpool, so on a loaded runner the clock ran past the
 * deadline before the first model was asked. With 10 ms of real delay on
 * digest the old loop failed three or four of the twenty cases here on every
 * run; it had not yet failed on main's CI.
 *
 * A request that is neither done nor waiting on a timer for SLOW.timeout of
 * real time is stuck on something else; it fails here, saying so, inside the
 * per-test budget (helpers/mount-budget.ts) rather than as "Test timed out".
 */
async function drive<T>(gateway: Gateway, request: () => Promise<T>, maxMs = 400_000): Promise<{ result: T; at: number }> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  gateway.start();
  let done = false;
  let at = 0;
  const pending = request().finally(() => { done = true; at = Date.now() - gateway.t0; });
  let waitingOnIoSince: number | null = null;
  for (let t = 0; t < maxMs && !done;) {
    if (vi.getTimerCount() === 0) {
      waitingOnIoSince ??= performance.now();
      if (performance.now() - waitingOnIoSince > SLOW.timeout) {
        throw new Error(`the request waited ${SLOW.timeout} ms of real time at ${t} ms on the fake clock with no timer pending and no answer: stuck on something the clock cannot move and that never came back`);
      }
      await tick();
      continue;
    }
    waitingOnIoSince = null;
    await vi.advanceTimersByTimeAsync(1_000);
    t += 1_000;
    for (let i = 0; i < 10 && !done; i++) await tick();
  }
  const result = await pending;
  return { result, at };
}

const chat = (content: unknown, finish = "stop") =>
  new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), { status: 200 });
const tool = (name: string, args: unknown, finish = "stop") =>
  new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { tool_calls: [{ function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } }] } }] }), { status: 200 });
const systemOf = (s: Seen) => String((s.body.messages as Array<{ content: string }>)[0]?.content ?? "");
const turns = (s: Seen) => (s.body.messages as unknown[]).length;

function heldToTheDeadline(gateway: Gateway, answeredAt: number): void {
  for (const s of gateway.seen) {
    expect(s.at, `${s.model} was asked at ${s.at} ms`).toBeLessThan(DEADLINE_MS);
    if (s.abortedAt !== undefined) expect(s.abortedAt, `${s.model} ran to ${s.abortedAt} ms`).toBeLessThanOrEqual(DEADLINE_MS);
  }
  expect(answeredAt, "the person was answered after the deadline").toBeLessThanOrEqual(DEADLINE_MS);
}

let gateway: Gateway;
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const quiet = () => {
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
};

const RESUME = "Jane Doe -- Senior software engineer with ten years of TypeScript, Postgres and payments work at Acme Corp. Led a team of five. ".repeat(3);
const POSTING = "We are hiring a senior engineer to own our checkout and fulfilment services end to end, with on-call and mentoring for the team.";

// ---------------- generate-cover-letter ----------------

const LETTER = { coverLetter: "Dear Hiring Manager,\n\nAt Acme Corp I led a team of five on payments work in TypeScript and Postgres. I would bring the same care to your checkout services.\n\nBest,\nJane Doe", openingLine: "x", keySkillsHighlighted: [], personalizedElements: [], suggestedSubjectLine: "x", alternateOpenings: [] };
const CUT_LETTER = '{"coverLetter":"Dear Hiring Manager,\\n\\nAt Acme Corp I led';

describe("generate-cover-letter: a 200 is not a letter", () => {
  let handler: EdgeHandler;
  let world: WritingWorld;
  beforeAll(async () => {
    new WritingWorld().install();
    handler = await loadWriter("generate-cover-letter");
  }, 240_000);
  beforeEach(() => {
    world = new WritingWorld();
    world.install();
    gateway = new Gateway();
    gateway.install();
    quiet();
  });
  const ask = (who = "service") => post(handler, "generate-cover-letter", { resumeText: RESUME, jobTitle: "Engineer", jobDescription: POSTING }, who);

  const unusable: Array<[string, () => Response]> = [
    ["cut off at its cap (the thinking spent it)", () => chat(CUT_LETTER, "length")],
    ["empty", () => chat("")],
    ["broken JSON", () => chat(CUT_LETTER)],
    // Recheck: JSON with no letter in it passed every check on an empty string.
    ["of JSON with no letter in it", () => chat({ error: "cannot comply" })],
    ["of JSON whose letter is empty", () => chat({ ...LETTER, coverLetter: "  " })],
  ];
  for (const [what, reply] of unusable) {
    it(`a reply ${what} asks the next model, which writes the letter`, async () => {
      gateway.plan = (s) => (s.model === "google/gemini-2.5-pro" ? reply() : chat(LETTER));
      const { result: r, at } = await drive(gateway, () => ask());
      expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
      expect((r.body.data as Record<string, unknown>).coverLetter).toBe(LETTER.coverLetter);
      expect(r.body.modelUsed).toBe("openai/gpt-5");
      expect(gateway.seen.map((s) => s.model)).toEqual(["google/gemini-2.5-pro", "openai/gpt-5"]);
      // The body the letter always sent, to the next model too.
      for (const s of gateway.seen) expect(Object.keys(s.body)).toEqual(["model", "messages", "max_completion_tokens"]);
      heldToTheDeadline(gateway, at);
    });
  }

  it("prose is still a letter: the first model's prose is delivered, no next model asked", async () => {
    gateway.plan = () => chat("Dear Hiring Manager,\n\nAt Acme Corp I led a team of five on payments work.\n\nBest,\nJane Doe");
    const { result: r } = await drive(gateway, () => ask());
    expect(r.status).toBe(200);
    expect(gateway.seen).toHaveLength(1);
  });

  it("a grounding rewrite with no letter in it is no letter: the first draft's issues stand and it is refused, not shipped empty", async () => {
    const invented = { ...LETTER, coverLetter: "Dear Hiring Manager,\n\nAt Acme Corp I cut payment failures by 73% across 9 markets.\n\nBest,\nJane Doe" };
    gateway.plan = (s) => (turns(s) === 2 ? chat(invented) : chat({ note: "rewritten" }));
    const { result: r, at } = await drive(gateway, () => ask());
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(422);
    expect(r.body).toMatchObject({ code: "grounding_refused", retryable: true });
    // Every model of the rewrite was asked for a letter before the refusal.
    expect(gateway.seen.filter((s) => turns(s) === 4).map((s) => s.model)).toEqual(["google/gemini-2.5-pro", "openai/gpt-5", "openai/gpt-5-mini"]);
    heldToTheDeadline(gateway, at);
  });

  it("no model writes one: the retryable 502 it always gave, and the account's use given back", async () => {
    gateway.plan = () => chat(CUT_LETTER, "length");
    const { result: r, at } = await drive(gateway, () => ask(tokenFor(FREE_USER)));
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ error: "The AI returned an unreadable draft. Please try again.", retryable: true });
    expect(gateway.seen.map((s) => s.model)).toEqual(["google/gemini-2.5-flash", "openai/gpt-5-mini"]);
    expect(world.refunds).toEqual([{ p_user_id: FREE_USER, p_use_ids: ["use-letter-0"] }]);
    heldToTheDeadline(gateway, at);
  });
});

// ---------------- generate-tailored-resume ----------------

const TAILORED = { professionalSummary: "Engineer", keySkills: [], experienceHighlights: [], keywordsRequired: [], keywordGaps: [], matchScoreDelta: 5, suggestedJobTitle: "Engineer", coverLetterOpening: "x", applicationTips: [] };

describe("generate-tailored-resume: a 200 is not a résumé", () => {
  let handler: EdgeHandler;
  let world: WritingWorld;
  beforeAll(async () => {
    new WritingWorld().install();
    handler = await loadWriter("generate-tailored-resume");
  }, 240_000);
  beforeEach(() => {
    world = new WritingWorld();
    world.install();
    gateway = new Gateway();
    gateway.install();
    quiet();
  });
  const ask = (who = "service") => post(handler, "generate-tailored-resume", { resumeText: RESUME, jobTitle: "Engineer", jobDescription: POSTING }, who);

  const unusable: Array<[string, () => Response]> = [
    ["cut off at its cap, its arguments truncated", () => tool("submit_tailored_resume", '{"professionalSummary":"Engin', "length")],
    ["with no tool call", () => chat("Here is your tailored resume.")],
    ["with arguments that do not parse", () => tool("submit_tailored_resume", '{"professionalSummary":')],
  ];
  for (const [what, reply] of unusable) {
    it(`a reply ${what} asks the next model, which writes the résumé`, async () => {
      gateway.plan = (s) => (s.model === "google/gemini-2.5-pro" ? reply() : tool("submit_tailored_resume", TAILORED));
      const { result: r, at } = await drive(gateway, () => ask());
      expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
      expect(r.body).toMatchObject({ success: true, modelUsed: "openai/gpt-5", professionalSummary: "Engineer" });
      expect(gateway.seen.map((s) => s.model)).toEqual(["google/gemini-2.5-pro", "openai/gpt-5"]);
      heldToTheDeadline(gateway, at);
    });
  }

  it("no model writes one: the retryable 422 for a malformed draft, the use given back", async () => {
    gateway.plan = () => tool("submit_tailored_resume", '{"professionalSummary":"Engin', "length");
    const { result: r } = await drive(gateway, () => ask(tokenFor(FREE_USER)));
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ retryable: true });
    expect(world.refunds).toEqual([{ p_user_id: FREE_USER, p_use_ids: ["use-resume-0"] }]);
  });
});

// ---------------- generate-premium-package ----------------

const P_RESUME = [
  "Jane Doe | jane.doe@example.com | 555-010-0199",
  "Senior Data Engineer, Acme Corp, 2019 - Present",
  "- Built 40 Airflow pipelines moving 2TB a day",
  "- Cut warehouse spend by $120,000 a year",
].join("\n");
const HONEST = "Jane Doe\nSenior Data Engineer, Acme Corp\n- Built 40 Airflow pipelines moving 2TB a day\n- Cut warehouse spend by $120,000 a year";
const pResume = { rewrittenResume: HONEST, professionalSummary: "", keyChanges: [], addedKeywords: [], atsScore: { before: 50, after: 80, improvement: "" }, highlights: [] };
const pLetter = { coverLetter: "Dear Globex team, I built 40 Airflow pipelines.", openingLine: "", keySkillsHighlighted: [], suggestedSubjectLine: "" };
const isLetterCall = (s: Seen) => /cover letter/i.test(systemOf(s)) && !/resume writer|rewrite/i.test(systemOf(s).slice(0, 200));

describe("generate-premium-package: a 200 is not a delivery", () => {
  let handler: EdgeHandler;
  const db = new FakeDb({ used_stripe_sessions: ["session_id"] });
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: "anon_harness", LOVABLE_API_KEY: "lovable_harness" };
  const setUp = () => {
    const g = globalThis as Record<string, unknown>;
    g.Deno = { env: { get: (k: string) => env[k] } };
    g.EdgeRuntime = { waitUntil: () => undefined };
    g.__writerDb = { from: (t: string) => db.from(t), rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a) };
  };
  beforeAll(async () => {
    setUp();
    handler = await loadEdgeHandler("generate-premium-package", {
      "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
      "https://esm.sh/@supabase/supabase-js@2.39.3": "export const createClient = () => globalThis.__writerDb;",
    });
  }, 240_000);
  beforeEach(() => {
    setUp();
    (globalThis as Record<string, unknown>).fetch = async () => new Response("{}", { status: 200 });
    db.tables = {};
    db.rows("used_stripe_sessions").push({ session_id: "cs_live_writer", product_type: "premium_package" });
    db.rpcs = { check_rate_limit: () => ({ data: true, error: null }) };
    gateway = new Gateway();
    gateway.install();
    quiet();
  });
  const ask = async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/generate-premium-package", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE_KEY}`, "cf-connecting-ip": "203.0.113.7" },
      body: JSON.stringify({ resumeText: P_RESUME, jobDescription: "Globex is hiring a data engineer.", jobTitle: "Data Engineer", jobCompany: "Globex", sessionId: "cs_live_writer" }),
    }));
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };

  it("gpt-5's résumé empty and its letter cut off: gemini-2.5-pro writes both parts", async () => {
    gateway.plan = (s) => {
      if (s.model === "openai/gpt-5") return isLetterCall(s) ? chat('{"coverLetter":"Dear Glo', "length") : chat("");
      return chat(isLetterCall(s) ? pLetter : pResume);
    };
    const { result: r, at } = await drive(gateway, ask);
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    const data = r.body.data as { modelsUsed: Record<string, string>; resume: { rewrittenResume: string } };
    expect(data.modelsUsed).toEqual({ resume: "google/gemini-2.5-pro", coverLetter: "google/gemini-2.5-pro" });
    expect(data.resume.rewrittenResume).toBe(HONEST);
    heldToTheDeadline(gateway, at);
  });

  it("gpt-5's résumé JSON names no résumé and its letter JSON an empty one: gemini-2.5-pro writes both parts", async () => {
    gateway.plan = (s) => {
      if (s.model === "openai/gpt-5") return isLetterCall(s) ? chat({ ...pLetter, coverLetter: "" }) : chat({ error: "cannot comply" });
      return chat(isLetterCall(s) ? pLetter : pResume);
    };
    const { result: r, at } = await drive(gateway, ask);
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    const data = r.body.data as { modelsUsed: Record<string, string>; resume: { rewrittenResume: string }; coverLetter: { coverLetter: string } };
    expect(data.modelsUsed).toEqual({ resume: "google/gemini-2.5-pro", coverLetter: "google/gemini-2.5-pro" });
    expect(data.resume.rewrittenResume).toBe(HONEST);
    expect(data.coverLetter.coverLetter).toBe(pLetter.coverLetter);
    heldToTheDeadline(gateway, at);
  });

  it("no model writes a résumé field: the retryable 502, never a delivery with no résumé in it", async () => {
    gateway.plan = (s) => (isLetterCall(s) ? chat(pLetter) : chat({ ...pResume, rewrittenResume: undefined }));
    const { result: r } = await drive(gateway, ask);
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ retryable: true });
  });

  it("no model writes a readable résumé: the retryable 502 that keeps the delivery open", async () => {
    gateway.plan = (s) => (isLetterCall(s) ? chat(pLetter) : chat("Here is the résumé you asked for, rewritten."));
    const { result: r } = await drive(gateway, ask);
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ retryable: true });
    expect(gateway.seen.filter((s) => !isLetterCall(s)).map((s) => s.model)).toEqual(["openai/gpt-5", "google/gemini-2.5-pro", "openai/gpt-5-mini"]);
  });
});

// ---------------- generate-apply-package: one budget for the draft and its regeneration ----------------

const KIT_INVENTED = {
  jobMetadata: { title: "Engineer", company: "Globex" },
  tailoredResume: {
    contact: {},
    summary: "Senior software engineer.",
    experience: [{ company: "Initech Global Holdings", title: "Senior software engineer", startDate: "", endDate: "", bullets: [] }],
    education: [],
    skills: [],
    certifications: [],
  },
  skillGaps: [],
  checklist: [],
};

describe("generate-apply-package: the regeneration has only what is left of the request's 125 s", () => {
  let handler: EdgeHandler;
  let world: WritingWorld;
  beforeAll(async () => {
    new WritingWorld().install();
    handler = await loadEdgeHandler("generate-apply-package", {
      ...WRITING_STUBS,
      "https://esm.sh/stripe@18.5.0":
        "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async (id) => ({ id, payment_status: 'paid', metadata: { product_type: 'apply_assistant' } }) } }; } }",
    });
  }, 240_000);
  beforeEach(() => {
    world = new WritingWorld();
    world.install();
    world.db.rpcs.purchase_spend_take = () => ({ data: true, error: null });
    gateway = new Gateway();
    gateway.install();
    quiet();
  });

  it("a slow draft that invents an employer, then a regeneration whose models all hang: refused as before, inside the deadline", async () => {
    // pro hangs on the draft; gpt-5 drafts with an employer the résumé lacks; every model hangs on the regeneration.
    gateway.plan = (s) => (turns(s) === 2 && s.model === "openai/gpt-5" ? tool("submit_apply_package", KIT_INVENTED) : "hang");
    const { result: r, at } = await drive(gateway, () =>
      post(handler, "generate-apply-package", { resumeText: RESUME, jobPostingText: `Globex is hiring a senior engineer to own payments end to end. ${POSTING}`, sessionId: "cs_live_kit" }, "anon"));
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(422);
    expect(r.body).toMatchObject({ retryable: true });
    expect(gateway.seen.some((s) => turns(s) === 3), "the regeneration was never asked").toBe(true);
    heldToTheDeadline(gateway, at);
  });
});

// ---------------- generate-application-answers: the cover note's repair ----------------

describe("generate-application-answers: the cover note's repair has only what is left of the request's 125 s", () => {
  let handler: EdgeHandler;
  let world: WritingWorld;
  beforeAll(async () => {
    new WritingWorld().install();
    handler = await loadWriter("generate-application-answers");
  }, 240_000);
  beforeEach(() => {
    world = new WritingWorld();
    world.install();
    gateway = new Gateway();
    gateway.install();
    quiet();
  });

  it("a slow draft the gate refuses, then a repair whose models all hang: no note (the caller sends the candidate's own), inside the deadline", async () => {
    gateway.plan = (s) => (turns(s) === 2 && s.model === "google/gemini-2.5-pro" ? chat("Hi.") : "hang");
    const { result: r, at } = await drive(gateway, () =>
      post(handler, "generate-application-answers", {
        mode: "cover-note", resumeText: RESUME, jobDescription: POSTING, jobTitle: "Engineer", jobCompany: "Globex",
        baseNote: "I would love to bring my payments experience to Globex.", candidateName: "Jane Doe",
      }, "service"));
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(r.body).toMatchObject({ note: null });
    expect((r.body.issues as string[]).join(" ")).toMatch(/Too short/);
    expect(gateway.seen.some((s) => turns(s) === 4), "the repair was never asked").toBe(true);
    heldToTheDeadline(gateway, at);
  });
});

// ---------------- test-ai-fallback: mode "all" ----------------

describe("test-ai-fallback: mode \"all\" answers inside the platform's limit whatever hangs", () => {
  let handler: EdgeHandler;
  beforeAll(async () => {
    new WritingWorld().install();
    handler = await loadWriter("test-ai-fallback");
  }, 240_000);
  beforeEach(() => {
    new WritingWorld().install();
    gateway = new Gateway();
    gateway.install();
    quiet();
  });

  it("every model hangs: all four are asked at once, and the report comes back in about 40 s, each model failed", async () => {
    gateway.plan = () => "hang";
    const { result: r, at } = await drive(gateway, () => post(handler, "test-ai-fallback", { mode: "all" }, "service"));
    expect(new Set(gateway.seen.map((s) => s.model)).size).toBe(4);
    for (const s of gateway.seen) expect(s.at, s.model).toBe(0);
    expect(at).toBeLessThanOrEqual(45_000);
    expect(r.body).toMatchObject({ success: false, mode: "all" });
    expect((r.body.results as Array<{ success: boolean }>).every((x) => !x.success)).toBe(true);
  });

  it("one model writes text: it alone passes, the others are reported failed, all inside about 40 s", async () => {
    gateway.plan = (s) => (s.model === "google/gemini-2.5-flash" ? { after: 3_000, reply: chat("AI fallback test successful") } : "hang");
    const { result: r, at } = await drive(gateway, () => post(handler, "test-ai-fallback", { mode: "all" }, "service"));
    expect(at).toBeLessThanOrEqual(45_000);
    const results = r.body.results as Array<{ model: string; success: boolean }>;
    expect(results.filter((x) => x.success).map((x) => x.model)).toEqual(["google/gemini-2.5-flash"]);
    expect(r.body).toMatchObject({ success: true });
  });
});
