// @vitest-environment node
//
// Node, not jsdom: the handlers are bundled with esbuild (helpers/edge-harness.ts).
/**
 * THE PAID WRITERS WALK ONE CHAIN INSIDE ONE DEADLINE (S13-001's siblings).
 *
 * _shared/ai-fallback.ts stopped asking a model that timed out again and
 * holds its whole walk to 125 s, inside the platform's 150. Five writers did
 * not use it:
 *   - generate-cover-letter, generate-premium-package and
 *     generate-tailored-resume each had a private chain that asked a
 *     timed-out model again (55 s, then 55 s more) and had no deadline, and a
 *     second call in the same request (the letter's grounding retry, the
 *     package's figure repairs) started a fresh clock;
 *   - generate-ats-defense asked gpt-5 up to three times at 90 s each;
 *   - generate-freelance-boost walked the shared chain one model per call, so
 *     each model had its own 125 s and the walk could run about 165 s.
 * The platform killed such a request at 150 s with its own 504, which no
 * caller reads as this function's retryable answer.
 *
 * Held here, by running each shipped handler on a gateway that never answers
 * the models it is told to hang (it waits for the request's abort) and a fake
 * clock:
 *   - a model that timed out is not asked again: the next one is;
 *   - every model request in one person's request starts and ends inside 125 s
 *     of it, the second call of a request included;
 *   - each request body is the one the function always sent, model by model;
 *   - the answers are the ones each function gave: a 504 that says try again
 *     when the time ran out, the use given back, the package's restored
 *     résumé, the boost's retryable 502.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { SLOW } from "./helpers/mount-budget";
import { FREE_USER, WRITING_STUBS, WritingWorld, loadWriter, post, tokenFor } from "./helpers/writing-harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

const DEADLINE_MS = 125_000;
const SERVICE_KEY = "service-role-harness-key-0123456789abcdef";

type Seen = { model: string; body: Record<string, unknown>; at: number; abortedAt?: number; answeredAt?: number };
type Plan = (s: Seen, n: number) => "hang" | Response;

/** The gateway: records every model request with the fake clock's time, answers by plan, and hangs until aborted on "hang". */
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
      if (answer !== "hang") {
        s.answeredAt = s.at;
        return Promise.resolve(answer);
      }
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => {
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
 * Runs one request on the fake clock, in one-second steps until the answer
 * comes, for at most `maxMs` of it (past every old worst case, so an old
 * handler fails on what it did, not on a stuck test). The clock moves only
 * while the request is waiting on it -- a timer of its own is pending -- and
 * stands still while it waits on real I/O (the gates resolve on that, not on
 * the clock).
 *
 * THE CLOCK RAN WHILE THE GATES WERE STILL WORKING (2026-11-07). This used to
 * give the request 3,000 setImmediate turns to reach the gateway and then step
 * the clock whatever the request was doing. But the spend gates name the
 * purchase's bucket with crypto.subtle.digest (_shared/model-spend-gate.ts),
 * which Node runs on its libuv threadpool: it comes back in real time, not in
 * turns. On a loaded runner it came back a few milliseconds late, the loop had
 * stepped the fake clock past 120 s by then, and generate-ats-defense -- which
 * measures its 125 s from the request's start, as it must -- found under 5 s
 * left and gave the 504 without ever asking gpt-5: "expected [] to deeply
 * equal [['openai/gpt-5', 90000]]" on main's CI, 2026-11-06. A 10 ms real
 * delay put on digest fails five of the ten cases here on every run, that one
 * with CI's very message (premium-package and freelance-boost hash too); 10
 * ms on the request and response bodies as well fails all ten. Nothing in the
 * product was wrong: live, the clock is the wall clock and the gates spend
 * microseconds of it. Waiting for a pending timer before each step makes the
 * request's own real work cost it nothing on the fake clock, however slow the
 * host is.
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

const chat = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), { status: 200 });
const tool = (name: string, args: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }] }), { status: 200 });
const systemOf = (s: Seen) => String((s.body.messages as Array<{ content: string }>)[0]?.content ?? "");

