// @vitest-environment node
//
// Node, not jsdom: both scanner forks are bundled with esbuild (helpers/edge-harness.ts).
/**
 * THE FREE SCANNER HAS AN HOUR FOR THE WHOLE INTERNET, AND MAILS THE OWNER ONLY
 * THROUGH THE COUNTED DOOR (register S11-019; "proven" per S11-083).
 *
 * Both forks had per-address limits only (100 requests an hour, 7 scans a
 * day), so a rotating IPv4 pool posting varied résumés could run thousands of
 * AI scans an hour on the model key paid deliveries share, push real visitors
 * onto the load-shed report, and trigger a direct Resend mail to the owner
 * per scan, load-shed and rule-based ones included.
 *
 * Now each fork counts a function-wide hour, strangers and proven callers
 * apart (a board pass, a proven mailbox, a paying account; a plain password
 * account is a stranger). Past it the primary serves its rule-based report
 * with no model call and the stream fork asks for a retry; a counting error
 * is a refusal, never an open door. Neither fork mails the owner directly;
 * owner notes go through notify-owner.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { functionCeiling, GLOBAL_BUCKET, PROVEN_BUCKET } from "../../supabase/functions/_shared/model-spend-gate";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

const RESUME = [
  "Jane Doe | jane.doe@example.com",
  "SUMMARY",
  "Senior financial analyst with nine years in FP&A and vendor management.",
  "EXPERIENCE",
  "Senior Financial Analyst, Acme Corp, Jan 2020 - Present",
  "- Cut vendor spend by $250,000 annually by renegotiating contracts",
  "- Built the quarterly forecasting model used by the CFO",
  "Financial Analyst, Beta Inc, Mar 2016 - Dec 2019",
  "- Led month-end close for three business units",
  "EDUCATION",
  "BSc Economics, State University",
  "SKILLS",
  "Excel, SQL, Tableau, financial modeling, budgeting",
].join("\n");

const ANALYSIS: Record<string, unknown> = {
  detectedLanguage: { code: "en", name: "English" },
  candidateName: "Jane Doe", industry: "finance", atsScoreEstimate: 55, formatGrade: "B", formatIssue: "Clean.",
  experienceLevel: { level: "senior", yearsEstimate: "9 years" },
  sectionCheck: { hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true },
  contactInfo: { hasEmail: true, hasPhone: false, hasLinkedIn: false, missingItems: ["Phone"] },
  topStrength: "Quantified savings",
  redFlags: [{ issue: "No LinkedIn", impact: "Recruiters check it", severity: "minor" }],
  keywords: [{ keyword: "variance analysis", reason: "Core FP&A term", impact: "high" }],
  quickWins: [{ fix: "Add a LinkedIn URL", timeEstimate: "2 min", impact: "medium", scoreImpact: 3 }],
  topSkipReasons: [], powerWords: [], weakPhrases: [], additionalRewrites: [], formatGradeDrivers: [],
  recruiterFirstPassSummary: "Strong finance profile.",
  nextBestAction: { action: "Add LinkedIn", why: "Recruiters check it", estimatedImpact: "+3 pts" },
  improvementPotential: { level: "moderate", estimatedScoreIncrease: 6, topPriority: "Add LinkedIn" },
  scoreBreakdown: { keywords: 50, format: 60, quantification: 55 },
  sampleRewrite: { before: "Responsible for budgets", after: "Owned a $4M budget", improvement: "Scope" },
};

const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-harness-key-0123456789abcdef",
  SUPABASE_ANON_KEY: "anon_harness",
  LOVABLE_API_KEY: "lovable_harness",
  RESEND_API_KEY: "re_harness",
};

type Args = Record<string, unknown>;
let primary: EdgeHandler;
let stream: EdgeHandler;
let pending: Promise<unknown>[];
let ceilingAnswer: (a: Args) => { data: unknown; error: unknown };
let ceilingCalls: Args[];
let fetched: string[];
let streamDb: FakeDb;
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

/** check_rate_limit as each fork calls it: the function-wide buckets answer from ceilingAnswer, the rest allow. */
function rateLimit(a: Args) {
  if (a.p_ip === GLOBAL_BUCKET || a.p_ip === PROVEN_BUCKET || String(a.p_ip).startsWith("user:") || String(a.p_ip).startsWith("pass:")) {
    ceilingCalls.push(a);
    return ceilingAnswer(a);
  }
  return { data: true, error: null };
}

