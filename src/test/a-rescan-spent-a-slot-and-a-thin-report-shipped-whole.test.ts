// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness.ts).
/**
 * A RESCAN SPENT A SLOT, AND A THIN REPORT SHIPPED WHOLE (sweep S8-067,
 * S8-068, S8-069, S8-070, S8-071, S8-072).
 *
 * Run against the shipped free-keyword-scan handler, its database, the AI
 * gateway and geolocation faked:
 *   - a rescan of the same file returned the cached report but had already
 *     counted one of the day's 7 slots (the slot was counted before the
 *     cache was read), and never said it was a replay;
 *   - the same text from two countries shared one cached report, though the
 *     IP country decides the standards when the résumé names no place;
 *   - the report id hashed the résumé alone, so its reports for two
 *     postings shared one id (and one mail allowance);
 *   - keywords: [null] or industry: 5 from the model threw a 500 before the
 *     schema layer ran;
 *   - an empty core analysis shipped as a complete report and was cached;
 *   - "every point, accounted for" summed to a number other than the score.
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
const daySlots = () => rpcs.filter(([n, a]) => n === "check_rate_limit" && a.p_function === "free-keyword-scan").length;

describe("a rescan of the same file", () => {
  it("is served from the cache without spending a day's slot, and says it is a replay", async () => {
    const first = await scan({ resumeText: RESUME });
    expect(first.status).toBe(200);
    expect(daySlots()).toBe(1);
    expect(cache.size).toBe(1);
    rpcs = [];
    const again = await scan({ resumeText: RESUME });
    expect(again.status).toBe(200);
    expect(again.json.cached).toBe(true);
    expect(daySlots()).toBe(0);
    expect(again.json.reportMeta.reportId).toBe(first.json.reportMeta.reportId);
  });

  it("from another country is another report when the résumé names no place", async () => {
    await scan({ resumeText: RESUME }, "US");
    await scan({ resumeText: RESUME }, "GB");
    expect(new Set(cacheReads).size).toBe(2);
    expect(cache.size).toBe(2);
  });
});

describe("the report id", () => {
  it("differs for the same résumé against two postings", async () => {
    const a = await scan({ resumeText: RESUME, jobDescriptionText: "Senior FP&A analyst: forecasting, variance analysis, Excel and SQL for a retail group." });
    const b = await scan({ resumeText: RESUME, jobDescriptionText: "Treasury analyst: cash management, FX hedging, bank relationships and liquidity reporting." });
    expect(a.json.reportMeta.reportId).toMatch(/^[0-9A-F]{12}$/);
    expect(a.json.reportMeta.reportId).not.toBe(b.json.reportMeta.reportId);
  });
});

describe("the model's JSON", () => {
  it("with keywords: [null] and industry: 5 still gives a report, not a 500", async () => {
    analysisArgs = JSON.stringify({ ...ANALYSIS, keywords: [null, { keyword: "variance analysis" }], industry: 5 });
    const r = await scan({ resumeText: RESUME });
    expect(r.status).toBe(200);
    expect(r.json.success).toBe(true);
  });

  it("when empty, is served as a partial report and never cached", async () => {
    analysisArgs = "{}";
    const r = await scan({ resumeText: RESUME });
    expect(r.status).toBe(200);
    expect(r.json.partialResults).toBe(true);
    expect(cache.size).toBe(0);
  });
});

describe("the score audit", () => {
  it("sums to the score the report states when the sub-scores do not track it", async () => {
    // Sub-scores of 95 with an overall 45: the components alone came to 86.
    analysisArgs = JSON.stringify({ ...ANALYSIS, scoreBreakdown: { keywords: 95, format: 95, quantification: 95 } });
    const r = await scan({ resumeText: RESUME });
    const audit = r.json.scoreAudit as { total: number; items: Array<{ earned: number; possible: number }> };
    expect(audit.total).toBe(r.json.atsScoreEstimate);
    expect(audit.items.reduce((s, i) => s + i.earned, 0)).toBe(audit.total);
    for (const i of audit.items) {
      expect(i.earned).toBeGreaterThanOrEqual(0);
      expect(i.earned).toBeLessThanOrEqual(i.possible);
    }
  });
});
