// @vitest-environment node
//
// Node, not jsdom: the handlers are bundled with esbuild (helpers/edge-harness.ts).
/**
 * EVERY MODEL REPLY PRINTS ITS TOKEN COUNTS, AND NO TEXT (cost audit
 * 2026-11-08, Do first #11; free-keyword-scan 2026-11-09.2,
 * free-keyword-scan-stream 2026-11-10.2, scan-heartbeat 2026-11-09.1).
 *
 * No function read the gateway's usage object, so every model cost the audit
 * names was an estimate, and the changes waiting on a measurement (a split
 * scan prompt, a smaller thinking budget, another model) had nothing to be
 * measured against. Each reply these functions parse themselves now prints
 *   [AI-USAGE] context=... model=... prompt_tokens=... completion_tokens=...
 *   cached_tokens=... reasoning_tokens=... finish_reason=...
 * with numbers and identifiers only, and the free scan's completed metric
 * keeps the counts, so a week of them can be read back.
 *
 * Proved here: the three copies of ai-usage.ts are one file; the line's shape,
 * with '-' for a count the gateway did not send and for a finish reason that
 * is not an identifier; and, on the shipped handlers with the gateway faked,
 * the free scan's two calls, the backup scanner's industry check and its
 * streamed analysis each print their line, carrying none of the résumé.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { aiUsageLine, aiUsageOf } from "../../supabase/functions/free-keyword-scan/ai-usage";
import { SCAN_MODEL_CHAIN } from "../../supabase/functions/_shared/scan-models";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

const FUNCTIONS = resolve(__dirname, "../../supabase/functions");
const SHAPE = /^\[AI-USAGE\] context=[A-Za-z0-9._:/-]+ model=[A-Za-z0-9._:/-]+ prompt_tokens=(\d+|-) completion_tokens=(\d+|-) cached_tokens=(\d+|-) reasoning_tokens=(\d+|-) finish_reason=([A-Za-z0-9._:/-]+|-)$/;

describe("the line", () => {
  it("is one file in all three functions", () => {
    const [a, b, c] = ["free-keyword-scan", "free-keyword-scan-stream", "scan-heartbeat"].map((fn) => readFileSync(resolve(FUNCTIONS, fn, "ai-usage.ts"), "utf8"));
    expect(b, "the backup scanner's copy drifted").toBe(a);
    expect(c, "the heartbeat's copy drifted").toBe(a);
  });

  it("prints every count the gateway sent, in one fixed shape", () => {
    const line = aiUsageLine("free-keyword-scan.core", "google/gemini-2.5-flash", {
      choices: [{ message: { content: "the model's words" }, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 11873, completion_tokens: 2210, prompt_tokens_details: { cached_tokens: 8192 }, completion_tokens_details: { reasoning_tokens: 1530 } },
    });
    expect(line).toBe("[AI-USAGE] context=free-keyword-scan.core model=google/gemini-2.5-flash prompt_tokens=11873 completion_tokens=2210 cached_tokens=8192 reasoning_tokens=1530 finish_reason=tool_calls");
  });

  it("prints '-' for a count the gateway did not send, never 0, and reads the flat fields when the nested ones are absent", () => {
    expect(aiUsageLine("x", "m", { choices: [{}] })).toBe("[AI-USAGE] context=x model=m prompt_tokens=- completion_tokens=- cached_tokens=- reasoning_tokens=- finish_reason=-");
    expect(aiUsageOf({ usage: { prompt_tokens: 5, completion_tokens: 7, cached_tokens: 2, reasoning_tokens: 3 } })).toEqual({ prompt: 5, completion: 7, cached: 2, reasoning: 3, finish: null });
    expect(aiUsageOf({ usage: { prompt_tokens: -1, completion_tokens: Number.NaN } })).toMatchObject({ prompt: null, completion: null });
    expect(aiUsageLine("x", "m", null)).toMatch(SHAPE);
  });

  it("never carries text: a finish reason, a context or a model that is not an identifier prints '-'", () => {
    const line = aiUsageLine("free scan for jane.doe@example.com", "a model\nwith a newline", {
      choices: [{ finish_reason: "stop because Jane Doe, 555-0199, asked" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expect(line).toMatch(SHAPE);
    expect(line).not.toMatch(/jane|Jane|555|newline/);
  });
});

// ── The free scan, shipped handler ───────────────────────────────────────────

const RESUME = [
  "Jane Doe | jane.doe@example.com | (555) 010-0199",
  "SUMMARY", "Senior financial analyst with nine years in FP&A and vendor management.",
  "EXPERIENCE", "Senior Financial Analyst, Acme Corp, Jan 2020 - Present",
  "- Cut vendor spend by $250,000 annually by renegotiating contracts",
  "- Built the quarterly forecasting model used by the CFO",
  "Financial Analyst, Beta Inc, Mar 2016 - Dec 2019", "- Led month-end close for three business units",
  "EDUCATION", "BSc Economics, State University, 2015",
  "SKILLS", "Excel, SQL, Tableau, financial modeling, budgeting",
].join("\n");

const ANALYSIS = {
  detectedLanguage: { code: "en", name: "English" }, candidateName: "Jane Doe", industry: "finance", atsScoreEstimate: 72,
  formatGrade: "B", formatIssue: "Clean single-column layout.", experienceLevel: { level: "senior", yearsEstimate: "9 years" },
  sectionCheck: { hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true, missingSections: [] },
  contactInfo: { hasEmail: true, hasPhone: true, hasLinkedIn: false, missingItems: ["LinkedIn URL"] },
  topStrength: "Quantified cost savings", redFlags: [], keywords: [],
  quickWins: [{ fix: "Add a LinkedIn URL", timeEstimate: "2 min", impact: "medium", scoreImpact: 3, category: "contact" }],
  topSkipReasons: [], powerWords: [], weakPhrases: [], additionalRewrites: [], formatGradeDrivers: [],
  recruiterFirstPassSummary: "Strong, quantified finance profile.",
  nextBestAction: { action: "Add LinkedIn", why: "Recruiters check it", estimatedImpact: "+3 pts" },
  improvementPotential: { level: "moderate", estimatedScoreIncrease: 6, topPriority: "Add LinkedIn" },
  resumeLength: { current: 1, recommended: 1 }, wordCount: { current: 110, ideal: "400-700" },
  actionVerbGrade: "B", readabilityScore: 70, keywordDensity: 3,
  scoreBreakdown: { keywords: 70, format: 80, quantification: 60 },
  industryBenchmark: { industryAvg: 66, comparison: "above", percentile: "60th" }, sampleRewrite: null,
};

const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-harness-key-0123456789abcdef",
  SUPABASE_ANON_KEY: "anon_harness", LOVABLE_API_KEY: "lovable_harness", RESEND_API_KEY: "re_harness", NOTIFY_SCANS: "false",
};

let scanHandler: EdgeHandler;
let streamHandler: EdgeHandler;
let rpcs: Array<[string, Record<string, unknown>]>;
let pending: Promise<unknown>[];
let logs: string[];

function scanClient() {
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    rpcs.push([name, args]);
    if (name === "check_global_rate_limit" || name === "check_rate_limit") return { data: true, error: null };
    if (name === "acquire_scan_slot") return { data: "slot-1", error: null };
    return { data: null, error: null };
  };
  const from = () => {
    const b: Record<string, unknown> = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") return (ok: (r: unknown) => unknown, no?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, no);
        if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: null, error: null });
        return () => b;
      },
    });
    return b;
  };
  return { rpc, from, auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
}

/** The scanner's two calls answer with different counts, so each line is its own. */
const SCAN_USAGE: Record<string, Record<string, unknown>> = {
  core: { prompt_tokens: 12001, completion_tokens: 2002, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 1003 } },
  enrich: { prompt_tokens: 11004, completion_tokens: 3005 },
};
const STREAM_SSE = [
  `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ function: { arguments: JSON.stringify({ atsScoreEstimate: 70, industry: "finance" }) } }] } }] })}`,
  `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}`,
  `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 13006, completion_tokens: 2507, completion_tokens_details: { reasoning_tokens: 907 } } })}`,
  "data: [DONE]",
  "",
].join("\n\n");
/** The same stream with no usage chunk: what a gateway sends a request that did not ask for one. */
const STREAM_SSE_NO_USAGE = STREAM_SSE.split("\n\n").filter((c) => !c.includes('"usage"')).join("\n\n");
let streamBody = STREAM_SSE;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (p: unknown) => { pending.push(Promise.resolve(p).catch(() => {})); } };
  g.fetch = async (url: string, init?: { body?: string }) => {
    const u = String(url);
    if (!u.includes("ai.gateway.lovable.dev")) return new Response("{}", { status: 200 });
    const req = JSON.parse(init?.body ?? "{}") as { stream?: boolean; tools?: Array<{ function: { parameters: { properties: Record<string, unknown> } } }> };
    if (req.stream) return new Response(streamBody, { status: 200, headers: { "content-type": "text/event-stream" } });
    if (!req.tools) {
      // The backup scanner's industry check: a plain completion.
      return new Response(JSON.stringify({ choices: [{ message: { content: "finance" }, finish_reason: "stop" }], usage: { prompt_tokens: 808, completion_tokens: 109, completion_tokens_details: { reasoning_tokens: 101 } } }), { status: 200 });
    }
    const which = "recruiterPanel" in (req.tools[0].function.parameters.properties ?? {}) ? "enrich" : "core";
    return new Response(JSON.stringify({
      choices: [{ message: { tool_calls: [{ function: { name: "submit_analysis", arguments: JSON.stringify(ANALYSIS) } }] }, finish_reason: "tool_calls" }],
      usage: SCAN_USAGE[which],
    }), { status: 200 });
  };
  scanHandler = await loadEdgeHandler("free-keyword-scan", {
    "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__usageScanClient;",
  });
  streamHandler = await loadEdgeHandler("free-keyword-scan-stream", {
    "https://esm.sh/@supabase/supabase-js@2":
      "export function createClient() { const db = globalThis.__usageStreamDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t), auth: { getUser: async () => ({ data: { user: null }, error: null }) } }; }",
  });
}, 240_000);

