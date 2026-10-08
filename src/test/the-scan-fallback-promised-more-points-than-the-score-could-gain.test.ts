// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness.ts).
/**
 * THE SCAN FALLBACK PROMISED MORE POINTS THAN THE SCORE COULD GAIN.
 *
 * Register L5-15. The model's improvementPotential is an object,
 * {level, estimatedScoreIncrease, topPriority}, and the report prints
 * "+estimatedScoreIncrease pts". The primary (free-keyword-scan) clamps it to
 * the gap between the score and 98 since wave 1; the stream fork — the
 * browser's fallback, and callable by anyone — had no clamp at all, so a 92
 * could still be promised +25.
 *
 * Run against the shipped stream handler with its database and the AI gateway
 * faked: the model answers a 92 with a +25 promise, and the assertion is about
 * the report the browser receives, fresh and from the response cache.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const CLIENT =
  "export function createClient() { const db = globalThis.__streamDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t), auth: { getUser: async () => ({ data: { user: null }, error: null }) } }; }";
const STUBS: Record<string, string> = { "https://esm.sh/@supabase/supabase-js@2": CLIENT };

const RESUME = [
  "Jane Q. Candidate | jane.candidate@example.com | (555) 010-0199 | Austin, TX",
  "SUMMARY",
  "Senior financial analyst with nine years in FP&A, forecasting and vendor management.",
  "EXPERIENCE",
  "Senior Financial Analyst, Acme Corp, Jan 2020 - Present",
  "- Cut vendor spend by $250,000 annually by renegotiating contracts",
  "- Built the quarterly forecasting model used by the CFO",
  "Financial Analyst, Beta Inc, Mar 2016 - Dec 2019",
  "- Led month-end close for three business units",
  "EDUCATION",
  "BSc Economics, State University, 2015",
  "SKILLS",
  "Excel, SQL, Tableau, financial modeling, budgeting",
].join("\n");

let handler: EdgeHandler;
let db: FakeDb;
let analysis: Record<string, unknown>;
let mainCalls: number;

/** The gateway's streamed tool call, in three chunks as a real stream would send it. */
function streamedToolCall(args: string): Response {
  const enc = new TextEncoder();
  const third = Math.ceil(args.length / 3);
  const chunks = [args.slice(0, third), args.slice(third, 2 * third), args.slice(2 * third)];
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const a of chunks) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ function: { arguments: a } }] } }] })}\n\n`));
      }
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-harness",
    SUPABASE_ANON_KEY: "anon_harness",
    LOVABLE_API_KEY: "lovable_harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.fetch = async (url: string, init?: { body?: string }) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      if (String(init?.body ?? "").includes('"stream":true')) {
        mainCalls++;
        return streamedToolCall(JSON.stringify(analysis));
      }
      // The industry confirmation: a short, non-streamed answer.
      return new Response(JSON.stringify({ choices: [{ message: { content: "finance" } }] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  handler = await loadEdgeHandler("free-keyword-scan-stream", STUBS);
}, 180_000);

beforeEach(() => {
  db = new FakeDb();
  db.rpcs.check_global_rate_limit = () => ({ data: true, error: null });
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  db.rpcs.get_cached_response = () => ({ data: null, error: null });
  db.rpcs.acquire_scan_slot = () => ({ data: "slot-1", error: null });
  db.rpcs.release_scan_slot = () => ({ data: null, error: null });
  db.rpcs.log_scan_metric = () => ({ data: null, error: null });
  db.rpcs.store_cached_response = () => ({ data: null, error: null });
  (globalThis as Record<string, unknown>).__streamDb = db;
  mainCalls = 0;
  analysis = {
    detectedLanguage: { code: "en", name: "English" },
    industry: "finance",
    atsScoreEstimate: 92,
    formatGrade: "A",
    experienceLevel: { level: "senior", yearsEstimate: "9 years" },
    keywords: [],
    redFlags: [],
    quickWins: [{ fix: "Add a LinkedIn URL", timeEstimate: "2 min", impact: "medium" }],
    improvementPotential: { level: "high", estimatedScoreIncrease: 25, topPriority: "Add LinkedIn" },
  };
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

async function scan(): Promise<Record<string, unknown>> {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan-stream", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.20" },
    body: JSON.stringify({ resumeText: RESUME }),
  }));
  const text = await res.text();
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => ({ event: m[1], data: JSON.parse(m[2]) as Record<string, unknown> }));
  const err = events.find((e) => e.event === "error");
  if (err) throw new Error(`the scan answered an error: ${JSON.stringify(err.data)}`);
  const done = events.find((e) => e.event === "complete");
  if (!done) throw new Error(`no complete event in: ${text.slice(0, 300)}`);
  return done.data;
}

const promise = (r: Record<string, unknown>) => (r.improvementPotential as { estimatedScoreIncrease: number }).estimatedScoreIncrease;

describe("the fallback's improvement promise is bounded by the score it reports", () => {
  it("a fresh report never promises more points than its own score can gain", async () => {
    const r = await scan();
    expect(mainCalls).toBe(1);
    const score = r.atsScoreEstimate as number;
    expect(score, "the model's 92 survives as a high score").toBeGreaterThan(73);
    expect(promise(r), `a ${score} cannot gain ${promise(r)} points`).toBeLessThanOrEqual(Math.max(0, 98 - score));
    expect(promise(r)).toBeGreaterThanOrEqual(0);
    // The rest of the object is the model's, untouched.
    expect((r.improvementPotential as { topPriority: string }).topPriority).toBe("Add LinkedIn");
  });

  it("a modest promise on a modest score is left exactly as the model gave it", async () => {
    analysis.atsScoreEstimate = 60;
    (analysis.improvementPotential as { estimatedScoreIncrease: number }).estimatedScoreIncrease = 8;
    const r = await scan();
    expect(promise(r)).toBe(8);
  });

  it("a negative promise is floored at zero", async () => {
    (analysis.improvementPotential as { estimatedScoreIncrease: number }).estimatedScoreIncrease = -5;
    expect(promise(await scan())).toBe(0);
  });

  it("a report served from the response cache is bounded too, though it was cached before the clamp", async () => {
    db.rpcs.get_cached_response = () => ({
      data: { success: true, industry: "finance", atsScoreEstimate: 92, improvementPotential: { level: "high", estimatedScoreIncrease: 25, topPriority: "Add LinkedIn" } },
      error: null,
    });
    const r = await scan();
    expect(mainCalls, "a cache hit asks no model").toBe(0);
    expect(r.cached).toBe(true);
    expect(promise(r)).toBe(6);
  });
});