/** Every model request started and ended inside the deadline, measured from the person's request. */
function heldToTheDeadline(gateway: Gateway, answeredAt: number): void {
  for (const s of gateway.seen) {
    expect(s.at, `${s.model} was asked at ${s.at} ms`).toBeLessThan(DEADLINE_MS);
    if (s.abortedAt !== undefined) expect(s.abortedAt, `${s.model} ran to ${s.abortedAt} ms`).toBeLessThanOrEqual(DEADLINE_MS);
  }
  expect(answeredAt, "the person was answered after the deadline").toBeLessThanOrEqual(DEADLINE_MS);
}

/** No model was asked again after it timed out in the same chain call. */
function neverAskedAgainAfterATimeout(seen: Seen[], sameCall: (a: Seen, b: Seen) => boolean): void {
  seen.forEach((s, i) => {
    if (s.abortedAt === undefined) return;
    const again = seen.slice(i + 1).find((later) => later.model === s.model && sameCall(s, later) && later.at >= s.abortedAt!);
    expect(again, `${s.model} timed out at ${s.abortedAt} ms and was asked again at ${again?.at} ms`).toBeUndefined();
  });
}

let gateway: Gateway;
afterEach(() => {
  vi.useRealTimers();
});

// ---------------- generate-cover-letter ----------------

const RESUME = "Jane Doe -- Senior software engineer with ten years of TypeScript, Postgres and payments work at Acme Corp. Led a team of five. ".repeat(3);
const POSTING = "We are hiring a senior engineer to own our checkout and fulfilment services end to end, with on-call and mentoring for the team.";
const LETTER = { coverLetter: "Dear Hiring Manager,\n\nAt Acme Corp I led a team of five on payments work in TypeScript and Postgres. I would bring the same care to your checkout services.\n\nBest,\nJane Doe", openingLine: "x", keySkillsHighlighted: [], personalizedElements: [], suggestedSubjectLine: "x", alternateOpenings: [] };
const INVENTED_LETTER = { ...LETTER, coverLetter: "Dear Hiring Manager,\n\nAt Acme Corp I grew revenue by 340% and led a team of five.\n\nBest,\nJane Doe" };

describe("generate-cover-letter", () => {
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
  });
  const ask = (who = "service") => post(handler, "generate-cover-letter", { resumeText: RESUME, jobTitle: "Engineer", jobDescription: POSTING }, who);

  it("a model that timed out is not asked again; the next one writes the letter, with the body the letter always sent", async () => {
    gateway.plan = (s) => (s.model === "google/gemini-2.5-pro" ? "hang" : chat(LETTER));
    const { result: r, at } = await drive(gateway, () => ask());
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    expect(gateway.seen.map((s) => s.model)).toEqual(["google/gemini-2.5-pro", "openai/gpt-5"]);
    expect(gateway.seen[0].abortedAt).toBe(55_000);
    heldToTheDeadline(gateway, at);
    for (const s of gateway.seen) {
      expect(Object.keys(s.body), s.model).toEqual(["model", "messages", "max_completion_tokens"]);
      expect(s.body.max_completion_tokens).toBe(4000);
    }
  });

  it("the grounding retry has only what is left of the request's 125 s, and a retry that runs out refuses the draft as before", async () => {
    // Pro hangs; gpt-5's first draft invents a figure; the retry's every model hangs.
    gateway.plan = (s) => (s.model === "openai/gpt-5" && (s.body.messages as unknown[]).length === 2 ? chat(INVENTED_LETTER) : "hang");
    const { result: r, at } = await drive(gateway, () => ask());
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ code: "grounding_refused", retryable: true });
    expect(gateway.seen.some((s) => (s.body.messages as unknown[]).length === 4), "the grounding retry was never asked").toBe(true);
    heldToTheDeadline(gateway, at);
    neverAskedAgainAfterATimeout(gateway.seen, (a, b) => (a.body.messages as unknown[]).length === (b.body.messages as unknown[]).length);
  });

  it("every model out of time: the 504 that says try again, and the account's use given back", async () => {
    gateway.plan = () => "hang";
    const { result: r, at } = await drive(gateway, () => ask(tokenFor(FREE_USER)));
    expect(r.status).toBe(504);
    expect(r.body).toMatchObject({ retryable: true });
    expect(world.refunds).toEqual([{ p_user_id: FREE_USER, p_use_ids: ["use-letter-0"] }]);
    expect(gateway.seen.map((s) => s.model)).toEqual(["google/gemini-2.5-flash", "openai/gpt-5-mini"]);
    heldToTheDeadline(gateway, at);
  });
});