function primaryClient() {
  const rpc = async (name: string, args: Args = {}) => {
    switch (name) {
      case "check_global_rate_limit": return { data: true, error: null };
      case "check_rate_limit": return rateLimit(args);
      case "acquire_scan_slot": return { data: "slot-1", error: null };
      default: return { data: null, error: null };
    }
  };
  const from = () => {
    const builder: Record<string, unknown> = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") return (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
        if (prop === "maybeSingle" || prop === "single") return async () => ({ data: null, error: null });
        return () => builder;
      },
    });
    return builder;
  };
  return { rpc, from, auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
}

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (p: unknown) => { pending.push(Promise.resolve(p).catch(() => {})); } };
  g.fetch = async (url: string, init?: { body?: string }) => {
    const u = String(url);
    fetched.push(u);
    if (u.includes("ai.gateway.lovable.dev")) {
      const body = JSON.parse(init?.body ?? "{}") as { stream?: boolean };
      const args = JSON.stringify(ANALYSIS);
      if (body.stream) {
        const chunk = JSON.stringify({ choices: [{ delta: { tool_calls: [{ function: { arguments: args } }] } }] });
        return new Response(`data: ${chunk}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "submit_analysis", arguments: args } }] } }] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  primary = await loadEdgeHandler("free-keyword-scan", {
    "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__scanClient;",
  });
  stream = await loadEdgeHandler("free-keyword-scan-stream", {
    "https://esm.sh/@supabase/supabase-js@2":
      "export function createClient() { const db = globalThis.__streamDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t), auth: { getUser: async () => ({ data: { user: null }, error: null }) } }; }",
  });
}, 240_000);

beforeEach(() => {
  pending = [];
  fetched = [];
  ceilingCalls = [];
  ceilingAnswer = () => ({ data: true, error: null });
  (globalThis as Record<string, unknown>).__scanClient = primaryClient();
  streamDb = new FakeDb();
  streamDb.rpcs.check_global_rate_limit = () => ({ data: true, error: null });
  streamDb.rpcs.check_rate_limit = (a) => rateLimit(a) as { data: unknown; error: { message: string } | null };
  streamDb.rpcs.get_cached_response = () => ({ data: null, error: null });
  streamDb.rpcs.acquire_scan_slot = () => ({ data: "slot-1", error: null });
  (globalThis as Record<string, unknown>).__streamDb = streamDb;
  for (const m of ["log", "warn", "error", "info"] as const) spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

const HEADERS = { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.77", "cf-ipcountry": "US" };

async function scanPrimary() {
  const res = await primary(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan", { method: "POST", headers: HEADERS, body: JSON.stringify({ resumeText: RESUME }) }));
  const json = await res.json() as Record<string, unknown>;
  for (let i = 0; i < 3; i++) await Promise.allSettled(pending);
  return { status: res.status, json };
}
async function scanStream() {
  const res = await stream(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan-stream", { method: "POST", headers: HEADERS, body: JSON.stringify({ resumeText: RESUME }) }));
  const text = await res.text();
  for (let i = 0; i < 3; i++) await Promise.allSettled(pending);
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => ({ event: m[1], data: JSON.parse(m[2]) as Record<string, unknown> }));
  return { complete: events.find((e) => e.event === "complete")?.data, error: events.find((e) => e.event === "error")?.data };
}
const modelCalls = () => fetched.filter((u) => u.includes("ai.gateway.lovable.dev")).length;
const directMails = () => fetched.filter((u) => u.includes("api.resend.com")).length;
const ownerNotes = () => fetched.filter((u) => u.includes("/functions/v1/notify-owner")).length;

describe("functionCeiling, alone", () => {
  const req = (h: Record<string, string> = {}) => new Request("https://x.test/fn", { headers: { "cf-connecting-ip": "203.0.113.9", ...h } });
  const db = (answer: (a: Args) => { data: unknown; error: unknown }) => {
    const calls: Args[] = [];
    return { calls, rpc: async (_f: string, a: Args) => { calls.push(a); return answer(a); }, from: () => ({}) };
  };
  const LIMITS = { strangersPerHour: 300, provenPerHour: 300, perProvenCallerPerHour: 20 };

  it("a stranger spends the anonymous hour, and only that", async () => {
    const d = db(() => ({ data: true, error: null }));
    expect(await functionCeiling(d, req(), "free-keyword-scan", LIMITS)).toBeNull();
    expect(d.calls).toEqual([{ p_function: "free-keyword-scan", p_ip: GLOBAL_BUCKET, p_max_requests: 300, p_window_minutes: 60 }]);
  });

  it("past it the verdict names the allowance; a counting error is a refusal", async () => {
    expect(await functionCeiling(db(() => ({ data: false, error: null })), req(), "f", LIMITS)).toEqual({ code: "rate_limited_global", limit: 300 });
    expect(await functionCeiling(db(() => ({ data: null, error: { message: "down" } })), req(), "f", LIMITS)).toEqual({ code: "limiter_unavailable", limit: null });
    expect(await functionCeiling(null, req(), "f", LIMITS)).toEqual({ code: "limiter_unavailable", limit: null });
  });

  it("our own servers are never counted", async () => {
    const d = db(() => ({ data: false, error: null }));
    expect(await functionCeiling(d, req({ authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }), "f", LIMITS)).toBeNull();
    expect(d.calls).toEqual([]);
  });
});

describe("the primary", () => {
  it("under the hour, scans with the model, counts the anonymous hour, and mails nobody directly", async () => {
    const { status, json } = await scanPrimary();
    expect(status).toBe(200);
    expect(modelCalls()).toBeGreaterThan(0);
    expect(ceilingCalls.map((c) => [c.p_function, c.p_ip])).toEqual([["free-keyword-scan", GLOBAL_BUCKET]]);
    expect(json.partialReason).toBeUndefined();
    expect(directMails()).toBe(0);
  });

  it("past the hour, serves the rule-based report with no model call", async () => {
    ceilingAnswer = () => ({ data: false, error: null });
    const { status, json } = await scanPrimary();
    expect(status).toBe(200);
    expect(modelCalls()).toBe(0);
    expect(json.partialResults).toBe(true);
    expect(directMails()).toBe(0);
  });

  it("when the hour cannot be counted, still calls no model", async () => {
    ceilingAnswer = () => ({ data: null, error: { message: "rate_limits unavailable" } });
    await scanPrimary();
    expect(modelCalls()).toBe(0);
  });
});

describe("the stream fork", () => {
  it("under the hour, completes, counts the scanner's one anonymous hour (shared with the primary, as its day is), sends the owner note through notify-owner and no direct mail", async () => {
    const r = await scanStream();
    expect(r.complete?.success).toBe(true);
    expect(ceilingCalls.map((c) => [c.p_function, c.p_ip])).toEqual([["free-keyword-scan", GLOBAL_BUCKET]]);
    expect(directMails()).toBe(0);
    expect(ownerNotes()).toBe(1);
  });

  it("past the hour, asks for a retry and calls no model", async () => {
    ceilingAnswer = () => ({ data: false, error: null });
    const r = await scanStream();
    expect(r.error?.code).toBe("busy");
    expect(modelCalls()).toBe(0);
  });
});