beforeEach(() => {
  rpcs = [];
  pending = [];
  logs = [];
  streamBody = STREAM_SSE;
  (globalThis as Record<string, unknown>).__usageScanClient = scanClient();
  const db = new FakeDb();
  for (const n of ["check_global_rate_limit", "check_rate_limit"]) db.rpcs[n] = () => ({ data: true, error: null });
  db.rpcs.get_cached_response = () => ({ data: null, error: null });
  db.rpcs.acquire_scan_slot = () => ({ data: "slot-1", error: null });
  db.rpcs.release_scan_slot = () => ({ data: null, error: null });
  db.rpcs.log_scan_metric = () => ({ data: null, error: null });
  (globalThis as Record<string, unknown>).__usageStreamDb = db;
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(" ")); });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

const usageLines = () => logs.filter((l) => l.startsWith("[AI-USAGE]"));
const RESUME_WORDS = /Jane|Doe|example\.com|Acme|vendor spend|555/;

describe("the free scan (free-keyword-scan)", () => {
  it("prints one line for its core call and one for its enrich call, with that call's counts and no résumé text", async () => {
    const res = await scanHandler(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.42" },
      body: JSON.stringify({ resumeText: RESUME }),
    }));
    expect(res.status).toBe(200);
    for (let i = 0; i < 3; i++) await Promise.allSettled(pending);
    const lines = usageLines().sort();
    const model = SCAN_MODEL_CHAIN[0];
    expect(lines).toEqual([
      `[AI-USAGE] context=free-keyword-scan.core model=${model} prompt_tokens=12001 completion_tokens=2002 cached_tokens=0 reasoning_tokens=1003 finish_reason=tool_calls`,
      `[AI-USAGE] context=free-keyword-scan.enrich model=${model} prompt_tokens=11004 completion_tokens=3005 cached_tokens=- reasoning_tokens=- finish_reason=tool_calls`,
    ]);
    for (const l of lines) expect(l).not.toMatch(RESUME_WORDS);
  });

  it("keeps the counts on its completed metric, numbers only", async () => {
    await scanHandler(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.43" },
      body: JSON.stringify({ resumeText: RESUME }),
    }));
    for (let i = 0; i < 3; i++) await Promise.allSettled(pending);
    const done = rpcs.find(([n, a]) => n === "log_scan_metric" && a.p_status === "completed")?.[1];
    expect((done?.p_metadata as { aiUsage?: unknown } | undefined)?.aiUsage).toEqual({
      core: { prompt: 12001, completion: 2002, cached: 0, reasoning: 1003, finish: "tool_calls" },
      enrich: { prompt: 11004, completion: 3005, cached: null, reasoning: null, finish: "tool_calls" },
    });
  });
});