// ---------------- generate-tailored-resume ----------------

const TAILORED = { professionalSummary: "Engineer", keySkills: [], experienceHighlights: [], keywordsRequired: [], keywordGaps: [], matchScoreDelta: 5, suggestedJobTitle: "Engineer", coverLetterOpening: "x", applicationTips: [] };

describe("generate-tailored-resume", () => {
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
  });
  const ask = (who = "service") => post(handler, "generate-tailored-resume", { resumeText: RESUME, jobTitle: "Engineer", jobDescription: POSTING }, who);

  it("a model that timed out is not asked again, and each model gets the body it always got", async () => {
    gateway.plan = (s) => (s.model === "google/gemini-2.5-pro" ? "hang" : tool("submit_tailored_resume", TAILORED));
    const { result: r, at } = await drive(gateway, () => ask());
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    expect(gateway.seen.map((s) => s.model)).toEqual(["google/gemini-2.5-pro", "openai/gpt-5"]);
    heldToTheDeadline(gateway, at);
    const [pro, gpt] = gateway.seen;
    expect(Object.keys(pro.body)).toEqual(["model", "messages", "max_tokens", "tools", "tool_choice"]);
    expect(pro.body.max_tokens).toBe(8000);
    expect(Object.keys(gpt.body)).toEqual(["model", "messages", "max_completion_tokens", "tools", "tool_choice"]);
    expect(gpt.body.max_completion_tokens).toBe(8000);
    expect(gpt.body.tool_choice).toEqual({ type: "function", function: { name: "submit_tailored_resume" } });
  });

  it("every model out of time: the 504 that says try again, inside the deadline, with the use given back", async () => {
    gateway.plan = () => "hang";
    const { result: r, at } = await drive(gateway, () => ask(tokenFor(FREE_USER)));
    expect(r.status).toBe(504);
    expect(r.body).toMatchObject({ retryable: true });
    expect(world.refunds).toEqual([{ p_user_id: FREE_USER, p_use_ids: ["use-resume-0"] }]);
    expect(gateway.seen.map((s) => s.model)).toEqual(["google/gemini-2.5-flash", "openai/gpt-5-mini"]);
    heldToTheDeadline(gateway, at);
  });
});

// ---------------- generate-premium-package ----------------

const P_RESUME = [
  "Jane Doe | jane.doe@example.com | 555-010-0199",
  "Senior Data Engineer, Acme Corp, 2019 - Present",
  "- Built 40 Airflow pipelines moving 2TB a day",
  "- Cut warehouse spend by $120,000 a year",
].join("\n");
const P_POSTING = "Globex is hiring a data engineer to scale pipelines for 3 million customers.";
const HONEST = "Jane Doe\nSenior Data Engineer, Acme Corp\n- Built 40 Airflow pipelines moving 2TB a day\n- Cut warehouse spend by $120,000 a year";
const INVENTED = "Jane Doe\nSenior Data Engineer, Acme Corp\n- Built 40 Airflow pipelines serving 10,000 users\n- Cut warehouse spend by $250,000 a year";
const pResume = (rewrittenResume: string) => ({ rewrittenResume, professionalSummary: "", keyChanges: [], addedKeywords: [], atsScore: { before: 50, after: 80, improvement: "" }, highlights: [] });
const pLetter = { coverLetter: "Dear Globex team, I built 40 Airflow pipelines.", openingLine: "", keySkillsHighlighted: [], suggestedSubjectLine: "" };
const isLetterCall = (s: Seen) => /cover letter/i.test(systemOf(s)) && !/resume writer|rewrite/i.test(systemOf(s).slice(0, 200));
const isRepair = (s: Seen) => (s.body.messages as unknown[]).length === 4;

