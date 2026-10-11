// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness.ts).
/**
 * THE RE-ANALYZE BUTTON REPLAYED THE SAVED REPORT, AND A THIN REPLY WAS
 * CALLED AN OUTAGE.
 *
 * Once the primary scan answered cached: true on a cache hit, the page showed
 * "Showing saved results · Re-analyze" on every hit. Re-analyze sends
 * skipCache: true, which the primary never read, so it returned the same
 * saved report again: the button did nothing. And a report marked partial
 * because the model's reply was thin carried no reason, so the page told the
 * reader "our AI reviewer was briefly unavailable" about a reply the model
 * did write.
 *
 * Run against the shipped free-keyword-scan handler, its database, the AI
 * gateway and geolocation faked (the same harness as the rescan test).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

type Args = Record<string, unknown>;

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
  candidateName: "Jane Doe",
  industry: "finance",
  atsScoreEstimate: 45,
  formatGrade: "B",
  formatIssue: "Clean single-column layout.",
  experienceLevel: { level: "senior", yearsEstimate: "9 years" },
  sectionCheck: { hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true, missingSections: [] },
  contactInfo: { hasEmail: true, hasPhone: false, hasLinkedIn: false, missingItems: ["Phone"] },
  topStrength: "Quantified cost savings",
  redFlags: [{ issue: "No LinkedIn", impact: "Recruiters check it", severity: "warning" }],
  keywords: [{ keyword: "variance analysis", reason: "Core FP&A term", frequencyWeight: 3, suggestedSection: "skills" }],
  quickWins: [{ fix: "Add a LinkedIn URL", timeEstimate: "2 min", impact: "medium", scoreImpact: 3, category: "contact" }],
  topSkipReasons: [],
  powerWords: [],
  weakPhrases: [],
  additionalRewrites: [],
  formatGradeDrivers: [],
  recruiterFirstPassSummary: "Strong, quantified finance profile.",
  nextBestAction: { action: "Add LinkedIn", why: "Recruiters check it", estimatedImpact: "+3 pts" },
  improvementPotential: { level: "moderate", estimatedScoreIncrease: 6, topPriority: "Add LinkedIn" },
  resumeLength: { current: 1, recommended: 1 },
  wordCount: { current: 110, ideal: "400-700" },
  actionVerbGrade: "B",
  readabilityScore: 70,
  keywordDensity: 3,
  scoreBreakdown: { keywords: 45, format: 45, quantification: 45 },
  industryBenchmark: { industryAvg: 66, comparison: "above", percentile: "60th" },
  sampleRewrite: { before: "Responsible for budgets", after: "Owned a $4M budget", improvement: "Scope" },
};

const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-harness-key-0123456789abcdef",
  SUPABASE_ANON_KEY: "anon_harness",
  LOVABLE_API_KEY: "lovable_harness",
  NOTIFY_SCANS: "false",
};

let handler: EdgeHandler;
let rpcs: Array<[string, Args]>;
let cacheReads: string[];
let cache: Map<string, { report: unknown; created_at: string }>;
let analysisArgs: string;
let pending: Promise<unknown>[];

function client() {
  const rpc = async (name: string, args: Args = {}) => {
    rpcs.push([name, args]);
    switch (name) {
      case "check_global_rate_limit":
      case "check_rate_limit": return { data: true, error: null };
      case "acquire_scan_slot": return { data: "slot-1", error: null };
      default: return { data: null, error: null };
    }
  };
  const from = (table: string) => {
    const state: { op: string; single: boolean; eq: Record<string, unknown>; row?: Record<string, unknown> } = { op: "select", single: false, eq: {} };
    const resolve = async () => {
      if (table === "scan_report_cache") {
        if (state.op === "upsert" && state.row) {
          cache.set(String(state.row.cache_key), { report: state.row.report, created_at: String(state.row.created_at) });
          return { data: null, error: null };
        }
        if (state.op === "select" && state.single) {
          const k = String(state.eq.cache_key);
          cacheReads.push(k);
          return { data: cache.get(k) ?? null, error: null };
        }
      }
      return { data: state.single ? null : [], error: null };
    };
    const builder: Record<string, unknown> = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") return (ok: (r: unknown) => unknown, no?: (e: unknown) => unknown) => resolve().then(ok, no);
        if (prop === "maybeSingle" || prop === "single") return () => { state.single = true; return resolve(); };
        return (...a: unknown[]) => {
          if (prop === "upsert" || prop === "insert" || prop === "update" || prop === "delete") { state.op = prop; state.row = a[0] as Record<string, unknown>; }
          if (prop === "eq") state.eq[String(a[0])] = a[1];
          return builder;
        };
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
  g.fetch = async (url: string) => {
    const u = String(url);
    if (u.includes("ai.gateway.lovable.dev")) {
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "submit_analysis", arguments: analysisArgs } }] } }] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  handler = await loadEdgeHandler("free-keyword-scan", {
    "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__scanClient;",
  });
}, 180_000);

beforeEach(() => {
  rpcs = [];
  cacheReads = [];
  cache = new Map();
  pending = [];
  analysisArgs = JSON.stringify(ANALYSIS);
  (globalThis as Record<string, unknown>).__scanClient = client();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function scan(body: Record<string, unknown>, country = "US") {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.41", "cf-ipcountry": country },
    body: JSON.stringify(body),
  }));
  const json = await res.json();
  for (let i = 0; i < 3; i++) await Promise.allSettled(pending);
  return { status: res.status, json };
}
// The day's slot is the 1440-minute bucket; the function-wide hour (S11-019) is its own 60-minute one.
const daySlots = () => rpcs.filter(([n, a]) => n === "check_rate_limit" && a.p_function === "free-keyword-scan" && a.p_window_minutes === 1440).length;

describe("Re-analyze", () => {
  it("runs a fresh scan past the saved report, counts it, and replaces what was saved", async () => {
    const first = await scan({ resumeText: RESUME });
    expect(first.status).toBe(200);
    expect(cache.size).toBe(1);
    const savedAt = [...cache.values()][0].created_at;
    rpcs = [];
    cacheReads = [];
    await new Promise((r) => setTimeout(r, 5));
    const again = await scan({ resumeText: RESUME, skipCache: true });
    expect(again.status).toBe(200);
    expect(again.json.cached).toBeUndefined();
    expect(again.json.cachedReport).toBeUndefined();
    expect(cacheReads).toEqual([]);
    expect(daySlots()).toBe(1);
    expect([...cache.values()][0].created_at).not.toBe(savedAt);
  });

  it("a plain rescan is still served from the saved report", async () => {
    await scan({ resumeText: RESUME });
    const again = await scan({ resumeText: RESUME, skipCache: "yes" });
    expect(again.json.cached).toBe(true);
  });
});

describe("a partial report says why it is partial", () => {
  it("a model reply that came back empty is 'thin', not an outage", async () => {
    analysisArgs = "{}";
    const r = await scan({ resumeText: RESUME });
    expect(r.json.partialResults).toBe(true);
    expect(r.json.partialReason).toBe("thin");
  });

  it("no usable model reply is 'rule_based'", async () => {
    analysisArgs = "not json at all";
    const r = await scan({ resumeText: RESUME });
    expect(r.json.partialResults).toBe(true);
    expect(r.json.partialReason).toBe("rule_based");
  });

  it("a whole report carries no reason", async () => {
    const r = await scan({ resumeText: RESUME });
    expect(r.json.partialResults).toBe(false);
    expect(r.json.partialReason).toBeUndefined();
  });
});
