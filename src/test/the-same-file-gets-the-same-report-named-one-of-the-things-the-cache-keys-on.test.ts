// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness.ts).
/**
 * "THE SAME FILE GETS THE SAME REPORT" NAMED ONE OF THE SEVERAL THINGS THE
 * CACHE IS KEYED ON (review of ae644044 / 94778203).
 *
 * The homepage, its FAQ, llms.txt, the "Why not ChatGPT" card, the tool
 * landings, a competitor page, a guide and the privacy page promised that a
 * rescan of the same file within 7 days returns the same report. The cache
 * key is the file, the job posting, the context answers and the market, and
 * the report's own Re-analyze button skips the cache on purpose: the same
 * file scanned against a posting, or re-analyzed, gets a different report
 * and ID.
 *
 * Run first against the shipped free-keyword-scan handler (the harness of
 * the Re-analyze test) to measure what repeats, then every published
 * sentence that promises the same report is read for the condition.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { TOOL_LANDINGS } from "@/data/tool-landings";
import { COMPETITORS } from "@/data/competitors";
import { GUIDES } from "@/data/guides";

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
const idOf = (r: { json: { reportMeta?: { reportId?: string } } }) => r.json.reportMeta?.reportId;
const POSTING_A = "Senior Financial Analyst. We need FP&A, variance analysis, forecasting and SQL for our corporate finance team.";
const POSTING_B = "Data Engineer. We need Airflow, dbt, Snowflake and Python to build our analytics platform from scratch.";

describe("what the report cache repeats, measured", () => {
  it("the same file against the same posting is the same report and ID", async () => {
    const first = await scan({ resumeText: RESUME, jobDescriptionText: POSTING_A });
    const again = await scan({ resumeText: RESUME, jobDescriptionText: POSTING_A });
    expect(again.json.cached).toBe(true);
    expect(idOf(again)).toBe(idOf(first));
  });

  it("the same file against another posting, or with none, is another report", async () => {
    const a = await scan({ resumeText: RESUME, jobDescriptionText: POSTING_A });
    const b = await scan({ resumeText: RESUME, jobDescriptionText: POSTING_B });
    const none = await scan({ resumeText: RESUME });
    expect(b.json.cached).toBeUndefined();
    expect(none.json.cached).toBeUndefined();
    expect(new Set([idOf(a), idOf(b), idOf(none)]).size).toBe(3);
  });

  it("Re-analyze on the same file and posting builds a fresh report", async () => {
    await scan({ resumeText: RESUME, jobDescriptionText: POSTING_A });
    const fresh = await scan({ resumeText: RESUME, jobDescriptionText: POSTING_A, skipCache: true });
    expect(fresh.json.cached).toBeUndefined();
  });
});

// Every string under a value, so a data module is read whole.
const strings = (v: unknown): string[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : [];
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

// The word each locale uses for a job posting.
const POSTING_WORD: Record<string, RegExp> = {
  en: /posting/, "en-GB": /posting/, de: /Stellenanzeige/, es: /oferta/, fr: /offre/, hi: /पोस्टिंग/, nl: /vacature/, pt: /vaga/, tl: /posting/,
};

describe("every published promise of the same report names the posting", () => {
  for (const [lng, word] of Object.entries(POSTING_WORD)) {
    it(`${lng}: the homepage subheading and the data-storage answer`, () => {
      const d = JSON.parse(read(`src/i18n/locales/${lng}.json`));
      expect(d.hero.socialFirst.subheading).toMatch(word);
      expect(d.faq.questions.dataStorage.answer).toMatch(word);
    });
  }

  it("the tool landings, competitor pages and guides", () => {
    const promises = [...strings(TOOL_LANDINGS), ...strings(COMPETITORS), ...strings(GUIDES)]
      .filter((t) => /same report|mismo informe/i.test(t));
    expect(promises.length).toBeGreaterThan(0);
    for (const t of promises) expect(t, t).toMatch(/posting|oferta/);
  });

  it("the Why-not-ChatGPT card, the privacy page, the prerendered homepage and llms.txt", () => {
    for (const file of ["src/components/WhyNotChatGPT.tsx", "src/pages/Privacy.tsx", "scripts/prerender-seo.mjs", "public/llms.txt"]) {
      const lines = read(file).split("\n").filter((l) => /same report/i.test(l) && !/^\s*(?:\/\/|\*)/.test(l));
      expect(lines.length, file).toBeGreaterThan(0);
      for (const l of lines) expect(l, file).toMatch(/posting/);
    }
  });
});