describe("generate-premium-package", () => {
  let handler: EdgeHandler;
  const db = new FakeDb({ used_stripe_sessions: ["session_id"] });
  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: "anon_harness", LOVABLE_API_KEY: "lovable_harness" };
    g.Deno = { env: { get: (k: string) => env[k] } };
    g.EdgeRuntime = { waitUntil: () => undefined };
    g.__writerDb = { from: (t: string) => db.from(t), rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a) };
    handler = await loadEdgeHandler("generate-premium-package", {
      "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
      "https://esm.sh/@supabase/supabase-js@2.39.3": "export const createClient = () => globalThis.__writerDb;",
    });
  }, 240_000);
  beforeEach(() => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: "anon_harness", LOVABLE_API_KEY: "lovable_harness" };
    g.Deno = { env: { get: (k: string) => env[k] } };
    g.__writerDb = { from: (t: string) => db.from(t), rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a) };
    g.fetch = async () => new Response("{}", { status: 200 });
    db.tables = {};
    db.rows("used_stripe_sessions").push({ session_id: "cs_live_writer", product_type: "premium_package" });
    db.rpcs = { check_rate_limit: () => ({ data: true, error: null }) };
    gateway = new Gateway();
    gateway.install();
  });
  const ask = async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/generate-premium-package", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE_KEY}`, "cf-connecting-ip": "203.0.113.7" },
      body: JSON.stringify({ resumeText: P_RESUME, jobDescription: P_POSTING, jobTitle: "Data Engineer", jobCompany: "Globex", sessionId: "cs_live_writer" }),
    }));
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };

  it("gpt-5 timed out is not asked again: gemini-2.5-pro writes both parts, each with the body the package always sent", async () => {
    gateway.plan = (s) => (s.model === "openai/gpt-5" ? "hang" : chat(isLetterCall(s) ? pLetter : pResume(HONEST)));
    const { result: r, at } = await drive(gateway, ask);
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    expect(gateway.seen.map((s) => s.model).sort()).toEqual(["google/gemini-2.5-pro", "google/gemini-2.5-pro", "openai/gpt-5", "openai/gpt-5"]);
    heldToTheDeadline(gateway, at);
    for (const s of gateway.seen) {
      expect(Object.keys(s.body), s.model).toEqual(["model", "messages", "max_completion_tokens"]);
      expect(s.body.max_completion_tokens).toBe(isLetterCall(s) ? 4000 : 12000);
    }
  });

  it("the figure repair has only what is left of the request's 125 s; a repair that runs out delivers the restored résumé as before", async () => {
    // gpt-5 hangs; pro's first résumé invents figures; the repair's every model hangs.
    gateway.plan = (s) => {
      if (s.model === "openai/gpt-5" || isRepair(s)) return "hang";
      return chat(isLetterCall(s) ? pLetter : pResume(INVENTED));
    };
    const { result: r, at } = await drive(gateway, ask);
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    const rewritten = String(((r.body.data as Record<string, unknown>).resume as Record<string, unknown>).rewrittenResume);
    expect(rewritten).not.toContain("250,000");
    expect(gateway.seen.some(isRepair), "the repair was never asked").toBe(true);
    heldToTheDeadline(gateway, at);
    neverAskedAgainAfterATimeout(gateway.seen, (a, b) => isRepair(a) === isRepair(b) && isLetterCall(a) === isLetterCall(b));
  });
});

// ---------------- generate-ats-defense ----------------

const REPORT = { atsScore: { before: 50, after: 85 }, issues: [] };

