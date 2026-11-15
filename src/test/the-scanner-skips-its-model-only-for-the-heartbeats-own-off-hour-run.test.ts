// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness.ts).
/**
 * THE SCANNER SKIPS ITS MODEL ONLY FOR THE HEARTBEAT'S OWN OFF-HOUR RUN (cost
 * audit 2026-11-08, Do first #1; owner decision 2026-11-08; free-keyword-scan
 * 2026-11-09.1).
 *
 * The heartbeat's full scan, both model calls, now runs once per UTC hour; its
 * other five runs send heartbeatNoModel and get the rule-based report, built
 * without any model call. That field is a way to get a report the model did
 * not write, so it must mean nothing from anyone but the heartbeat.
 *
 * Run against the shipped handler, database and gateway faked:
 *   - the heartbeat's secret plus the field: no gateway call, no concurrency
 *     slot, a rule-based report that says the request was honoured, and no
 *     scan_metrics row (the heartbeat's rows there are read as the model
 *     chain's latency, so a one-second rule-based row would read as an
 *     outage; the run is recorded in heartbeat_results);
 *   - the field from a stranger, or with a wrong secret: ignored, the model
 *     writes the report and nothing says otherwise;
 *   - the heartbeat's secret without the field (its hourly run): the full
 *     scan, both model calls, and its row as before.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

type Args = Record<string, unknown>;

const RESUME = [
  "Jane Doe | jane.doe@example.com | (555) 010-0199",
  "SUMMARY",
  "Senior financial analyst with nine years in FP&A and vendor management.",
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

const ANALYSIS = {
  detectedLanguage: { code: "en", name: "English" },
  candidateName: "Jane Doe",
  industry: "finance",
  atsScoreEstimate: 72,
  formatGrade: "B",
  formatIssue: "Clean single-column layout.",
  experienceLevel: { level: "senior", yearsEstimate: "9 years" },
  sectionCheck: { hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true, missingSections: [] },
  contactInfo: { hasEmail: true, hasPhone: true, hasLinkedIn: false, missingItems: ["LinkedIn URL"] },
  topStrength: "Quantified cost savings",
  redFlags: [],
  keywords: [],
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
  scoreBreakdown: { keywords: 70, format: 80, quantification: 60 },
  industryBenchmark: { industryAvg: 66, comparison: "above", percentile: "60th" },
  sampleRewrite: null,
};

const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-harness-key-0123456789abcdef",
  SUPABASE_ANON_KEY: "anon_harness",
  LOVABLE_API_KEY: "lovable_harness",
  RESEND_API_KEY: "re_harness",
  HEARTBEAT_SECRET: "hb-secret",
  NOTIFY_SCANS: "true",
};

let handler: EdgeHandler;
let rpcs: Array<[string, Args]>;
let modelCalls: number;
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
  const from = () => {
    const builder: Record<string, unknown> = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") return (ok: (r: unknown) => unknown, no?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, no);
        if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: null, error: null });
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
  g.fetch = async (url: string) => {
    const u = String(url);
    if (u.includes("ai.gateway.lovable.dev")) {
      modelCalls++;
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "submit_analysis", arguments: JSON.stringify(ANALYSIS) } }] }, finish_reason: "tool_calls" }] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  handler = await loadEdgeHandler("free-keyword-scan", {
    "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__noModelClient;",
  });
}, 180_000);

beforeEach(() => {
  rpcs = [];
  modelCalls = 0;
  pending = [];
  (globalThis as Record<string, unknown>).__noModelClient = client();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** What the heartbeat's off-hour run sends: its résumé, synthetic, and the field. */
const OFF_HOUR_BODY = { resumeText: `${RESUME}\n\nREFERENCE\nHeartbeat run 2026-11-09T10:20:03Z ab12cd34`, synthetic: true, heartbeatNoModel: true };

async function scan(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.41", ...headers },
    body: JSON.stringify(body),
  }));
  const json = await res.json() as Record<string, unknown>;
  for (let i = 0; i < 3; i++) await Promise.allSettled(pending);
  return { status: res.status, json };
}
const completed = () => rpcs.filter(([n, a]) => n === "log_scan_metric" && a.p_status === "completed").map(([, a]) => a);

describe("the heartbeat's off-hour run", () => {
  it("calls no model, takes no concurrency slot and writes no scan row, and gets the rule-based report saying it was honoured", async () => {
    const r = await scan(OFF_HOUR_BODY, { "x-heartbeat-secret": "hb-secret" });
    expect(r.status).toBe(200);
    expect(modelCalls, "the off-hour run made a model call").toBe(0);
    expect(rpcs.map(([n]) => n)).not.toContain("acquire_scan_slot");
    expect(r.json).toMatchObject({ heartbeatNoModel: true, partialResults: true, partialReason: "rule_based" });
    expect(typeof r.json.atsScoreEstimate).toBe("number");
    expect((r.json.reportMeta as { reportId?: string } | undefined)?.reportId).toBeTruthy();
    expect(rpcs.map(([n]) => n), "the off-hour run wrote a scan_metrics row").not.toContain("log_scan_metric");
  });
});

describe("from anyone else the field means nothing", () => {
  it("a stranger who sends it gets the model's report, and nothing says it was honoured", async () => {
    const r = await scan({ resumeText: RESUME, heartbeatNoModel: true });
    expect(r.status).toBe(200);
    expect(modelCalls, "a stranger skipped the model").toBe(2);
    expect(r.json.heartbeatNoModel).toBeUndefined();
    expect(r.json.partialResults).toBe(false);
    expect(completed()).toHaveLength(1);
    expect(completed()[0].p_scan_type).toBe("free");
    expect(completed()[0].p_metadata).toMatchObject({ usedFallback: false });
  });

  it("a wrong heartbeat secret is a stranger too", async () => {
    const r = await scan(OFF_HOUR_BODY, { "x-heartbeat-secret": "not-the-secret" });
    expect(modelCalls).toBe(2);
    expect(r.json.heartbeatNoModel).toBeUndefined();
  });
});

describe("the heartbeat's hourly run (the control)", () => {
  it("its secret without the field runs the full scan, both model calls", async () => {
    const { heartbeatNoModel: _drop, ...hourly } = OFF_HOUR_BODY;
    const r = await scan(hourly, { "x-heartbeat-secret": "hb-secret" });
    expect(r.status).toBe(200);
    expect(modelCalls).toBe(2);
    expect(r.json.heartbeatNoModel).toBeUndefined();
    expect(r.json.partialResults).toBe(false);
    expect(completed()).toHaveLength(1);
    expect(completed()[0].p_scan_type).toBe("heartbeat");
  });
});