describe("the backup scanner (free-keyword-scan-stream)", () => {
  it("prints one line for its industry check and one for its streamed analysis, with no résumé text", async () => {
    const res = await streamHandler(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan-stream", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.44" },
      body: JSON.stringify({ resumeText: RESUME, targetCountry: "US", language: "en" }),
    }));
    await res.text();
    const lines = usageLines().sort();
    expect(lines).toEqual([
      "[AI-USAGE] context=free-keyword-scan-stream.analysis model=google/gemini-2.5-flash prompt_tokens=13006 completion_tokens=2507 cached_tokens=- reasoning_tokens=907 finish_reason=tool_calls",
      "[AI-USAGE] context=free-keyword-scan-stream.industry model=google/gemini-2.5-flash prompt_tokens=808 completion_tokens=109 cached_tokens=- reasoning_tokens=101 finish_reason=stop",
    ]);
    for (const l of lines) expect(l).not.toMatch(RESUME_WORDS);
  });

  it("a stream that carried no usage chunk still prints the one seven-field line, its counts '-', with nothing appended (owner's format)", async () => {
    expect(STREAM_SSE_NO_USAGE).not.toContain("prompt_tokens");
    streamBody = STREAM_SSE_NO_USAGE;
    const res = await streamHandler(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan-stream", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.45" },
      body: JSON.stringify({ resumeText: RESUME, targetCountry: "US", language: "en" }),
    }));
    await res.text();
    const analysis = usageLines().filter((l) => l.includes("context=free-keyword-scan-stream.analysis"));
    expect(analysis).toEqual([
      "[AI-USAGE] context=free-keyword-scan-stream.analysis model=google/gemini-2.5-flash prompt_tokens=- completion_tokens=- cached_tokens=- reasoning_tokens=- finish_reason=tool_calls",
    ]);
    // Every line, counted or not, is exactly the seven fields.
    for (const l of usageLines()) expect(l.split(" ").slice(1).map((w) => w.split("=")[0])).toEqual(["context", "model", "prompt_tokens", "completion_tokens", "cached_tokens", "reasoning_tokens", "finish_reason"]);
  });
});