describe("generate-ats-defense", () => {
  let handler: EdgeHandler;
  let db: FakeDb;
  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { STRIPE_SECRET_KEY: "sk_test_harness", LOVABLE_API_KEY: "lovable_harness", SUPABASE_URL: "https://harness.supabase.co", SUPABASE_ANON_KEY: "anon_harness", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY };
    g.Deno = { env: { get: (k: string) => env[k] } };
    g.EdgeRuntime = { waitUntil: () => undefined };
    handler = await loadEdgeHandler("generate-ats-defense", {
      "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
      "https://esm.sh/stripe@18.5.0": "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async (id) => ({ id, payment_status: 'paid', metadata: { product_type: 'ats_defense' }, customer_details: { email: 'buyer@example.com' } }) } }; } }",
      "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__atsDb; }",
    });
  }, 240_000);
  beforeEach(() => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { STRIPE_SECRET_KEY: "sk_test_harness", LOVABLE_API_KEY: "lovable_harness", SUPABASE_URL: "https://harness.supabase.co", SUPABASE_ANON_KEY: "anon_harness", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY };
    g.Deno = { env: { get: (k: string) => env[k] } };
    g.fetch = async () => new Response("{}", { status: 200 });
    db = new FakeDb({ used_stripe_sessions: ["session_id"] });
    db.rpcs.check_rate_limit = () => ({ data: true, error: null });
    db.rpcs.save_purchased_content = () => ({ data: null, error: null });
    g.__atsDb = db;
    gateway = new Gateway();
    gateway.install();
  });
  const ask = async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/generate-ats-defense", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.30", authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ sessionId: "cs_live_ats", resumeText: RESUME }),
    }));
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };

  it("gpt-5 that ran out of its 90 s is not asked again: the buyer gets the 504 that says try again, inside the deadline", async () => {
    gateway.plan = () => "hang";
    const { result: r, at } = await drive(gateway, ask);
    expect(r.status).toBe(504);
    expect(r.body).toMatchObject({ retryable: true });
    expect(gateway.seen.map((s) => [s.model, s.abortedAt])).toEqual([["openai/gpt-5", 90_000]]);
    heldToTheDeadline(gateway, at);
  });

  it("a server error is still asked again once, with the body the report always sent", async () => {
    gateway.plan = (_s, n) => (n === 0 ? new Response("upstream", { status: 503 }) : tool("submit_ats_defense_report", REPORT));
    const { result: r, at } = await drive(gateway, ask);
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    expect(r.body).toMatchObject({ success: true, data: REPORT, report: REPORT });
    expect(gateway.seen.map((s) => s.model)).toEqual(["openai/gpt-5", "openai/gpt-5"]);
    for (const s of gateway.seen) {
      expect(Object.keys(s.body)).toEqual(["model", "messages", "tools", "tool_choice"]);
      expect(s.body.tool_choice).toEqual({ type: "function", function: { name: "submit_ats_defense_report" } });
    }
    heldToTheDeadline(gateway, at);
  });
});

// ---------------- generate-freelance-boost ----------------

const project = (i: number) => ({ clientType: `client ${i}`, problem: "no bookings", deliverable: "a booking site", toolsSkills: "Figma", outcome: "bookings doubled", duration: "3 months" });

describe("generate-freelance-boost", () => {
  let handler: EdgeHandler;
  let world: WritingWorld;
  beforeAll(async () => {
    new WritingWorld().install();
    handler = await loadEdgeHandler("generate-freelance-boost", {
      ...WRITING_STUBS,
      "https://esm.sh/stripe@18.5.0":
        "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async (id) => ({ id, payment_status: 'paid', customer_details: { email: 'b@example.com' }, metadata: { product_type: 'freelance_boost' } }) } }; } }",
    });
  }, 240_000);
  beforeEach(() => {
    world = new WritingWorld();
    world.install();
    world.db.rpcs.save_purchased_content = () => ({ data: null, error: null });
    world.db.rows("product_deliveries").push({ stripe_session_id: "cs_boost_paid", status: "pending" });
    gateway = new Gateway();
    gateway.install();
  });

  it("its three models share one 125 s: the last gets what is left, and the buyer gets the retryable 502 inside the deadline", async () => {
    gateway.plan = () => "hang";
    const { result: r, at } = await drive(gateway, () => post(handler, "generate-freelance-boost", { sessionId: "cs_boost_paid", targetRole: "UX designer", projects: [0, 1].map(project), overlapsEmployment: true }, "anon"));
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ code: "draft_unusable", retryable: true });
    expect(gateway.seen.map((s) => s.model)).toEqual(["google/gemini-2.5-pro", "google/gemini-2.5-flash", "openai/gpt-5-mini"]);
    heldToTheDeadline(gateway, at);
    expect(world.db.rows("product_deliveries")[0].status).toBe("pending");
  });
});
