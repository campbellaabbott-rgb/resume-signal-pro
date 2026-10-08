// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness.ts).
/**
 * THE HEARTBEAT'S OWN SCAN IS NOT A RESUME ANYONE SCANNED (wave 2 email-ops,
 * review of the L10-21 fix).
 *
 * WHAT WAS WRONG. To make the heartbeat prove the scan pipeline, its résumé
 * now carries a per-run reference line, so it is never a report-cache hit.
 * The cache hit had been the only thing keeping the heartbeat away from what
 * a completed scan counts: free-keyword-scan bumped the public "resumes
 * scanned today" counter (increment_free_scan_count, rendered as social proof
 * once it reaches 25, which the heartbeat alone would reach by about 04:10 UTC
 * at 144 runs a day), mailed the owner a "New Free Scan" note, wrote the
 * detection logs, an industry pin and a cache row, on every run. And because
 * the heartbeat also says synthetic, its scan_metrics row was typed
 * 'synthetic' rather than 'heartbeat' -- the live get_public_scan_insights
 * excludes only 'heartbeat', so 144 copies of one test résumé a day would
 * have entered the published score study.
 *
 * WHAT HOLDS NOW, by running the shipped handler with its database, the AI
 * gateway and Resend faked: a heartbeat scan (the secret header plus
 * synthetic, exactly what scan-heartbeat sends) and a script's synthetic scan
 * write none of those things, the heartbeat's metric row is 'heartbeat', and
 * a visitor's scan still writes every one of them.
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
let writes: Array<{ table: string; op: string }>;
let mails: Array<{ to: string; subject: string }>;
let notes: number;
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
    const state = { op: "select", single: false };
    const resolve = async () => {
      if (state.op !== "select") writes.push({ table, op: state.op });
      return { data: state.single ? null : [], error: null };
    };
    const builder: Record<string, unknown> = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") return (ok: (r: unknown) => unknown, no?: (e: unknown) => unknown) => resolve().then(ok, no);
        if (prop === "maybeSingle" || prop === "single") return () => { state.single = true; return resolve(); };
        return (..._a: unknown[]) => {
          if (prop === "upsert" || prop === "insert" || prop === "update" || prop === "delete") state.op = prop;
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
  g.fetch = async (url: string, init?: { body?: string }) => {
    const u = String(url);
    if (u.endsWith("/functions/v1/notify-owner")) { notes++; return new Response("{}", { status: 200 }); }
    if (u.startsWith("https://api.resend.com/")) {
      const b = JSON.parse(init?.body ?? "{}");
      mails.push({ to: String(b.to), subject: String(b.subject) });
      return new Response(JSON.stringify({ id: "em" }), { status: 200 });
    }
    if (u.endsWith("/auth/v1/settings")) return new Response(JSON.stringify({ mailer_autoconfirm: true }), { status: 200 });
    if (u.includes("ai.gateway.lovable.dev")) {
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "submit_analysis", arguments: JSON.stringify(ANALYSIS) } }] } }] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  handler = await loadEdgeHandler("free-keyword-scan", {
    "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__scanClient;",
  });
}, 180_000);

beforeEach(() => {
  rpcs = [];
  writes = [];
  mails = [];
  notes = 0;
  pending = [];
  (globalThis as Record<string, unknown>).__scanClient = client();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function scan(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.40", ...headers },
    body: JSON.stringify(body),
  }));
  const json = await res.json();
  // Everything the handler handed to waitUntil, the background writes included.
  for (let i = 0; i < 3; i++) await Promise.allSettled(pending);
  return { status: res.status, json };
}

/** What a completed scan records about itself as a visitor's scan. */
function visitorFootprint() {
  return {
    counter: rpcs.filter(([n]) => n === "increment_free_scan_count").length,
    detectionLog: rpcs.filter(([n]) => n === "log_industry_detection").length,
    telemetry: writes.filter((w) => w.table === "detection_telemetry").length,
    pins: writes.filter((w) => w.table === "scan_industry_pins").length,
    cache: writes.filter((w) => w.table === "scan_report_cache").length,
    scanMail: mails.filter((m) => /New Free Scan/.test(m.subject)).length,
    ownerNote: notes,
  };
}
const completedType = () =>
  rpcs.filter(([n, a]) => n === "log_scan_metric" && a.p_status === "completed").map(([, a]) => a.p_scan_type);

describe("a visitor's scan is counted (the control)", () => {
  it("bumps the counter, mails the owner, writes the logs and the cache, and is typed free", async () => {
    const r = await scan({ resumeText: RESUME });
    expect(r.status).toBe(200);
    expect(r.json.cachedReport).toBeUndefined();
    const f = visitorFootprint();
    expect(f.counter).toBe(1);
    expect(f.detectionLog).toBe(1);
    expect(f.telemetry).toBe(1);
    expect(f.cache).toBe(1);
    expect(f.scanMail).toBe(1);
    expect(f.ownerNote).toBe(1);
    expect(completedType()).toEqual(["free"]);
  });
});

describe("our own probes are not", () => {
  const nothing = { counter: 0, detectionLog: 0, telemetry: 0, pins: 0, cache: 0, scanMail: 0, ownerNote: 0 };

  it("the heartbeat's scan, sent as scan-heartbeat sends it, leaves the public counter and the owner's inbox alone and is typed heartbeat", async () => {
    const r = await scan(
      { resumeText: `${RESUME}\n\nREFERENCE\nHeartbeat run ${new Date().toISOString()} 1a2b3c4d`, synthetic: true },
      { "x-heartbeat-secret": "hb-secret" },
    );
    expect(r.status).toBe(200);
    expect(typeof r.json.atsScoreEstimate, "the heartbeat must still get a full report to check").toBe("number");
    expect(visitorFootprint(), "every heartbeat run counted as a resume scanned today").toEqual(nothing);
    expect(completedType(), "a heartbeat typed synthetic enters a score study that excludes only heartbeat").toEqual(["heartbeat"]);
  });

  it("a script's synthetic scan is not counted either, and stays typed synthetic", async () => {
    const r = await scan({ resumeText: `${RESUME}\nload test 17`, synthetic: true });
    expect(r.status).toBe(200);
    expect(visitorFootprint()).toEqual(nothing);
    expect(completedType()).toEqual(["synthetic"]);
  });
});
